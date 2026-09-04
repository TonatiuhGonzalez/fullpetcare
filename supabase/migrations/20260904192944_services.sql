-- Tabla services: el catálogo (CLAUDE.md §6.3). "kind" separa estética
-- de veterinaria — una cita es de un solo tipo (§6.3), así que el
-- catálogo también se divide desde aquí, no se decide después.
create type service_kind as enum ('grooming', 'veterinary');

create table services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  kind service_kind not null,
  name text not null,
  duration_minutes integer not null check (duration_minutes > 0),
  price_cents integer not null check (price_cents >= 0),
  -- Basis points: 1600 = 16.00% (CLAUDE.md §6.3, §8.2 — nunca decimales
  -- para dinero ni para tasas). check (>= 0) nada más: 0 es válido (un
  -- servicio exento, p. ej. una revisión de cortesía).
  tax_rate_bp integer not null check (tax_rate_bp >= 0),
  -- is_active es DISTINTO de deleted_at: un servicio inactivo sigue
  -- existiendo (las citas viejas que lo usaron conservan su nombre y
  -- precio vía *_snapshot, CLAUDE.md §6.3) pero ya no aparece para
  -- agendar uno nuevo. deleted_at es para el caso raro de "esto se dio
  -- de alta por error y nunca se usó".
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger services_set_updated_at
  before update on services
  for each row execute function app.set_updated_at();

create index services_tenant_id_idx on services (tenant_id);

-- Para "listByKind" (tarea 3.8): el catálogo casi siempre se pide ya
-- separado en estética/veterinaria (tarea 3.16, pestañas).
create index services_tenant_kind_idx on services (tenant_id, kind);

alter table services enable row level security;
alter table services force row level security;

-- Sin "and deleted_at is null" (misma trampa documentada en CLAUDE.md
-- §7.2 y en customers.sql): esta tabla sí tendrá UPDATE para un rol
-- autenticado (owner, abajo), así que el filtro de borrado suave vive
-- en la capa de servicios, no en la política.
--
-- Cualquier miembro activo puede LEER el catálogo (todos los roles
-- necesitan ver qué servicios existen para agendar una cita), pero solo
-- "owner" puede darlo de alta, editarlo o desactivarlo — es
-- configuración del negocio, no una tarea operativa del día a día
-- (CLAUDE.md §6.1 no le da esto a receptionist/groomer/vet).
create policy services_select on services for select
  to authenticated
  using (app.is_member_of(tenant_id));

create policy services_insert on services for insert
  to authenticated
  with check (app.is_member_of(tenant_id) and app.role_in(tenant_id) = 'owner');

create policy services_update on services for update
  to authenticated
  using (app.is_member_of(tenant_id) and app.role_in(tenant_id) = 'owner')
  with check (app.is_member_of(tenant_id) and app.role_in(tenant_id) = 'owner');

-- Sin política de DELETE (CLAUDE.md §7.3): "deactivate" es un UPDATE de
-- is_active, y el borrado (si hiciera falta) es suave vía deleted_at,
-- ambos cubiertos por services_update.
