-- Venta libre (fase 13, tarea 13.2 / PLAN.md D18): una venta de mostrador ya no
-- exige un cliente registrado. Quien compra un shampoo al paso no tiene por qué
-- estar en el catálogo de clientes.
--
-- Dos cambios, ambos aditivos (CLAUDE.md §8.1):
--   1. sales.customer_id admite NULL. Es relajar una restricción: ninguna fila
--      existente cambia y todas las ventas de citas siguen teniendo cliente.
--   2. checkout_counter_sale() acepta p_customer_id NULL. Mismo nombre y misma
--      firma, así que CREATE OR REPLACE conserva los permisos (revoke/grant) de
--      la migración que la creó (20261003120100); aquí solo cambia la validación.
--
-- Qué NO cambia: checkout_appointment() sigue copiando el cliente de la cita
-- (una cita siempre lo tiene), y las políticas de RLS de sales no miran el
-- cliente (miran tenant y sucursal), así que no hay que tocarlas.
--
-- Revisado antes de relajar la columna: los reportes (report_*), la caja
-- (cash_session_overview), app.finalize_sale / add_product_items y la Edge
-- Function de facturación NO leen sales.customer_id, así que una venta sin
-- cliente cae en ellos igual que cualquier otra. Lo que sí lo lee está en la
-- interfaz (ticket y detalle de venta) y se ajusta en esta misma tarea.

alter table sales alter column customer_id drop not null;

comment on column sales.customer_id is
  'Cliente de la venta. NULL en una venta de mostrador sin cliente registrado (fase 13); las ventas de cita siempre lo llevan.';

create or replace function checkout_counter_sale(
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

  -- El cliente es opcional, pero si llega debe ser de ESTE negocio y no estar
  -- borrado: SECURITY DEFINER salta RLS, así que sin esta revisión se podría
  -- ligar una venta al cliente de otro negocio (§7.3, regla 4).
  if p_customer_id is not null and not exists (
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
  'Cobra una venta de mostrador (solo productos, sin cita). El cliente es opcional (NULL = venta libre). Misma transacción y revalidación que checkout_appointment().';
