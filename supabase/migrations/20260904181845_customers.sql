-- Tabla customers (CLAUDE.md §6.2): la persona dueña de las mascotas. Los
-- campos CFDI están desde ahora aunque no se facture nada en v1
-- (CLAUDE.md §8.4) — así, cuando llegue facturación real, no hace falta
-- una migración que altere una tabla ya en uso con datos reales.
create table customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  first_name text not null,
  last_name text not null,
  phone text,
  email text,
  notes text,
  -- Campos CFDI. Todos nullable salvo requires_invoice: la mayoría de los
  -- clientes de un demo de estética/veterinaria NUNCA piden factura, así
  -- que obligar el RFC de entrada sería pedir un dato que casi nadie va
  -- a dar. requires_invoice es el que decide si la UI (tarea 2.17) los
  -- muestra como obligatorios.
  rfc text,
  legal_name text,
  tax_regime_code text,
  cfdi_use text,
  postal_code text,
  requires_invoice boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger customers_set_updated_at
  before update on customers
  for each row execute function app.set_updated_at();

-- Auditoría (CLAUDE.md §8.6): customers guarda datos personales del
-- cliente (incluido su RFC si factura), así que cada cambio queda en
-- audit_log igual que el expediente clínico — quién lo cambió y qué
-- valores tenía antes/después.
create trigger customers_audit
  after insert or update or delete on customers
  for each row execute function app.log_change();

-- Índice base: toda consulta a esta tabla debe empezar filtrando por
-- tenant_id (CLAUDE.md §6).
create index customers_tenant_id_idx on customers (tenant_id);

-- =============================================================================
-- Índice de búsqueda por nombre: por qué "text_pattern_ops"
-- =============================================================================
-- La búsqueda de la tarea 2.9 (`services/customers.ts`, método `search`)
-- es del tipo "empieza con lo que escribiste" — `where nombre ilike
-- 'mar%'`, no "contiene en cualquier parte" (para eso se necesitaría la
-- extensión pg_trgm, que este proyecto decidió no agregar todavía por
-- mantenerlo simple — CLAUDE.md §3, "ninguna dependencia nueva sin
-- justificarla").
--
-- Un índice btree normal (el que crea `create index` por default) SÍ
-- acelera `= 'valor exacto'`, pero NO acelera `like 'valor%'` cuando la
-- base de datos usa un "collation" que no es "C" (el orden de texto
-- "consciente del idioma", que es el default en Supabase/Postgres para
-- que ORDER BY ordene bien los acentos en español) — con ese collation,
-- Postgres no puede asumir que las filas que empiezan igual quedan
-- juntas en el índice. "text_pattern_ops" es una variante del operador
-- de comparación de texto que SÍ ordena byte a byte (como "C"), y con
-- ESA variante el índice vuelve a servir para acelerar un `like 'algo%'`.
-- Es puramente una decisión de rendimiento, no cambia qué filas
-- devuelve la consulta.
--
-- Se busca por "nombre completo" (first_name || ' ' || last_name) para
-- que un usuario pueda escribir "juan perez" y encontrarlo, no solo
-- buscando por first_name o por last_name por separado. lower() hace
-- la búsqueda insensible a mayúsculas.
create index customers_tenant_name_idx
  on customers (tenant_id, lower(first_name || ' ' || last_name) text_pattern_ops);

-- Búsqueda por teléfono: mismo criterio (empieza con), pero sin
-- necesidad de "text_pattern_ops" porque un teléfono se compara tal cual
-- se guarda (sin collation de idioma de por medio en la práctica — son
-- solo dígitos, CLAUDE.md §5.2 dice que se validan a 10 dígitos en
-- lib/validation.ts) y no se hace lower() sobre números.
create index customers_tenant_phone_idx on customers (tenant_id, phone);

alter table customers enable row level security;
alter table customers force row level security;

-- Cualquier miembro activo del tenant puede VER los clientes — un
-- groomer o un vet necesitan saber de quién es la mascota que están
-- atendiendo, aunque ellos no den de alta clientes nuevos.
create policy customers_select on customers for select
  to authenticated
  using (app.is_member_of(tenant_id) and deleted_at is null);

-- Solo owner y receptionist pueden dar de alta o editar clientes
-- (CLAUDE.md §6.1: "receptionist ... Clientes, mascotas, agenda, cobro").
-- groomer y vet quedan fuera a propósito.
create policy customers_insert on customers for insert
  to authenticated
  with check (
    app.is_member_of(tenant_id)
    and app.role_in(tenant_id) in ('owner', 'receptionist')
  );

create policy customers_update on customers for update
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and app.role_in(tenant_id) in ('owner', 'receptionist')
  )
  with check (
    app.is_member_of(tenant_id)
    and app.role_in(tenant_id) in ('owner', 'receptionist')
  );

-- Sin política de DELETE (CLAUDE.md §7.3): el borrado es siempre suave,
-- vía `update ... set deleted_at = now()` — que sí cae bajo la política
-- de UPDATE de arriba.
