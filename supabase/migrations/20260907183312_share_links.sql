-- Tabla share_links: el link público de una mascota (CLAUDE.md §6.6, §7.4).
-- Guarda solo el HASH del token, nunca el token en claro — ver el
-- comentario completo de por qué en services/shareLinks.ts (tarea 7.2).
--
-- "scope" acepta 'pet' y 'customer' porque así lo define el modelo de
-- datos del proyecto (CLAUDE.md §6.6), pero v1 solo genera links de
-- scope 'pet' (tarea 7.14, botón en PetDetailPage.vue) — el check de
-- abajo ya deja la puerta cerrada para cualquier otra combinación
-- inconsistente (un link "de mascota" sin pet_id, por ejemplo), sin
-- construir todavía la mitad de UI que 'customer' necesitaría.
create type share_link_scope as enum ('pet', 'customer');

create table share_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  scope share_link_scope not null,
  pet_id uuid references pets(id),
  customer_id uuid references customers(id),
  -- SHA-256 en hex (64 caracteres) del token de 32 bytes aleatorios — el
  -- token en sí NUNCA se guarda (tarea 7.2). unique: un hash repetido
  -- significaría el mismo token dos veces, prácticamente imposible con
  -- 32 bytes al azar, pero la restricción no cuesta nada y documenta la
  -- intención.
  token_hash text not null unique,
  -- Los primeros caracteres del token en claro (no el hash) — para que
  -- la lista de "links activos" de una mascota (tarea 7.14) pueda
  -- mostrar algo como "a1B2..." y distinguir un link de otro sin poder
  -- reconstruir el token completo con eso.
  token_prefix text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id),
  access_count integer not null default 0,
  last_accessed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (
    (scope = 'pet' and pet_id is not null and customer_id is null)
    or
    (scope = 'customer' and customer_id is not null and pet_id is null)
  )
);

create trigger share_links_set_updated_at
  before update on share_links
  for each row execute function app.set_updated_at();

create trigger share_links_audit
  after insert or update or delete on share_links
  for each row execute function app.log_change();

-- Para "los links de esta mascota" (tarea 7.14) y para que la Edge
-- Function (tarea 7.4) encuentre un token por su hash rápido.
create index share_links_tenant_pet_idx on share_links (tenant_id, pet_id);

alter table share_links enable row level security;
alter table share_links force row level security;

-- Sin "and deleted_at is null" (misma trampa de siempre, CLAUDE.md §7.2):
-- esta tabla tiene UPDATE para un rol autenticado (revocar un link).
--
-- Cualquier miembro activo del tenant puede generar, ver y revocar
-- links — CLAUDE.md §6.1 no restringe esto a un rol en particular, y
-- generar el link de una mascota es parte de atenderla, sin importar
-- quién la atendió.
create policy share_links_select on share_links for select
  to authenticated
  using (app.is_member_of(tenant_id));

create policy share_links_insert on share_links for insert
  to authenticated
  with check (app.is_member_of(tenant_id));

-- UPDATE es solo para revocar (poner revoked_at) — la app nunca cambia
-- el token_hash ni el scope de un link ya creado.
create policy share_links_update on share_links for update
  to authenticated
  using (app.is_member_of(tenant_id))
  with check (app.is_member_of(tenant_id));

-- Sin política de DELETE (CLAUDE.md §7.3): un link se revoca
-- (`revoked_at`), nunca se borra — así queda registro de que existió,
-- para quien audite después "quién compartió qué y cuándo".
--
-- El rol `anon` no tiene NINGUNA política aquí — ni siquiera puede
-- verificar si un token existe. La vista pública nunca consulta esta
-- tabla directo; pasa por la Edge Function public-pet-view (tarea 7.4),
-- que sí la lee, pero con `service_role` (que bypasea RLS por diseño,
-- no por un permiso que se le dé a `anon`).
