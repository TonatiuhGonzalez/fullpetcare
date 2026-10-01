-- Fase 11, tareas 11.10 y 11.11 (HMH Four #2041): vender productos en el cobro.
--
-- Qué cambia, todo ADITIVO (el cobro de servicios se comporta igual):
--   1. sale_items.product_id: una partida es de un servicio O de un producto.
--   2. payments.payment_form_code: forma de pago del SAT (04 crédito, 28 débito...)
--      guardada al cobrar, para precargar la factura después.
--   3. checkout_appointment() acepta productos extra en el mismo ticket.
--   4. checkout_counter_sale(): venta de mostrador, sin cita.
--   5. Un trigger devuelve la existencia al cancelar una venta pagada.
--
-- La existencia baja con movimientos 'sale' en stock_movements; la regla "no se
-- puede dejar en negativo" ya vive en la base (trigger de stock_movements.sql),
-- así que ninguna ruta de cobro puede saltársela.

-- ===========================================================================
-- 1. sale_items.product_id
-- ===========================================================================
alter table sale_items add column product_id uuid references products(id);

-- Exactamente un origen por partida. Se expresa sin exigir service_id en las
-- filas de servicio para no invalidar ventas antiguas.
alter table sale_items add constraint sale_items_one_source check (
  (item_type = 'product' and product_id is not null and service_id is null)
  or (item_type = 'service' and product_id is null)
);

create index sale_items_tenant_product_idx on sale_items (tenant_id, product_id)
  where product_id is not null;

-- ===========================================================================
-- 2. payments.payment_form_code
-- ===========================================================================
alter table payments add column payment_form_code text;

-- c_FormaPago del SAT (CLAUDE.md §8.4): 01 efectivo, 03 transferencia,
-- 04 tarjeta de crédito, 28 tarjeta de débito.
-- NOT VALID: se exige a los pagos NUEVOS; los pagos con tarjeta que ya existen
-- (de antes de esta migración) no traen el dato y no se inventa uno.
alter table payments add constraint payments_card_needs_form_code check (
  -- coalesce: con NULL, `in` da NULL y un check con NULL PASA (trampa clásica).
  method <> 'card' or coalesce(payment_form_code in ('04', '28'), false)
) not valid;

alter table payments add constraint payments_form_code_known check (
  payment_form_code is null or payment_form_code in ('01', '03', '04', '28')
);

-- ===========================================================================
-- Auxiliares internos (no se llaman desde fuera)
-- ===========================================================================

-- Agrega al ticket cada producto de p_products ([{product_id, quantity}]) y baja
-- la existencia de la sucursal con un movimiento 'sale'. Si algo no se puede
-- (producto ajeno, inactivo, sin existencia), lanza y el cobro completo se
-- deshace: todo o nada.
create function app.add_product_items(
  p_sale_id uuid,
  p_tenant_id uuid,
  p_branch_id uuid,
  p_products jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_elem jsonb;
  v_product products;
  v_quantity integer;
  v_stock integer;
  v_line_total integer;
begin
  for v_elem in select * from jsonb_array_elements(coalesce(p_products, '[]'::jsonb)) loop
    v_quantity := (v_elem->>'quantity')::integer;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'La cantidad de cada producto debe ser mayor a cero.' using errcode = 'check_violation';
    end if;

    -- Del mismo negocio, activo y no borrado. Esta función salta RLS, así que
    -- el filtro por tenant es lo que impide vender el producto de otro negocio.
    select * into v_product
      from products
     where id = (v_elem->>'product_id')::uuid
       and tenant_id = p_tenant_id
       and deleted_at is null
       and is_active;
    if not found then
      raise exception 'El producto no existe o no está disponible.' using errcode = 'no_data_found';
    end if;

    -- Mensaje claro para el caso común; el trigger de stock_movements sigue
    -- siendo quien lo garantiza si dos cobros compiten por la última pieza.
    select coalesce(sum(quantity), 0)::integer into v_stock
      from stock_movements
     where tenant_id = p_tenant_id and branch_id = p_branch_id and product_id = v_product.id;
    if v_stock <= 0 then
      raise exception 'El producto "%" no tiene existencia.', v_product.name using errcode = 'check_violation';
    end if;

    v_line_total := v_product.price_cents * v_quantity;

    -- Mismo desglose por partida que lib/money.ts#splitTaxIncluded (§8.2).
    insert into sale_items (
      tenant_id, sale_id, item_type, product_id, description,
      quantity, unit_price_cents, tax_rate_bp, tax_cents, line_total_cents
    )
    values (
      p_tenant_id, p_sale_id, 'product', v_product.id, v_product.name,
      v_quantity, v_product.price_cents, v_product.tax_rate_bp,
      v_line_total - round((v_line_total::numeric * 10000) / (10000 + v_product.tax_rate_bp))::integer,
      v_line_total
    );

    insert into stock_movements (tenant_id, branch_id, product_id, movement_type, quantity, sale_id, created_by)
    values (p_tenant_id, p_branch_id, v_product.id, 'sale', -v_quantity, p_sale_id, auth.uid());
  end loop;
end;
$$;

-- Con las partidas ya insertadas: calcula totales, registra los pagos y valida
-- que alcancen. Es el cierre común del cobro de cita y de mostrador.
create function app.finalize_sale(
  p_sale_id uuid,
  p_tenant_id uuid,
  p_discount_cents integer,
  p_payments jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_subtotal_cents integer;
  v_tax_cents integer;
  v_total_cents integer;
  v_payments_total_cents integer := 0;
  v_payment_elem jsonb;
  v_method payment_method;
  v_amount_cents integer;
  v_status payment_status;
  v_reference text;
  v_form_code text;
begin
  select
    coalesce(sum(line_total_cents - tax_cents), 0),
    coalesce(sum(tax_cents), 0)
  into v_subtotal_cents, v_tax_cents
  from sale_items
  where sale_id = p_sale_id and deleted_at is null;

  v_total_cents := greatest(0, v_subtotal_cents + v_tax_cents - p_discount_cents);

  update sales
  set subtotal_cents = v_subtotal_cents, tax_cents = v_tax_cents, total_cents = v_total_cents
  where id = p_sale_id;

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

    -- Con tarjeta la persona que cobra elige crédito (04) o débito (28): no hay
    -- forma de deducirlo. Los demás métodos se derivan solos.
    if v_method = 'card' then
      v_form_code := v_payment_elem->>'payment_form_code';
      if v_form_code is null or v_form_code not in ('04', '28') then
        raise exception 'Elige si la tarjeta fue de crédito o de débito.' using errcode = 'check_violation';
      end if;
    else
      v_form_code := case v_method when 'cash' then '01' when 'transfer_spei' then '03' else null end;
    end if;

    insert into payments (tenant_id, sale_id, method, amount_cents, reference, status, paid_at, payment_form_code)
    values (p_tenant_id, p_sale_id, v_method, v_amount_cents, v_reference, v_status, now(), v_form_code);

    v_payments_total_cents := v_payments_total_cents + v_amount_cents;
  end loop;

  if v_payments_total_cents < v_total_cents then
    raise exception 'El monto pagado (%) no cubre el total de la venta (%).',
      v_payments_total_cents, v_total_cents
      using errcode = 'check_violation';
  end if;
end;
$$;

revoke execute on function app.add_product_items(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function app.finalize_sale(uuid, uuid, integer, jsonb) from public, anon, authenticated;

-- ===========================================================================
-- 3. checkout_appointment() con productos opcionales
-- ===========================================================================
-- Se reemplaza la función (cambia su firma: gana p_products con default '[]').
-- Quien la llama como antes, con tres argumentos, obtiene lo mismo de siempre.
-- Las validaciones y los mensajes de error son los de checkout_rpc.sql.
drop function checkout_appointment(uuid, jsonb, integer);

create function checkout_appointment(
  p_appointment_id uuid,
  p_payments jsonb,
  p_discount_cents integer default 0,
  -- [{"product_id": "...", "quantity": 2}]: productos que se suman al ticket.
  p_products jsonb default '[]'::jsonb
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
  v_discount_cents integer := coalesce(p_discount_cents, 0);
begin
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

  if v_appointment.status <> 'completed' then
    raise exception 'La cita debe estar atendida antes de cobrarse.' using errcode = 'check_violation';
  end if;

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

  select coalesce(max(folio), 0) + 1 into v_folio
  from sales
  where tenant_id = v_appointment.tenant_id and branch_id = v_appointment.branch_id;

  insert into sales (
    tenant_id, branch_id, customer_id, folio, status,
    subtotal_cents, tax_cents, discount_cents, total_cents, paid_at, closed_by
  )
  values (
    v_appointment.tenant_id, v_appointment.branch_id, v_appointment.customer_id, v_folio, 'paid',
    0, 0, v_discount_cents, 0, now(), auth.uid()
  )
  returning id into v_sale_id;

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
  where aps.appointment_id = p_appointment_id and aps.deleted_at is null;

  perform app.add_product_items(v_sale_id, v_appointment.tenant_id, v_appointment.branch_id, p_products);
  perform app.finalize_sale(v_sale_id, v_appointment.tenant_id, v_discount_cents, p_payments);

  return v_sale_id;
end;
$$;

comment on function checkout_appointment(uuid, jsonb, integer, jsonb) is
  'Cobra una cita atendida (y, opcionalmente, productos del mostrador en el mismo ticket): crea la venta y sus partidas, baja la existencia, registra los pagos y valida que alcancen, todo en una transacción. Revalida membresía, sucursal y rol (SECURITY DEFINER salta RLS).';

grant execute on function checkout_appointment(uuid, jsonb, integer, jsonb) to authenticated;

-- ===========================================================================
-- 4. Venta de mostrador (sin cita)
-- ===========================================================================
-- Un cliente que solo compra un producto. Por ahora la venta pide un cliente
-- registrado (sales.customer_id es obligatorio); el "público en general" llega
-- con la factura global (tarea 11.20).
create function checkout_counter_sale(
  p_branch_id uuid,
  p_customer_id uuid,
  p_products jsonb,
  p_payments jsonb,
  p_discount_cents integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_branch branches;
  v_sale_id uuid;
  v_folio integer;
  v_discount_cents integer := coalesce(p_discount_cents, 0);
begin
  select * into v_branch from branches where id = p_branch_id and deleted_at is null and is_active;
  if not found then
    raise exception 'La sucursal no existe.' using errcode = 'no_data_found';
  end if;

  if not app.is_member_of(v_branch.tenant_id) then
    raise exception 'No perteneces a este negocio.' using errcode = 'insufficient_privilege';
  end if;

  if not app.can_access_branch(v_branch.id) then
    raise exception 'No tienes acceso a esta sucursal.' using errcode = 'insufficient_privilege';
  end if;

  if app.role_in(v_branch.tenant_id) not in ('owner', 'receptionist') then
    raise exception 'No tienes permiso para cobrar.' using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from customers where id = p_customer_id and tenant_id = v_branch.tenant_id and deleted_at is null
  ) then
    raise exception 'El cliente no existe.' using errcode = 'no_data_found';
  end if;

  if p_products is null or jsonb_array_length(p_products) = 0 then
    raise exception 'Agrega al menos un producto.' using errcode = 'check_violation';
  end if;

  if p_payments is null or jsonb_array_length(p_payments) = 0 then
    raise exception 'Debes registrar al menos un pago.' using errcode = 'check_violation';
  end if;

  if v_discount_cents < 0 then
    raise exception 'El descuento no puede ser negativo.' using errcode = 'check_violation';
  end if;

  select coalesce(max(folio), 0) + 1 into v_folio
  from sales
  where tenant_id = v_branch.tenant_id and branch_id = v_branch.id;

  insert into sales (
    tenant_id, branch_id, customer_id, folio, status,
    subtotal_cents, tax_cents, discount_cents, total_cents, paid_at, closed_by
  )
  values (
    v_branch.tenant_id, v_branch.id, p_customer_id, v_folio, 'paid',
    0, 0, v_discount_cents, 0, now(), auth.uid()
  )
  returning id into v_sale_id;

  perform app.add_product_items(v_sale_id, v_branch.tenant_id, v_branch.id, p_products);
  perform app.finalize_sale(v_sale_id, v_branch.tenant_id, v_discount_cents, p_payments);

  return v_sale_id;
end;
$$;

comment on function checkout_counter_sale(uuid, uuid, jsonb, jsonb, integer) is
  'Cobra una venta de mostrador (solo productos, sin cita). Misma transacción y revalidación que checkout_appointment().';

revoke execute on function checkout_counter_sale(uuid, uuid, jsonb, jsonb, integer) from public, anon;
grant execute on function checkout_counter_sale(uuid, uuid, jsonb, jsonb, integer) to authenticated;

-- ===========================================================================
-- 5. Cancelar una venta pagada devuelve la existencia
-- ===========================================================================
-- Es un trigger y no una RPC a propósito: sales ya permite UPDATE de status a
-- recepción/dueño, y un trigger cubre CUALQUIER camino (pantalla, script, panel).
-- Si fuera una RPC, un UPDATE directo cancelaría la venta sin devolver piezas.
--
-- Devuelve exactamente lo que salió: por cada producto, el neto de los
-- movimientos 'sale' y 'sale_reversal' de ESTA venta. Así no devuelve de más si
-- se ejecutara dos veces. Sin SECURITY DEFINER no podría insertar
-- 'sale_reversal' (la política de stock_movements solo deja compra/ajuste/merma).
create function app.restock_cancelled_sale()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into stock_movements (tenant_id, branch_id, product_id, movement_type, quantity, sale_id, created_by)
  select m.tenant_id, m.branch_id, m.product_id, 'sale_reversal', -sum(m.quantity)::integer, new.id,
         coalesce(auth.uid(), new.closed_by)
    from stock_movements m
   where m.sale_id = new.id and m.movement_type in ('sale', 'sale_reversal')
   group by m.tenant_id, m.branch_id, m.product_id
  having sum(m.quantity) < 0;

  return new;
end;
$$;

create trigger sales_restock_on_cancel
  after update of status on sales
  for each row
  when (old.status = 'paid' and new.status = 'cancelled')
  execute function app.restock_cancelled_sale();

revoke execute on function app.restock_cancelled_sale() from public, anon, authenticated;
