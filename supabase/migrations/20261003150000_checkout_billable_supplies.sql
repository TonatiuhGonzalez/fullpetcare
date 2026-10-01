-- Fase 11, tarea 11.14 (HMH Four #2043): los insumos cobrables de la consulta
-- pasan al ticket de cobro.
--
-- Qué cambia, todo aditivo:
--   1. sale_items.appointment_product_id: de qué línea de insumo viene la partida.
--   2. Un trigger garantiza que una línea se cobra UNA sola vez.
--   3. checkout_appointment() agrega al ticket los insumos cobrables de la cita,
--      SIN crear otro movimiento de stock (la pieza ya salió al registrarla).
--
-- Cancelar la venta NO devuelve estos insumos: el medicamento ya se aplicó. Es
-- así por construcción: el trigger de devolución (restock_cancelled_sale) solo
-- revierte los movimientos 'sale' de la venta, y el consumo se ligó a la línea
-- de la consulta, no a la venta.

alter table sale_items add column appointment_product_id uuid references appointment_products(id);

create index sale_items_appointment_product_idx on sale_items (appointment_product_id)
  where appointment_product_id is not null;

-- Una línea se cobra una sola vez, salvo que su venta se cancele (entonces la cita
-- se puede volver a cobrar, igual que checkout_appointment() ya permite). Por eso
-- no sirve un índice único simple: hay que mirar el estado de la venta. El candado
-- evita que dos cobros simultáneos de la misma cita pasen los dos la revisión.
-- SECURITY DEFINER: la revisión debe ver todas las ventas, aunque RLS le oculte
-- alguna a quien cobra; solo devuelve error o deja pasar.
create function app.check_sale_item_supply_once()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.appointment_product_id::text, 0));

  -- La línea debe ser de la misma cita y negocio que la partida.
  if not exists (
    select 1 from appointment_products ap
     where ap.id = new.appointment_product_id
       and ap.tenant_id = new.tenant_id
       and ap.appointment_id is not distinct from new.appointment_id
       and ap.deleted_at is null
  ) then
    raise exception 'El insumo no corresponde a esta cita.' using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from sale_items si
    join sales s on s.id = si.sale_id
     where si.appointment_product_id = new.appointment_product_id
       and si.deleted_at is null
       and s.status <> 'cancelled'
       and si.id <> new.id
  ) then
    raise exception 'Este insumo ya se cobró en otra venta.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger sale_items_supply_once
  before insert on sale_items
  for each row
  when (new.appointment_product_id is not null)
  execute function app.check_sale_item_supply_once();

revoke execute on function app.check_sale_item_supply_once() from public, anon, authenticated;

-- checkout_appointment(): mismo cuerpo que 20261003120100, más el paso de insumos.
create or replace function checkout_appointment(
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

  -- Insumos cobrables de la consulta (tarea 11.14). Se copian los snapshots de
  -- appointment_products (nombre, precio e IVA del día en que se registraron). NO
  -- se crea movimiento de stock: la pieza ya salió al registrarla (consumption).
  -- Los de uso interno (is_billable = false) no entran al ticket.
  insert into sale_items (
    tenant_id, sale_id, item_type, product_id, appointment_id, appointment_product_id,
    description, quantity, unit_price_cents, tax_rate_bp, tax_cents, line_total_cents
  )
  select
    ap.tenant_id,
    v_sale_id,
    'product',
    ap.product_id,
    p_appointment_id,
    ap.id,
    ap.name_snapshot,
    ap.quantity,
    ap.unit_price_cents,
    ap.tax_rate_bp,
    (ap.unit_price_cents * ap.quantity)
      - round(((ap.unit_price_cents * ap.quantity)::numeric * 10000) / (10000 + ap.tax_rate_bp))::integer,
    ap.unit_price_cents * ap.quantity
  from appointment_products ap
  where ap.appointment_id = p_appointment_id and ap.is_billable and ap.deleted_at is null;

  perform app.add_product_items(v_sale_id, v_appointment.tenant_id, v_appointment.branch_id, p_products);
  perform app.finalize_sale(v_sale_id, v_appointment.tenant_id, v_discount_cents, p_payments);

  return v_sale_id;
end;
$$;


grant execute on function checkout_appointment(uuid, jsonb, integer, jsonb) to authenticated;
