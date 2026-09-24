-- Fase 10 (superadmin de plataforma): quién es superadmin, cómo lo reconoce
-- la base, y dónde queda la bitácora de lo que hace.
--
-- =============================================================================
-- Por qué una tabla aparte y no un valor más en `member_role`
-- =============================================================================
-- `memberships` siempre pertenece a UN negocio (tenant_id), y
-- `app.is_member_of()` — que usa casi toda política de negocio — la lee.
-- Un superadmin no trabaja en ningún negocio: metéralo ahí y tendrías que
-- inventarle un tenant, o volver nulo un tenant_id que hoy es obligatorio.
-- En una tabla aparte queda FUERA del camino de todas las políticas de
-- `customers`, `pets`, `medical_records`, etc.: ninguna lo menciona, así
-- que aunque una política de negocio se equivocara, un superadmin no
-- heredaría acceso por accidente. Solo lo reconocen las funciones y
-- políticas de plataforma, vía `app.is_platform_admin()` (más abajo).
-- (Decisión D14 en PLAN.md.)
--
-- Sin `tenant_id`: es la segunda excepción documentada a la regla de
-- CLAUDE.md §6, junto a `profiles` — un superadmin no es de ningún negocio.

-- =============================================================================
-- platform_admins
-- =============================================================================
create table platform_admins (
  id uuid primary key default gen_random_uuid(),
  -- La persona en Supabase Auth. Referencia a auth.users y no a `profiles`
  -- porque un superadmin no necesita perfil de negocio (nombre, teléfono
  -- de un negocio): solo necesita poder iniciar sesión.
  user_id uuid not null unique references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Quitar a un superadmin es `deleted_at = now()`, no un DELETE
  -- (CLAUDE.md §8.5). `app.is_platform_admin()` ya lo ignora.
  deleted_at timestamptz
);

create trigger set_updated_at
  before update on platform_admins
  for each row execute function app.set_updated_at();

comment on table platform_admins is
  'Personas que administran la plataforma completa (alta/baja de negocios). Sin tenant_id: no pertenecen a ningún negocio. Ver PLAN.md D14.';

-- =============================================================================
-- app.is_platform_admin() — ¿el usuario actual es superadmin?
-- =============================================================================
-- Mismo molde que app.is_member_of() (rls_helpers.sql, donde está la
-- explicación larga de SECURITY DEFINER y search_path):
--   - SECURITY DEFINER: la política de SELECT de platform_admins (abajo)
--     llama a esta función, y esta función lee platform_admins. Sin
--     DEFINER, leer la tabla activaría su propia política, que vuelve a
--     llamar a la función... un bucle. Con DEFINER la función lee la
--     tabla con los permisos de su dueño y el bucle no existe.
--   - STABLE: Postgres la evalúa una vez por consulta, no por fila.
--   - `set search_path` fijo: cierra la puerta a que alguien cree una
--     tabla falsa `platform_admins` en otro esquema.
--
-- Esta función NO recibe un id como argumento: pregunta por `auth.uid()`,
-- el usuario de la sesión. Así nadie puede preguntar "¿fulano es admin?"
-- para averiguarlo, ni hacerla pasar por otro.
create function app.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from platform_admins pa
    where pa.user_id = auth.uid()
      and pa.deleted_at is null
  );
$$;

comment on function app.is_platform_admin() is
  'true si el usuario autenticado es superadmin de plataforma activo. Base de toda política y RPC de plataforma.';

-- Postgres da EXECUTE a todo el mundo (PUBLIC) por default en funciones
-- nuevas. Aquí se quita: `anon` no tiene por qué llamarla (recibiría
-- false igual, pero menos superficie es mejor).
revoke execute on function app.is_platform_admin() from public, anon;
grant execute on function app.is_platform_admin() to authenticated, service_role;

-- =============================================================================
-- RLS de platform_admins
-- =============================================================================
alter table platform_admins enable row level security;
alter table platform_admins force row level security;

-- Un superadmin ve la lista completa de superadmins (la pantalla de
-- "agregar superadmin" la necesita). Cualquier otro usuario, incluido el
-- dueño de un negocio, ve CERO filas.
--
-- Sin `and deleted_at is null` aquí: mismo criterio que ya documenta
-- CLAUDE.md §7.2 para tablas con UPDATE. Hoy esta tabla no tiene UPDATE
-- para `authenticated` (ver abajo), pero el frontend igual filtra
-- `deleted_at is null` en el service al preguntar "¿soy superadmin?".
create policy platform_admins_select on platform_admins for select
  to authenticated
  using (app.is_platform_admin());

