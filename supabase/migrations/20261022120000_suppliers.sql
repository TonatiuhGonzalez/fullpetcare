-- Fase 29B (PLAN.md D30, punto 4): catálogo de proveedores de insumos.
--
-- Solo CATÁLOGO (decisión del usuario): nombre, contacto, teléfono, correo, tipo y notas.
-- Sin órdenes de compra ni cuentas por pagar. Un producto puede tener VARIOS proveedores
-- (`product_suppliers`), y un proveedor surte varios productos.
--
-- Mismos permisos que Inventario (módulo `inventory`, §6.7): quien administra el inventario
-- administra a sus proveedores; cambiar quién entra es una fila de `role_permissions`.
--
-- Migración ADITIVA (§8.1): tablas nuevas y un índice único auxiliar sobre products.

-- Tipo de proveedor: los que mencionó el usuario (medicamento, alimento, accesorios) y
-- "otro" para no bloquear la captura.
create type supplier_type as enum ('medication', 'food', 'accessories', 'other');

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null check (length(btrim(name)) > 0),
  supplier_type supplier_type not null default 'other',
  -- Persona de contacto, teléfono y correo: texto libre y opcionales. La forma del correo y
  -- del teléfono la valida lib/validation.ts (mismo criterio que customers).
  contact_name text,
  phone text,
  email text,
  notes text,
  -- Desactivar oculta al proveedor de las listas para elegir sin perder su historial; es
  -- distinto de `deleted_at` (igual que products y product_categories).
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger suppliers_set_updated_at
  before update on suppliers
  for each row execute function app.set_updated_at();

create trigger suppliers_audit
  after insert or update or delete on suppliers
  for each row execute function app.log_change();

-- Bloquea escrituras cuando el negocio está suspendido o en solo lectura (§6.8).
create trigger enforce_tenant_writable
  before insert or update on suppliers
  for each row execute function app.enforce_tenant_writable();

create index suppliers_tenant_id_idx on suppliers (tenant_id);

-- El nombre no se repite DENTRO de un negocio (parcial: un proveedor oculto libera el suyo).
create unique index suppliers_tenant_name_key
  on suppliers (tenant_id, lower(btrim(name)))
  where deleted_at is null;

-- Llave para la llave foránea compuesta de product_suppliers: la base garantiza que un
-- vínculo no apunte al proveedor de OTRO negocio.
create unique index suppliers_tenant_id_id_key on suppliers (tenant_id, id);

-- Lo mismo del lado de products. Es un índice, no cambia la tabla ni sus datos.
create unique index products_tenant_id_id_key on products (tenant_id, id);

alter table suppliers enable row level security;
alter table suppliers force row level security;

-- Sin `deleted_at is null` en SELECT a propósito (trampa de §7.2: hay UPDATE para un rol
-- normal). El filtro vive en services/suppliers.ts.
create policy suppliers_select on suppliers for select
  to authenticated
  using (app.is_member_of(tenant_id) and app.has_permission(tenant_id, 'inventory', 'view'));

create policy suppliers_insert on suppliers for insert
  to authenticated
  with check (app.is_member_of(tenant_id) and app.has_permission(tenant_id, 'inventory', 'edit'));

create policy suppliers_update on suppliers for update
  to authenticated
  using (app.is_member_of(tenant_id) and app.has_permission(tenant_id, 'inventory', 'edit'))
  with check (app.is_member_of(tenant_id) and app.has_permission(tenant_id, 'inventory', 'edit'));

-- Sin política de DELETE (§7.3): se desactiva (`is_active`) o se oculta (`deleted_at`).

comment on table suppliers is
  'Catálogo de proveedores de insumos de un negocio (contacto, tipo y notas). Sin órdenes de compra.';

-- =============================================================================
-- product_suppliers: qué proveedores surten cada producto
-- =============================================================================
create table product_suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  product_id uuid not null,
  supplier_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- Ambos extremos del vínculo son del MISMO negocio que el vínculo.
  constraint product_suppliers_product_fkey
    foreign key (tenant_id, product_id) references products (tenant_id, id),
  constraint product_suppliers_supplier_fkey
    foreign key (tenant_id, supplier_id) references suppliers (tenant_id, id)
);

create trigger product_suppliers_set_updated_at
  before update on product_suppliers
  for each row execute function app.set_updated_at();

create trigger enforce_tenant_writable
  before insert or update on product_suppliers
  for each row execute function app.enforce_tenant_writable();

create index product_suppliers_tenant_product_idx on product_suppliers (tenant_id, product_id);
create index product_suppliers_tenant_supplier_idx on product_suppliers (tenant_id, supplier_id);

-- Un producto no repite al mismo proveedor (parcial: se puede quitar y volver a agregar).
create unique index product_suppliers_link_key
  on product_suppliers (tenant_id, product_id, supplier_id)
  where deleted_at is null;

alter table product_suppliers enable row level security;
alter table product_suppliers force row level security;

create policy product_suppliers_select on product_suppliers for select
  to authenticated
  using (app.is_member_of(tenant_id) and app.has_permission(tenant_id, 'inventory', 'view'));

create policy product_suppliers_insert on product_suppliers for insert
  to authenticated
  with check (app.is_member_of(tenant_id) and app.has_permission(tenant_id, 'inventory', 'edit'));

create policy product_suppliers_update on product_suppliers for update
  to authenticated
  using (app.is_member_of(tenant_id) and app.has_permission(tenant_id, 'inventory', 'edit'))
  with check (app.is_member_of(tenant_id) and app.has_permission(tenant_id, 'inventory', 'edit'));

comment on table product_suppliers is
  'Vínculo producto-proveedor: un producto puede tener varios proveedores.';
