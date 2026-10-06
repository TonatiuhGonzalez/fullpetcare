-- Fase 11, tarea 11.12 (HMH Four #2042): insumos y medicamentos usados en una
-- consulta veterinaria.
--
-- Mientras el vet atiende registra qué se usó (vacuna, medicamento, material).
-- Cada línea baja la existencia AL REGISTRARSE (movimiento 'consumption') y la
-- regresa si la quita ('consumption_reversal'). La línea puede ser cobrable al
-- cliente (`is_billable`) o de uso interno. Pasar las cobrables al ticket es la
-- tarea 11.14; aquí solo se registran.
--
-- Escritura SOLO por RPC. No hay política de INSERT/UPDATE para usuarios: una
-- línea sin su movimiento de stock (o un movimiento sin su línea) dejaría el
-- inventario descuadrado, y por RPC las dos cosas ocurren en la misma
-- transacción. Es más estricto que "RLS que deja escribir a owner y vet": solo
-- ellos pasan la RPC, y además no hay forma de saltársela.

create table appointment_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  appointment_id uuid not null references appointments(id),
  product_id uuid not null references products(id),
  -- Snapshots, igual que appointment_services (CLAUDE.md §6.3): si el producto
  -- cambia de precio o de IVA después, esta línea conserva lo de ese día.
  name_snapshot text not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  tax_rate_bp integer not null check (tax_rate_bp >= 0),
  quantity integer not null check (quantity > 0),
  -- true: se cobra al cliente (pasará al ticket en 11.14). false: uso interno.
  is_billable boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Quitar una línea la oculta (con su movimiento inverso); no se borra.
  deleted_at timestamptz
);

create trigger appointment_products_set_updated_at
  before update on appointment_products
  for each row execute function app.set_updated_at();

create trigger enforce_tenant_writable
  before insert or update on appointment_products
  for each row execute function app.enforce_tenant_writable();

create trigger appointment_products_audit
  after insert or update or delete on appointment_products
  for each row execute function app.log_change();

create index appointment_products_tenant_appointment_idx
  on appointment_products (tenant_id, appointment_id);

alter table appointment_products enable row level security;
alter table appointment_products force row level security;

-- LECTURA: sigue a la cita, como appointment_services (si no ves la cita, por
-- sucursal, tampoco sus insumos). Sin UPDATE para usuarios, así que aquí SÍ se
-- puede filtrar `deleted_at is null` sin caer en la trampa de CLAUDE.md §7.2.
create policy appointment_products_select on appointment_products for select
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and deleted_at is null
    and exists (
      select 1 from appointments a
      where a.id = appointment_products.appointment_id
        and app.can_access_branch(a.branch_id)
    )
  );
-- Sin política de INSERT, UPDATE ni DELETE (ver cabecera): solo las RPC.

comment on table appointment_products is
  'Insumos y medicamentos usados en una consulta veterinaria. Se escribe solo por RPC, que mueve la existencia en la misma transacción.';

-- La bitácora de stock apunta a la línea que originó el movimiento (consumo y su
-- reverso). Columna nueva y nullable: aditiva, no toca movimientos existentes.
alter table stock_movements add column appointment_product_id uuid references appointment_products(id);
create index stock_movements_appointment_product_idx on stock_movements (appointment_product_id)
  where appointment_product_id is not null;

-- ===========================================================================
-- Validación común de las dos RPC
-- ===========================================================================
-- SECURITY DEFINER salta RLS, así que aquí se revalida a mano (CLAUDE.md §7.3.4):
-- negocio, sucursal, rol (solo dueño y veterinario), tipo de cita y que no esté
-- cobrada ni cancelada.
create function app.appointment_for_consumption(p_appointment_id uuid)
returns appointments
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_appointment appointments;
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

  if app.role_in(v_appointment.tenant_id) not in ('owner', 'vet') then
    raise exception 'No tienes permiso para registrar insumos de una consulta.' using errcode = 'insufficient_privilege';
  end if;

  if v_appointment.kind <> 'veterinary' then
    raise exception 'Solo las consultas veterinarias llevan insumos.' using errcode = 'check_violation';
  end if;

  if v_appointment.status in ('cancelled', 'no_show') then
    raise exception 'La cita está cancelada.' using errcode = 'check_violation';
  end if;

  -- Misma condición que "ya fue cobrada" en checkout_appointment().
  if exists (
    select 1 from sale_items si
    join sales s on s.id = si.sale_id
    where si.appointment_id = p_appointment_id
      and si.deleted_at is null
      and s.status <> 'cancelled'
  ) then
    raise exception 'La cita ya fue cobrada: no admite cambios en sus insumos.' using errcode = 'check_violation';
  end if;

  return v_appointment;