-- A propósito, SIN política de INSERT/UPDATE/DELETE: nadie autenticado
-- escribe esta tabla directo. Agregar o quitar un superadmin lo hará una
-- RPC (tarea 10.3) o la Edge Function `platform-admin` (10.5), que
-- revalidan `is_platform_admin()` adentro; y el PRIMER superadmin lo crea
-- un script con service_role (10.9), porque todavía no existe nadie que
-- pueda hacerlo desde la UI. Mismo precedente que role_permissions y
-- las tablas de tenencia de la fase 1: una tabla sin política de
-- escritura es una puerta cerrada por default, no un descuido.

-- =============================================================================
-- platform_audit_log — bitácora de lo que hacen los superadmins
-- =============================================================================
-- ¿Por qué no reutilizar `audit_log` (audit.sql)? Dos razones, ambas
-- concretas:
--   1. `audit_log.tenant_id` es NOT NULL y `app.log_change()` lee
--      `new.tenant_id`. Una fila de `platform_admins` no tiene tenant, así
--      que el trigger genérico fallaría.
--   2. `audit_log` la LEE EL DUEÑO de cada negocio (audit_log_select). Si
--      las acciones del superadmin sobre un negocio (su estado, sus notas
--      internas) cayeran ahí, el dueño podría leer lo que la plataforma
--      anota sobre él. Esta bitácora es solo para superadmins.
--
-- Misma forma que audit_log a propósito (mismo enum `audit_action`, mismas
-- columnas de antes/después) para que la pantalla de bitácora se lea igual;
-- solo cambia que `tenant_id` puede ser NULL y quién puede leerla.
create table platform_audit_log (
  id uuid primary key default gen_random_uuid(),
  -- NULL cuando el cambio no es de un negocio concreto (p. ej. agregar
  -- un superadmin).
  tenant_id uuid references tenants(id),
  table_name text not null,
  record_id uuid not null,
  action audit_action not null,
  actor_user_id uuid references auth.users(id),
  changed_at timestamptz not null default now(),
  old_data jsonb,
  new_data jsonb
);

-- Consulta típica: "bitácora de ESTA empresa, la más reciente primero"
-- (pestaña Bitácora del detalle). Empieza por tenant_id (CLAUDE.md §6).
create index platform_audit_log_tenant_changed_at_idx
  on platform_audit_log (tenant_id, changed_at desc);
create index platform_audit_log_changed_at_idx
  on platform_audit_log (changed_at desc);

alter table platform_audit_log enable row level security;
alter table platform_audit_log force row level security;

create policy platform_audit_log_select on platform_audit_log for select
  to authenticated
  using (app.is_platform_admin());

-- Sin política de INSERT/UPDATE/DELETE, igual que audit_log: la única
-- forma de que aparezca una fila es el trigger de abajo (SECURITY
-- DEFINER), así nadie puede forjar ni borrar una entrada.

-- =============================================================================
-- app.log_platform_change() — el trigger de esa bitácora
-- =============================================================================
-- Hermano de app.log_change() (audit.sql, ahí está la explicación de qué
-- es un trigger y por qué la auditoría vive en la base y no en la app).
-- La diferencia: no asume que la fila tenga `tenant_id`. Convierte la
-- fila a jsonb y busca ahí la llave; si la tabla no la tiene, queda NULL.
-- (Leer `new.tenant_id` directo fallaría en `platform_admins`.)
create function app.log_platform_change()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row jsonb;
begin
  -- En un DELETE no existe NEW; en un INSERT no existe OLD.
  v_row := to_jsonb(case when tg_op = 'DELETE' then old else new end);

  insert into platform_audit_log (tenant_id, table_name, record_id, action, actor_user_id, old_data, new_data)
  values (
    (v_row ->> 'tenant_id')::uuid,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    tg_op::audit_action,
    auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );

  return null;
end;
$$;

comment on function app.log_platform_change() is
  'Trigger: registra en platform_audit_log quién (auth.uid()) cambió qué fila de plataforma, cuándo, y antes/después. Tolera tablas sin tenant_id.';

-- Una función de trigger no se llama a mano; quitar EXECUTE a PUBLIC no
-- afecta que el trigger dispare (Postgres solo revisa ese permiso al
-- CREAR el trigger, no cada vez que dispara).
revoke execute on function app.log_platform_change() from public, anon;

create trigger platform_admins_audit
  after insert or update or delete on platform_admins
  for each row execute function app.log_platform_change();
