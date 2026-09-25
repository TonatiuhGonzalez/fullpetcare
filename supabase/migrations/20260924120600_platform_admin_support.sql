-- Piezas de base de datos que necesita la Edge Function `platform-admin`
-- (fase 10, tarea 10.5) y la pantalla de superadmins (10.8):
--
--   revoke_user_sessions(user)      cierra TODAS las sesiones de un usuario
--   platform_list_admins()          lista de superadmins con nombre y correo
--   platform_add_admin(user)        agrega (o reactiva) un superadmin
--   platform_remove_admin(user)     quita un superadmin, sin dejar la plataforma vacía
--   platform_log_event(...)         registra en la bitácora algo que NO es un
--                                   cambio de fila (p. ej. "se restableció una contraseña")
--
-- =============================================================================
-- Por qué la Edge Function llama estas funciones con la sesión DEL SUPERADMIN
-- =============================================================================
-- La Edge Function tiene la llave service_role, con la que podría escribir
-- todo directo. Pero la bitácora guarda quién hizo cada cosa con
-- `auth.uid()`, y con service_role `auth.uid()` es NULL: todo quedaría
-- registrado como "nadie". Por eso, lo que necesita bitácora (dar de alta
-- un negocio, agregar un superadmin, restablecer una contraseña) la función
-- lo hace llamando estas RPC con un cliente construido con el JWT de quien
-- llama, y solo usa service_role para lo que de verdad lo exige: la API de
-- administración de Auth (crear usuarios, cambiar contraseñas).

-- =============================================================================
-- Bitácora: eventos que no son un cambio de fila
-- =============================================================================
-- Restablecer una contraseña no modifica ninguna tabla nuestra (vive en
-- auth.users), así que ningún trigger la vería. Se agrega una columna
-- `event` para registrar acciones así, con la misma tabla y la misma
-- lectura (solo superadmins) que el resto de la bitácora.
alter table platform_audit_log add column event text;

comment on column platform_audit_log.event is
  'Nombre del evento cuando NO es un cambio de fila detectado por trigger (p. ej. password_reset). NULL en las entradas de trigger.';

