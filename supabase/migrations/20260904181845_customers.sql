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
-- Índice de búsqueda por nombre y teléfono
-- =============================================================================
-- La búsqueda de la tarea 2.9 (`services/customers.ts`, método `search`)
-- es del tipo "empieza con lo que escribiste", contra first_name O
-- last_name por separado (así "cruz" encuentra a alguien con ese
-- apellido, y "val" encuentra a alguien con ese nombre) — PostgREST (la
-- API que genera Supabase) arma esa consulta como dos condiciones
-- `ilike` unidas con OR, una por columna, así que el índice tiene que
-- calzar con columnas reales, no con una expresión combinada como
-- "first_name || ' ' || last_name" que la API nunca va a poder pedir
-- directo sin una función de base de datos aparte (RPC) — y eso es más
-- pieza de la que hace falta para el volumen de datos de un demo (unas
-- decenas de clientes por tenant: hasta una búsqueda sin índice es
-- instantánea).
--
-- Por eso este índice es solo un btree normal sobre (tenant_id,
-- first_name, last_name): ayuda al ORDER BY de "list" (tarea 2.9) y dado
-- que empieza por tenant_id, cumple la regla general (CLAUDE.md §6). No
-- se optimiza más allá de eso — si el volumen de datos creciera de
-- verdad, ahí sí valdría la pena revisar pg_trgm.
create index customers_tenant_name_idx on customers (tenant_id, first_name, last_name);

-- Búsqueda por teléfono: mismo criterio de "no sobre-optimizar para el
-- tamaño de un demo" — un índice normal alcanza.
create index customers_tenant_phone_idx on customers (tenant_id, phone);

alter table customers enable row level security;
alter table customers force row level security;

-- Cualquier miembro activo del tenant puede VER los clientes — un
-- groomer o un vet necesitan saber de quién es la mascota que están
-- atendiendo, aunque ellos no den de alta clientes nuevos.
--
-- A propósito SIN "and deleted_at is null" (a diferencia del patrón de
-- CLAUDE.md §7.2 y de las tablas de tenencia de la fase 1): Postgres
-- exige que la fila RESULTANTE de un UPDATE siga pasando la política de
-- SELECT de la tabla, sin importar qué diga el "with check" de la
-- política de UPDATE. Si esta política filtrara "deleted_at is null",
-- el borrado suave (`update ... set deleted_at = now()`, hecho por
-- owner/receptionist vía customers_update de abajo) fallaría siempre con
-- "new row violates row-level security policy" — la fila, después de
-- marcarse borrada, dejaría de ser "seleccionable" y Postgres rechaza la
-- escritura completa, no solo esconde la fila después. Ocurrió de
-- verdad al escribir esta migración: quitar la condición de aquí lo
-- resuelve. RLS sigue protegiendo lo importante (aislamiento entre
-- tenants, vía is_member_of); esconder los borrados suaves de las
-- listas es trabajo de la capa de servicios (`.is('deleted_at', null)`
-- explícito en cada `select` de `services/customers.ts`), no de esta
-- política.
create policy customers_select on customers for select
  to authenticated
  using (app.is_member_of(tenant_id));

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
