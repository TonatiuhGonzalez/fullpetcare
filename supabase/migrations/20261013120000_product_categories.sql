-- Categorías de producto (fase 13, extensión 13G; PLAN.md D18 punto 7).
--
-- Agrupan el catálogo en el punto de venta: cada negocio crea las suyas (nombre + ícono)
-- desde Inventario. Un producto puede no tener categoría (category_id nulo): el punto de
-- venta los junta en una tarjeta "Sin categoría".
--
-- Migración ADITIVA (§8.1): tabla nueva y una columna nullable en products; no cambia nada
-- de lo que ya funciona.

create table product_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null check (length(btrim(name)) > 0),
  -- Nombre de un ícono de Material Design (p. ej. 'mdi-bone'). La base solo valida la
  -- FORMA; la lista de íconos permitidos es la curada de lib/productCategories.ts.
  icon text not null check (icon ~ '^mdi-[a-z0-9-]+$'),
  -- is_active distinto de deleted_at, igual que en products: desactivar oculta la
  -- categoría en el punto de venta sin tocar sus productos, que pasan a "Sin categoría".
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger product_categories_set_updated_at
  before update on product_categories
  for each row execute function app.set_updated_at();

-- Bloquea escrituras cuando el negocio está suspendido o en solo lectura (§6.8).
create trigger enforce_tenant_writable
  before insert or update on product_categories
  for each row execute function app.enforce_tenant_writable();

create index product_categories_tenant_id_idx on product_categories (tenant_id);

-- El nombre no se repite DENTRO de un negocio (dos negocios sí pueden tener "Juguetes").
-- Parcial: ignora las ocultas, para poder reutilizar un nombre.
create unique index product_categories_tenant_name_key
  on product_categories (tenant_id, lower(btrim(name)))
  where deleted_at is null;

-- Necesario para la llave foránea compuesta de products (abajo).
create unique index product_categories_tenant_id_id_key
  on product_categories (tenant_id, id);

alter table product_categories enable row level security;
alter table product_categories force row level security;

-- Mismos permisos que products (módulo 'inventory'). Sin `deleted_at is null` en SELECT a
-- propósito (trampa de §7.2): hay UPDATE para un rol normal.
create policy product_categories_select on product_categories for select
  to authenticated
  using (app.is_member_of(tenant_id) and app.has_permission(tenant_id, 'inventory', 'view'));

create policy product_categories_insert on product_categories for insert
  to authenticated
  with check (app.is_member_of(tenant_id) and app.has_permission(tenant_id, 'inventory', 'edit'));

create policy product_categories_update on product_categories for update
  to authenticated
  using (app.is_member_of(tenant_id) and app.has_permission(tenant_id, 'inventory', 'edit'))
  with check (app.is_member_of(tenant_id) and app.has_permission(tenant_id, 'inventory', 'edit'));

-- Sin política de DELETE (§7.3): desactivar es UPDATE de is_active; ocultar, de deleted_at.

comment on table product_categories is
  'Categorías de producto de cada negocio (nombre + ícono) para agrupar el catálogo en el punto de venta.';

-- La categoría del producto. Llave compuesta (tenant_id, category_id): la base garantiza que
-- un producto no apunte a la categoría de OTRO negocio, aunque alguien lo intente por la API.
-- Con category_id nulo la llave no se evalúa (MATCH SIMPLE).
alter table products add column category_id uuid;
alter table products
  add constraint products_category_fkey
  foreign key (tenant_id, category_id) references product_categories (tenant_id, id);

create index products_category_id_idx on products (tenant_id, category_id);