-- Es SECURITY DEFINER porque platform_audit_log no tiene política de
-- INSERT (nadie forja entradas a mano). Revalida quién llama y NO acepta
-- `p_details` con contraseñas: la Edge Function solo manda datos no
-- sensibles (el correo afectado), y esta función nunca recibe la contraseña.
create function platform_log_event(
  p_tenant_id uuid,
  p_event text,
  p_record_id uuid,
  p_details jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not app.is_platform_admin() then
    raise exception 'No tienes permiso para administrar la plataforma.' using errcode = 'insufficient_privilege';
  end if;

  if btrim(coalesce(p_event, '')) = '' then
    raise exception 'Indica el evento.' using errcode = 'check_violation';
  end if;

  -- table_name/record_id/action siguen siendo obligatorios en la tabla;
  -- para un evento sobre una cuenta de acceso se registra como un UPDATE de
  -- auth.users sobre ese usuario.
  insert into platform_audit_log (tenant_id, table_name, record_id, action, actor_user_id, new_data, event)
  values (p_tenant_id, 'auth.users', p_record_id, 'UPDATE', auth.uid(), p_details, btrim(p_event));
end;
$$;

comment on function platform_log_event(uuid, text, uuid, jsonb) is
  'Superadmin: registra en platform_audit_log un evento que no es un cambio de fila (p. ej. password_reset). Nunca recibe contraseñas.';

-- =============================================================================
-- revoke_user_sessions(user)
-- =============================================================================
-- Al restablecer la contraseña de un dueño, sus sesiones abiertas (otro
-- celular, otra computadora) deben cerrarse: si alguien tenía la contraseña
-- vieja y ya estaba dentro, cambiarla no lo saca por sí sola.
--
-- Por qué SQL y no la API de Auth: `auth.admin.signOut()` recibe el TOKEN de
-- una sesión, no un id de usuario — no sirve para "cierra todo lo de esta
-- persona". Borrar sus filas de auth.sessions sí: los refresh tokens caen
-- en cascada (refresh_tokens_session_id_fkey ... on delete cascade), así que
-- ninguna sesión puede renovarse.
--
-- Nota honesta: la versión de GoTrue con la que se desarrolló esto ya
-- elimina las sesiones cuando se cambia la contraseña por la API de admin
-- (comprobado a mano), así que aquí es un cinturón adicional: la garantía
-- no debe depender de un efecto secundario que puede cambiar entre
-- versiones de Supabase Auth.
--
-- Límite honesto: un access token YA emitido sigue siendo válido hasta que
-- caduca (1 h por default) — es un JWT firmado y nadie lo consulta contra la
-- base en cada request. Lo que esto garantiza es que no pueda RENOVARSE.
--
-- SOLO service_role puede ejecutarla (más abajo): aquí no hay un
-- `is_platform_admin()` que revalidar porque la llama la Edge Function, que
-- ya lo revalidó, con la llave secreta. Ningún usuario, ni siquiera un
-- superadmin, puede llamarla directo desde el navegador.
create function revoke_user_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_deleted integer;
begin
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function revoke_user_sessions(uuid) is
  'Cierra todas las sesiones de un usuario (los refresh tokens caen en cascada). Solo service_role: la llama la Edge Function platform-admin.';

-- =============================================================================
-- platform_list_admins()
-- =============================================================================
-- El correo vive en auth.users (ilegible para el frontend), y el nombre en
-- profiles, que un superadmin no puede leer (no es colega de nadie). De ahí
-- que sea una RPC, igual que platform_list_tenants().
create function platform_list_admins()
returns table (
  user_id uuid,
  email text,
  full_name text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if not app.is_platform_admin() then
    raise exception 'No tienes permiso para administrar la plataforma.' using errcode = 'insufficient_privilege';
  end if;

  return query
  select pa.user_id, u.email::text, p.full_name, pa.created_at
  from platform_admins pa
  join auth.users u on u.id = pa.user_id
  left join profiles p on p.id = pa.user_id
  where pa.deleted_at is null
  order by pa.created_at;
end;
$$;

comment on function platform_list_admins() is
  'Superadmin: lista de superadmins activos con nombre y correo.';

-- =============================================================================
-- platform_add_admin(user) / platform_remove_admin(user)
-- =============================================================================
-- platform_admins.user_id es `unique`, así que a alguien que fue superadmin
-- y se le quitó (deleted_at) no se le puede insertar otra fila: se REACTIVA
-- la que tiene. `on conflict (user_id) do update` hace ambas cosas en una
-- sola sentencia sin condiciones de carrera.
create function platform_add_admin(p_user_id uuid)
returns platform_admins
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin platform_admins;
begin
  if not app.is_platform_admin() then
    raise exception 'No tienes permiso para administrar la plataforma.' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'El usuario no existe.' using errcode = 'foreign_key_violation';
  end if;

  if exists (
    select 1 from platform_admins pa where pa.user_id = p_user_id and pa.deleted_at is null
  ) then
    raise exception 'Esta persona ya es superadmin.' using errcode = 'unique_violation';
  end if;

  insert into platform_admins (user_id)
  values (p_user_id)
  on conflict (user_id) do update set deleted_at = null
  returning * into v_admin;

  return v_admin;
end;
$$;

comment on function platform_add_admin(uuid) is
  'Superadmin: agrega (o reactiva) a un usuario existente como superadmin. El usuario de auth.users lo crea la Edge Function platform-admin.';

-- Regla: nunca se puede quitar al ÚLTIMO superadmin. Sin él nadie podría
-- volver a administrar la plataforma desde la UI, y el único camino de
-- vuelta sería un script con service_role. Quitarse a uno mismo SÍ se
-- permite mientras quede alguien más.
create function platform_remove_admin(p_user_id uuid)
returns platform_admins
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin platform_admins;
begin
  if not app.is_platform_admin() then
    raise exception 'No tienes permiso para administrar la plataforma.' using errcode = 'insufficient_privilege';
  end if;

  -- `for update` bloquea las filas de superadmins activos hasta el final de
  -- la transacción: si dos superadmins se quitan mutuamente al MISMO tiempo,
  -- la segunda espera a la primera y ve que ya solo queda uno. Sin el
  -- bloqueo, ambas contarían "hay dos", ambas procederían, y la plataforma
  -- quedaría sin superadmins.
  perform 1 from platform_admins pa where pa.deleted_at is null for update;

  if not exists (
    select 1 from platform_admins pa where pa.user_id = p_user_id and pa.deleted_at is null
  ) then
    raise exception 'Esta persona no es superadmin.' using errcode = 'no_data_found';
  end if;

  if (select count(*) from platform_admins pa where pa.deleted_at is null) <= 1 then
    raise exception 'No se puede quitar al único superadmin.' using errcode = 'check_violation';
  end if;

  update platform_admins
  set deleted_at = now()
  where user_id = p_user_id
  returning * into v_admin;

  return v_admin;
end;
$$;

comment on function platform_remove_admin(uuid) is
  'Superadmin: quita a un superadmin (borrado suave). Rechaza quitar al último.';

-- =============================================================================
-- Permisos de ejecución
-- =============================================================================
revoke execute on function platform_log_event(uuid, text, uuid, jsonb) from public, anon;
revoke execute on function platform_list_admins() from public, anon;
revoke execute on function platform_add_admin(uuid) from public, anon;
revoke execute on function platform_remove_admin(uuid) from public, anon;
-- revoke_user_sessions: solo service_role. Se quita también a `authenticated`
-- (que las demás sí conservan) porque esta NO revalida a quien llama.
revoke execute on function revoke_user_sessions(uuid) from public, anon, authenticated;

grant execute on function platform_log_event(uuid, text, uuid, jsonb) to authenticated;
grant execute on function platform_list_admins() to authenticated;
grant execute on function platform_add_admin(uuid) to authenticated;
grant execute on function platform_remove_admin(uuid) to authenticated;
grant execute on function revoke_user_sessions(uuid) to service_role;