end;
$$;

revoke execute on function app.appointment_for_consumption(uuid) from public, anon, authenticated;

-- ===========================================================================
-- add_appointment_product(): registra un insumo y baja la existencia
-- ===========================================================================
create function add_appointment_product(
  p_appointment_id uuid,
  p_product_id uuid,
  p_quantity integer,
  p_is_billable boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_appointment appointments;
  v_product products;
  v_stock integer;
  v_line_id uuid;
begin
  v_appointment := app.appointment_for_consumption(p_appointment_id);

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La cantidad debe ser mayor a cero.' using errcode = 'check_violation';
  end if;

  -- Del mismo negocio, activo y no borrado (esta función salta RLS).
  select * into v_product
    from products
   where id = p_product_id
     and tenant_id = v_appointment.tenant_id
     and deleted_at is null
     and is_active;
  if not found then
    raise exception 'El producto no existe o no está disponible.' using errcode = 'no_data_found';
  end if;

  select coalesce(sum(quantity), 0)::integer into v_stock
    from stock_movements
   where tenant_id = v_appointment.tenant_id
     and branch_id = v_appointment.branch_id
     and product_id = v_product.id;
  if v_stock <= 0 then
    raise exception 'El producto "%" no tiene existencia.', v_product.name using errcode = 'check_violation';
  end if;

  insert into appointment_products (
    tenant_id, appointment_id, product_id, name_snapshot, unit_price_cents, tax_rate_bp,
    quantity, is_billable, created_by
  )
  values (
    v_appointment.tenant_id, p_appointment_id, v_product.id, v_product.name, v_product.price_cents,
    v_product.tax_rate_bp, p_quantity, coalesce(p_is_billable, true), auth.uid()
  )
  returning id into v_line_id;

  -- Si no alcanza, el trigger de stock_movements lanza y se deshace TODO (la línea
  -- incluida): nunca queda una línea sin su descuento.
  insert into stock_movements (
    tenant_id, branch_id, product_id, movement_type, quantity, appointment_product_id, created_by
  )
  values (
    v_appointment.tenant_id, v_appointment.branch_id, v_product.id, 'consumption', -p_quantity,
    v_line_id, auth.uid()
  );

  return v_line_id;
end;
$$;

comment on function add_appointment_product(uuid, uuid, integer, boolean) is
  'Registra un insumo usado en una consulta veterinaria y baja la existencia en la misma transacción. Solo dueño y veterinario.';

-- ===========================================================================
-- remove_appointment_product(): quita la línea y regresa la existencia
-- ===========================================================================
create function remove_appointment_product(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_line appointment_products;
  v_appointment appointments;
  v_consumed integer;
begin
  select * into v_line from appointment_products where id = p_line_id and deleted_at is null;
  if not found then
    raise exception 'La línea no existe.' using errcode = 'no_data_found';
  end if;

  v_appointment := app.appointment_for_consumption(v_line.appointment_id);

  update appointment_products set deleted_at = now() where id = p_line_id;

  -- Regresa lo que esa línea sacó (neto de sus movimientos, igual que el reverso
  -- de una venta): exacto aunque la línea tuviera más de un movimiento.
  select -coalesce(sum(quantity), 0)::integer into v_consumed
    from stock_movements
   where appointment_product_id = p_line_id;

  if v_consumed > 0 then
    insert into stock_movements (
      tenant_id, branch_id, product_id, movement_type, quantity, appointment_product_id, created_by
    )
    values (
      v_line.tenant_id, v_appointment.branch_id, v_line.product_id, 'consumption_reversal',
      v_consumed, p_line_id, auth.uid()
    );
  end if;
end;
$$;

comment on function remove_appointment_product(uuid) is
  'Quita un insumo de una consulta y devuelve la existencia exacta. Solo dueño y veterinario; no en citas cobradas.';

revoke execute on function add_appointment_product(uuid, uuid, integer, boolean) from public, anon;
revoke execute on function remove_appointment_product(uuid) from public, anon;
grant execute on function add_appointment_product(uuid, uuid, integer, boolean) to authenticated;
grant execute on function remove_appointment_product(uuid) to authenticated;
