-- Catálogo de productos del negocio (fase 11, tarea 11.3 / HMH Four #2038).
--
-- Hasta hoy el sistema solo vende servicios. Un producto es lo que el negocio
-- vende "de mostrador": alimento, accesorios, medicamento. Esta migración solo
-- crea el CATÁLOGO. Las existencias (stock_movements, 11.5) y la venta en el
-- cobro (sale_items, 11.10) llegan en migraciones propias, aditivas.
--
-- Mismas reglas de siempre (CLAUDE.md §8): precio entero en centavos con IVA
-- incluido, tasa en basis points, borrado suave, sin política de DELETE.
create table products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null check (length(btrim(name)) > 0),
  -- Código interno del negocio (SKU o código de barras). Opcional: un negocio
  -- chico puede no usarlo. Si se captura, no se repite (índice único de abajo).
  sku text check (sku is null or length(btrim(sku)) > 0),
  -- IVA incluido, como services.price_cents (CLAUDE.md §8.2): es lo que paga
  -- el cliente; el ticket desglosa hacia atrás. Entero en centavos, nunca float.
  price_cents integer not null check (price_cents >= 0),
  -- Basis points: 1600 = 16.00 %. Default 16 %; 0 es válido (tasa 0).
  tax_rate_bp integer not null default 1600 check (tax_rate_bp >= 0),
  -- Costo de compra, opcional (para margen a futuro). Mismo criterio de dinero.
  cost_cents integer check (cost_cents is null or cost_cents >= 0),
  -- Cantidad mínima deseada en existencia: con `existencia <= min_stock` la
  -- pantalla avisa "stock bajo" (decisión #2 de la fase). Entero, sin decimales
  -- (decisión #6: lo suelto se maneja como presentación).
  min_stock integer not null default 0 check (min_stock >= 0),
  -- Claves del SAT para facturar (ver services_sat_codes.sql). Mismo criterio:
  -- NOT NULL + DEFAULT, el negocio las edita con su contador; la base solo
  -- valida la FORMA, no que existan en el catálogo.
  --   01010101 = "No existe en el catálogo" (clave genérica oficial del SAT):
  --              es lo más honesto como sugerencia, porque un producto de
  --              mostrador puede ser cualquier cosa.
  --   H87      = "Pieza".
  -- PENDIENTE antes de producción: que un contador confirme estos defaults.
  sat_product_code text not null default '01010101' check (sat_product_code ~ '^[0-9]{8}$'),
  sat_unit_code text not null default 'H87' check (sat_unit_code ~ '^[A-Z0-9]{2,3}$'),
  -- is_active es DISTINTO de deleted_at (igual que en services): un producto
  -- inactivo sigue existiendo —las ventas viejas conservan su historial— pero
  -- ya no se ofrece. deleted_at es para "se dio de alta por error".
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger products_set_updated_at
  before update on products
  for each row execute function app.set_updated_at();

-- Bloquea escrituras cuando el negocio está suspendido/solo lectura (§6.8).
-- Un test (tenant-blocking.spec.ts) falla si una tabla con tenant_id lo omite.
create trigger enforce_tenant_writable
  before insert or update on products
  for each row execute function app.enforce_tenant_writable();

create index products_tenant_id_idx on products (tenant_id);

-- El código interno no se repite DENTRO de un negocio (dos negocios sí pueden
-- usar el mismo). Es parcial: ignora productos sin código y los borrados, para
-- poder reutilizar el código de uno dado de alta por error. lower() evita que
-- "AL-01" y "al-01" cuenten como distintos.
create unique index products_tenant_sku_key
  on products (tenant_id, lower(sku))
  where sku is not null and deleted_at is null;

alter table products enable row level security;
alter table products force row level security;

-- LECTURA: miembro del negocio CON permiso 'inventory'/'view'. Un groomer no
-- lo tiene (decisión de la fase), así que no ve ni el catálogo: lo decide esta
-- política, no un v-if. Sin `deleted_at is null` a propósito (trampa de
-- CLAUDE.md §7.2): hay UPDATE para un rol normal, y el filtro de borrado suave
-- vive en la capa de servicios.
create policy products_select on products for select
  to authenticated
  using (app.is_member_of(tenant_id) and app.has_permission(tenant_id, 'inventory', 'view'));

-- ESCRITURA: permiso 'inventory'/'edit'. Nunca "owner" a secas (CLAUDE.md §7.2):
-- cambiar quién puede es una fila de role_permissions, no otra migración.
create policy products_insert on products for insert
  to authenticated
  with check (app.is_member_of(tenant_id) and app.has_permission(tenant_id, 'inventory', 'edit'));

create policy products_update on products for update
  to authenticated
  using (app.is_member_of(tenant_id) and app.has_permission(tenant_id, 'inventory', 'edit'))
  with check (app.is_member_of(tenant_id) and app.has_permission(tenant_id, 'inventory', 'edit'));

-- Sin política de DELETE (CLAUDE.md §7.3): desactivar es UPDATE de is_active y
-- el borrado suave es UPDATE de deleted_at; ambos los cubre products_update.

comment on table products is
  'Catálogo de productos de mostrador del negocio. Precio con IVA incluido en centavos. Existencias en stock_movements (tarea 11.5).';

-- Permisos por defecto del módulo en los negocios que YA existen (decisión de
-- la fase): dueño todo, recepción ver y editar, veterinario solo ver, groomer
-- nada. Sin esto, en producción solo el dueño vería Inventario hasta que
-- alguien sembrara las filas a mano. Los negocios nuevos desde la semilla las
-- traen en seed.sql. `on conflict do nothing` hace la migración repetible.
insert into role_permissions (tenant_id, role, module, can_view, can_edit)
select t.id, r.role, 'inventory', r.can_view, r.can_edit
from tenants t
cross join (values
  ('owner'::member_role, true, true),
  ('receptionist'::member_role, true, true),
  ('groomer'::member_role, false, false),
  ('vet'::member_role, true, false)
) as r(role, can_view, can_edit)
on conflict (tenant_id, role, module) do nothing;
