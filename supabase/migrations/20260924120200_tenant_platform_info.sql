-- Fase 10: lo que la PLATAFORMA sabe de cada negocio y el negocio no debe
-- ver — plan, estado (activo/suspendido/de baja) y notas internas.
--
-- =============================================================================
-- Por qué NO son columnas de `tenants`
-- =============================================================================
-- `tenants_select` deja leer la fila a CUALQUIER miembro del negocio
-- (`app.is_member_of(id)`), y RLS filtra FILAS, no columnas: un
-- `select * from tenants` de un groomer devolvería también las notas
-- internas que el superadmin escribió sobre ese negocio. Una tabla aparte,
-- con su propia política que solo abre la puerta a superadmins, resuelve
-- eso de raíz sin depender de que ningún `select` del frontend se acuerde
-- de omitir una columna.
--
-- Qué NO se duplica aquí (ya existe, y una segunda copia se desincroniza):
--   - Fecha de alta de la empresa  → `tenants.created_at`
--   - Nombre del dueño             → `profiles.full_name` del `membership`
--                                    con role = 'owner' de este tenant
--   - Teléfono del dueño           → `profiles.phone` (misma fila)
--   - Correo del dueño             → `auth.users.email`; solo lo puede leer
--                                    una RPC SECURITY DEFINER de plataforma
--                                    (tarea 10.3), nunca el frontend directo
--
-- Sin tabla de planes todavía (decisión del usuario, fase 10): `plan` es
-- texto y `plan_expires_at` es NULL = vigencia indefinida. Ambos son solo
-- informativos: nada en la base bloquea a un negocio por su plan ni por
-- estar suspendido. Cuando exista la gestión real de planes, esa tarea
-- decide cómo se modela (probablemente una tabla `plans` y esta columna
-- pasa a ser una FK) — aditivo, sin tirar esta tabla.

create type tenant_status as enum ('active', 'suspended', 'closed');

create table tenant_platform_info (
  id uuid primary key default gen_random_uuid(),
  -- Relación 1 a 1 con el negocio: `unique` garantiza una sola fila por
  -- tenant, y es lo que hace seguro el `on conflict do nothing` del
  -- backfill y del trigger de abajo.
  tenant_id uuid not null unique references tenants(id),
  plan text not null default 'Básico',
  -- NULL = indefinida (todos los negocios hoy). Sin default a propósito.
  plan_expires_at timestamptz,
  -- ETIQUETA informativa: cambiarla NO afecta el acceso de los usuarios
  -- del negocio (ver el comentario de arriba).
  status tenant_status not null default 'active',
  -- Motivo capturado al suspender o dar de baja; NULL mientras esté activo.
  status_reason text,
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- `tenant_id` ya tiene índice por el `unique`; CLAUDE.md §6 pide que el
-- compuesto empiece por tenant_id, y un unique lo cumple.

comment on table tenant_platform_info is
  'Datos de plataforma por negocio (plan, estado, notas internas). 1 a 1 con tenants. Solo la leen superadmins — por eso no viven en tenants (ver comentario de la migración).';

-- =============================================================================
-- Backfill: los negocios que ya existen (demo)
-- =============================================================================
-- Se hace ANTES de crear los triggers de abajo a propósito: así la
-- bitácora no se llena de "altas" ficticias hechas por nadie.
insert into tenant_platform_info (tenant_id)
select id from tenants
on conflict (tenant_id) do nothing;

-- =============================================================================
-- Un negocio nuevo nace con su fila de plataforma
-- =============================================================================
-- Trigger AFTER INSERT en `tenants`: sin él, cualquier negocio creado por
-- otro camino (seed.sql, un script, el panel de Supabase) quedaría SIN fila
-- aquí, y la lista de superadmin lo omitiría en silencio. Con el trigger la
-- relación 1 a 1 se cumple siempre, venga de donde venga el alta.
--
-- SECURITY DEFINER porque esta tabla no tiene política de INSERT para
-- nadie (abajo), y quien crea el tenant puede ser cualquiera con permiso
-- de crear tenants. La función no recibe entrada del usuario: solo copia
-- el id de la fila que disparó el trigger, así que no hay nada que
-- revalidar (a diferencia de una RPC que escribe con datos de un usuario).
create function app.create_tenant_platform_info()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into tenant_platform_info (tenant_id)
  values (new.id)
  on conflict (tenant_id) do nothing;

  return null;
end;
$$;

comment on function app.create_tenant_platform_info() is
  'Trigger AFTER INSERT en tenants: crea su fila 1 a 1 en tenant_platform_info.';

revoke execute on function app.create_tenant_platform_info() from public, anon;

create trigger tenants_create_platform_info
  after insert on tenants
  for each row execute function app.create_tenant_platform_info();

create trigger set_updated_at
  before update on tenant_platform_info
  for each row execute function app.set_updated_at();

-- Bitácora de plataforma: quién cambió el estado, el plan o las notas. Se
-- engancha DESPUÉS del backfill (ver arriba). Nota: el INSERT que hace el
-- trigger de tenants también queda registrado, con el superadmin que dio
-- de alta el negocio como actor.
create trigger tenant_platform_info_audit
  after insert or update or delete on tenant_platform_info
  for each row execute function app.log_platform_change();

-- =============================================================================
-- RLS
-- =============================================================================
alter table tenant_platform_info enable row level security;
alter table tenant_platform_info force row level security;

-- SOLO superadmins. Un miembro del negocio — el dueño incluido — ve cero
-- filas, ni la suya. Es exactamente la razón de ser de esta tabla.
create policy tenant_platform_info_select on tenant_platform_info for select
  to authenticated
  using (app.is_platform_admin());

-- Sin política de INSERT/UPDATE/DELETE: el alta la hace el trigger de
-- arriba y los cambios (estado, notas) los harán las RPCs `platform_*`
-- de la tarea 10.3, que revalidan `is_platform_admin()`. Escribir directo
-- desde PostgREST queda cerrado.
