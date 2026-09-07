-- checkout_appointment(): cobra una cita atendida (tarea 5.6), llamada
-- desde services/checkout.ts vía supabase.rpc(...).
--
-- =============================================================================
-- Qué es una transacción, y qué garantiza el "todo o nada"
-- =============================================================================
-- Cobrar toca CUATRO cosas relacionadas: crea la venta (sales), copia cada
-- servicio de la cita como una partida del ticket (sale_items), registra
-- cómo se pagó (payments) y verifica que el pago alcance. Si esto se
-- hiciera con varias llamadas sueltas desde el navegador (un
-- .insert(sales), luego un .insert(sale_items), luego un .insert(payments))
-- y la tercera fallara —se cae la conexión, el usuario cierra la pestaña,
-- el monto no alcanza y nadie lo valida a tiempo—, quedaría una VENTA
-- HUÉRFANA: una fila en sales con su total, pero sin pago que la respalde.
-- En un negocio real eso es un ticket fantasma.
--
-- Una función de Postgres corre completa dentro de UNA sola transacción:
-- Postgres no confirma NADA de lo que hizo la función hasta que termina sin
-- errores. Si en cualquier punto se lanza una excepción (`raise exception`),
-- Postgres deshace automáticamente TODO lo que la función alcanzó a
-- insertar o modificar hasta ese momento — la venta a medio crear, sus
-- partidas, los pagos ya registrados, todo. Es la garantía que pide la
-- tarea 5.8: si el pago no alcanza, no queda NADA escrito, ni siquiera la
-- fila de `sales`. (Mismo razonamiento que create_appointment() en
-- appointment_booking_rpc.sql, fase 3, para el mismo problema con citas.)
--
-- =============================================================================
-- Por qué revalida permisos aunque sea SECURITY DEFINER
-- =============================================================================
-- SECURITY DEFINER hace que esta función corra con los permisos de quien la
-- CREÓ (el rol de la migración), no con los del usuario que la llama —
-- necesario para poder escribir en sales/sale_items/payments en una sola
-- transacción sin que cada INSERT individual dependa de que el usuario que
-- llama tenga permiso de INSERT directo en esas tablas. Pero eso también
-- significa que SECURITY DEFINER SALTA row level security: si esta función
-- no revisara nada más, cualquier usuario autenticado —sin importar su rol
-- ni su tenant— podría cobrar la cita de OTRO negocio con solo adivinar su
-- uuid. Por eso las primeras líneas revalidan, a mano, exactamente lo que
-- las políticas RLS habrían revisado: que el usuario pertenece al tenant de
-- la cita, que tiene acceso a esa sucursal, y que su rol (owner o
-- receptionist — CLAUDE.md §6.1) puede cobrar. Es la misma regla que
-- CLAUDE.md §7.3 (regla 4) exige para toda función SECURITY DEFINER: "sin
-- revalidar, es una puerta trasera".
create function checkout_appointment(
  p_appointment_id uuid,
  p_payments jsonb,
  -- Descuento en centavos, opcional (sales.discount_cents — CLAUDE.md
  -- §6.5). lib/money.ts#applyDiscount ya define la regla de "nunca deja el
  -- total en negativo"; esta función aplica exactamente la misma fórmula
  -- en SQL, para que los dos coincidan siempre (tarea 5.10).
  p_discount_cents integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_appointment appointments;
  v_role member_role;
  v_item_count integer;
  v_sale_id uuid;
  v_folio integer;
  v_subtotal_cents integer;
  v_tax_cents integer;
  v_discount_cents integer := coalesce(p_discount_cents, 0);
  v_total_cents integer;
  v_payments_total_cents integer := 0;
  v_payment_elem jsonb;
  v_method payment_method;
  v_amount_cents integer;
  v_status payment_status;
  v_reference text;
begin
  -- 1. La cita existe, y quien llama pertenece al tenant, tiene acceso a
  -- la sucursal y tiene un rol que puede cobrar (revalidación manual, ver
  -- comentario de cabecera).
  select * into v_appointment from appointments where id = p_appointment_id and deleted_at is null;
  if not found then
    raise exception 'La cita no existe.' using errcode = 'no_data_found';
  end if;

  if not app.is_member_of(v_appointment.tenant_id) then
    raise exception 'No perteneces a este negocio.' using errcode = 'insufficient_privilege';
  end if;

  if not app.can_access_branch(v_appointment.branch_id) then
    raise exception 'No tienes acceso a esta sucursal.' using errcode = 'insufficient_privilege';
  end if;

  v_role := app.role_in(v_appointment.tenant_id);
  if v_role not in ('owner', 'receptionist') then
    raise exception 'No tienes permiso para cobrar.' using errcode = 'insufficient_privilege';
  end if;

  -- 2. Solo se cobra una cita ya atendida (CLAUDE.md: agendar → atender →
  -- cobrar, en ese orden — tarea 4.16 deja la cita en 'completed' al
  -- guardar su ficha).
  if v_appointment.status <> 'completed' then
    raise exception 'La cita debe estar atendida antes de cobrarse.' using errcode = 'check_violation';
  end if;

  -- 3. No se cobra dos veces la misma cita: si ya existe una partida de
  -- sale_items ligada a esta cita en una venta que no está cancelada,
  -- ya se cobró.
  if exists (
    select 1 from sale_items si
    join sales s on s.id = si.sale_id
    where si.appointment_id = p_appointment_id
      and si.deleted_at is null
      and s.status <> 'cancelled'
  ) then
    raise exception 'Esta cita ya fue cobrada.' using errcode = 'check_violation';
  end if;

  select count(*) into v_item_count
  from appointment_services
  where appointment_id = p_appointment_id and deleted_at is null;

  if v_item_count = 0 then
    raise exception 'Esta cita no tiene servicios que cobrar.' using errcode = 'check_violation';
  end if;

  if p_payments is null or jsonb_array_length(p_payments) = 0 then
    raise exception 'Debes registrar al menos un pago.' using errcode = 'check_violation';
  end if;

  if v_discount_cents < 0 then
    raise exception 'El descuento no puede ser negativo.' using errcode = 'check_violation';
  end if;

  -- 4. Folio consecutivo POR SUCURSAL, no por tenant (ver el comentario de
  -- la columna en sales.sql: dos sucursales llevan cada una su propia
  -- numeración, como dos cajas distintas).
  select coalesce(max(folio), 0) + 1 into v_folio
  from sales
  where tenant_id = v_appointment.tenant_id and branch_id = v_appointment.branch_id;

  -- 5. Crea la venta con los totales en 0: se completan en el paso
  -- siguiente, en el MISMO insert que crea las partidas — así el desglose
  -- de IVA se calcula una sola vez, no una vez para saber el total y otra
  -- distinta para guardar cada partida (dos cálculos podrían, en teoría,
  -- divergir si alguien edita uno y no el otro).
  insert into sales (
    tenant_id, branch_id, customer_id, folio, status,
    subtotal_cents, tax_cents, discount_cents, total_cents, paid_at, closed_by
  )
  values (
    v_appointment.tenant_id, v_appointment.branch_id, v_appointment.customer_id, v_folio, 'paid',
    0, 0, v_discount_cents, 0, now(), auth.uid()
  )
  returning id into v_sale_id;

  -- 6. Copia cada appointment_service como una partida del ticket. La
  -- descripción congela name_snapshot (mismo principio de snapshot que ya
  -- usa appointment_services, CLAUDE.md §6.3: si el catálogo cambia
  -- después, este ticket ya emitido no cambia). tax_rate_bp, en cambio, SÍ
  -- se lee del catálogo actual (join a services): appointment_services no
  -- lo guarda como snapshot, solo nombre/precio/duración — una tasa de
  -- impuesto cambia con muchísima menos frecuencia que un precio.
  --
  -- El desglose por partida (net = round(gross * 10000 / (10000 +
  -- tax_rate_bp)), tax = gross - net) es la misma fórmula de
  -- lib/money.ts#splitTaxIncluded, para que los totales de la base y los
  -- de la UI coincidan siempre (tarea 5.10).
  with inserted as (
    insert into sale_items (
      tenant_id, sale_id, item_type, service_id, appointment_id,
      description, quantity, unit_price_cents, tax_rate_bp, tax_cents, line_total_cents
    )
    select
      v_appointment.tenant_id,
      v_sale_id,
      'service',
      aps.service_id,
      p_appointment_id,
      aps.name_snapshot,
      aps.quantity,
      aps.unit_price_cents,
      s.tax_rate_bp,
      (aps.unit_price_cents * aps.quantity)
        - round(((aps.unit_price_cents * aps.quantity)::numeric * 10000) / (10000 + s.tax_rate_bp))::integer,
      aps.unit_price_cents * aps.quantity
    from appointment_services aps
    join services s on s.id = aps.service_id
    where aps.appointment_id = p_appointment_id and aps.deleted_at is null
    returning tax_cents, line_total_cents
  )
  select
    coalesce(sum(line_total_cents - tax_cents), 0),
    coalesce(sum(tax_cents), 0)
  into v_subtotal_cents, v_tax_cents
  from inserted;

  v_total_cents := greatest(0, v_subtotal_cents + v_tax_cents - v_discount_cents);

  update sales
  set subtotal_cents = v_subtotal_cents, tax_cents = v_tax_cents, total_cents = v_total_cents
  where id = v_sale_id;

  -- 7. Registra cada pago y va sumando lo pagado. 'cash' es un pago real
  -- (no hay pasarela que pueda fallar); los otros tres métodos se simulan
  -- en v1 (CLAUDE.md §6.5) con una referencia falsa reconocible
  -- ("SIM-...") cuando el llamador no manda una.
  for v_payment_elem in select * from jsonb_array_elements(p_payments) loop
    v_method := (v_payment_elem->>'method')::payment_method;
    v_amount_cents := (v_payment_elem->>'amount_cents')::integer;

    if v_amount_cents is null or v_amount_cents <= 0 then
      raise exception 'El monto de cada pago debe ser mayor a cero.' using errcode = 'check_violation';
    end if;

    v_status := case when v_method = 'cash' then 'approved' else 'simulated_approved' end;
    v_reference := v_payment_elem->>'reference';
    if v_status = 'simulated_approved' and coalesce(v_reference, '') = '' then
      v_reference := 'SIM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    end if;

    insert into payments (tenant_id, sale_id, method, amount_cents, reference, status, paid_at)
    values (v_appointment.tenant_id, v_sale_id, v_method, v_amount_cents, v_reference, v_status, now());

    v_payments_total_cents := v_payments_total_cents + v_amount_cents;
  end loop;

  -- 8. El pago debe alcanzar el total. Si no, esta excepción deshace TODA
  -- la transacción (la venta y sus partidas y pagos ya insertados
  -- incluidos) — es la prueba de la tarea 5.8.
  if v_payments_total_cents < v_total_cents then
    raise exception 'El monto pagado (%) no cubre el total de la venta (%).',
      v_payments_total_cents, v_total_cents
      using errcode = 'check_violation';
  end if;

  return v_sale_id;
end;
$$;

comment on function checkout_appointment(uuid, jsonb, integer) is
  'Cobra una cita atendida: crea la venta y sus partidas desde los snapshots de la cita, registra los pagos y valida que alcancen el total, todo en una sola transacción. Revalida membresía, sucursal y rol (SECURITY DEFINER salta RLS).';

grant execute on function checkout_appointment(uuid, jsonb, integer) to authenticated;
