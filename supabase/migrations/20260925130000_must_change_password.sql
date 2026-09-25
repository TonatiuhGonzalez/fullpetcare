-- Obligar a cambiar la contraseña temporal en el primer inicio de sesión.
--
-- Contexto: al dar de alta a un dueño o a un superadmin (y al restablecer la
-- contraseña de un dueño) el sistema le asigna una contraseña TEMPORAL. Hasta
-- ahora la persona podía cambiarla, pero nada la obligaba: la temporal seguía
-- valiendo indefinidamente. Esta migración agrega la marca y el bloqueo.
--
-- Cómo funciona, en cuatro piezas:
--
-- 1. `profiles.must_change_password`: la marca. `true` = "todavía usa una
--    contraseña temporal".
-- 2. Se PONE en true de dos maneras: al crear el usuario con
--    `app_metadata.must_change_password = true` (triggers sobre auth.users la
--    copian al profile) y, en el restablecimiento de un dueño, la Edge Function la pone
--    directamente. `app_metadata` (a diferencia de `user_metadata`) solo la
--    puede escribir quien tiene la llave service_role: el propio usuario no.
-- 3. Se QUITA sola, por trigger, cuando cambia el hash de la contraseña en
--    auth.users. Así la marca solo se apaga si la contraseña de verdad cambió;
--    no hay ninguna RPC que un cliente pueda llamar para "saltarse" el cambio.
-- 4. Mientras vale true, las funciones auxiliares de RLS dicen "no eres
--    miembro / no eres superadmin": la persona no ve ni escribe datos de
--    negocio aunque llame a la API directo, sin pasar por la pantalla.

-- =============================================================================
-- 1. La columna
-- =============================================================================
-- `default false`: las cuentas que ya existen NO quedan marcadas (decisión
-- explícita: solo aplica a altas y restablecimientos nuevos).
alter table profiles
  add column must_change_password boolean not null default false;

comment on column profiles.must_change_password is
  'true mientras la persona use una contraseña temporal: debe cambiarla antes de usar el sistema. La apaga el trigger app.clear_must_change_password() al cambiar la contraseña.';

-- La política profiles_update deja a cada persona editar su propia fila; sin
-- más, podría hacer `update profiles set must_change_password = false` desde
-- la API y saltarse todo. Los permisos por COLUMNA lo impiden: `authenticated`
-- solo puede escribir las columnas de perfil, nunca la marca. (service_role
-- conserva todo: así la Edge Function puede ponerla.)
revoke update on profiles from authenticated;
grant update (full_name, phone, avatar_path) on profiles to authenticated;

-- =============================================================================
-- 2. El alta copia la marca desde app_metadata
-- =============================================================================
create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into public.profiles (id, full_name, must_change_password)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email, 'Sin nombre'),
    -- Solo el texto exacto 'true' activa la marca; cualquier otra cosa (o
    -- nada) deja false, como hasta ahora.
    coalesce(new.raw_app_meta_data ->> 'must_change_password', 'false') = 'true'
  );
  return new;
end;
$$;

-- GoTrue (Supabase Auth) crea la fila en auth.users SIN `app_metadata` y lo
-- escribe con un UPDATE inmediatamente después (comprobado a mano: el trigger
-- de INSERT de arriba ve la marca vacía). Por eso también se atiende el UPDATE:
-- cuando app_metadata pasa a decir 'true', se marca el profile.
create or replace function app.sync_must_change_password()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update public.profiles
  set must_change_password = true
  where id = new.id
    and not must_change_password;
  return new;
end;
$$;

create trigger on_auth_user_app_metadata_changed
  after update of raw_app_meta_data on auth.users
  for each row
  when (
    new.raw_app_meta_data ->> 'must_change_password' = 'true'
    and old.raw_app_meta_data ->> 'must_change_password' is distinct from 'true'
  )
  execute function app.sync_must_change_password();

-- =============================================================================
-- 3. Cambiar la contraseña apaga la marca
-- =============================================================================
-- Se dispara SOLO cuando cambia encrypted_password (la cláusula `when`), no en
-- cada update de auth.users (por ejemplo, al iniciar sesión).
--
-- Ojo con el orden en el restablecimiento de un dueño: este trigger también se
-- dispara cuando el superadmin le pone la contraseña temporal nueva, así que
-- la Edge Function debe poner la marca DESPUÉS de cambiar la contraseña.
create or replace function app.clear_must_change_password()
returns trigger
language plpgsql
security definer -- escribe en profiles, que tiene RLS
set search_path = public, extensions
as $$
begin
  update public.profiles
  set must_change_password = false
  where id = new.id
    and must_change_password;
  return new;
end;
$$;

create trigger on_auth_user_password_changed
  after update of encrypted_password on auth.users
  for each row
  when (old.encrypted_password is distinct from new.encrypted_password)
  execute function app.clear_must_change_password();

-- =============================================================================
-- 4. El bloqueo en la base
-- =============================================================================
-- Pregunta por auth.uid() (sin argumentos, igual que is_platform_admin): nadie
-- puede consultar "¿fulano debe cambiar contraseña?". SECURITY DEFINER porque
-- lee profiles; no hay recursión: la política de profiles no usa estas
-- funciones.
create function app.has_pending_password_change()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from profiles p
    where p.id = auth.uid()
      and p.must_change_password
  );
$$;

comment on function app.has_pending_password_change() is
  'true si el usuario autenticado todavía debe cambiar su contraseña temporal. Las funciones auxiliares de RLS la usan para negar acceso mientras tanto.';

revoke execute on function app.has_pending_password_change() from public, anon;
grant execute on function app.has_pending_password_change() to authenticated, service_role;

-- Las cinco funciones auxiliares se reescriben idénticas a como estaban, con
-- una condición más. NOTA: is_member_of() la usa toda la base, y por eso
-- basta con tocarla para bloquear TODAS las tablas de negocio; role_in() y
-- can_access_branch() se tocan también porque algunas RPC las llaman solas.
-- has_permission() hereda el bloqueo por llamar a role_in().
create or replace function app.is_member_of(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = p_tenant_id
      and m.is_active
      and m.deleted_at is null
  )
  and not app.has_pending_password_change();
$$;

create or replace function app.role_in(p_tenant_id uuid)
returns member_role
language sql
stable
security definer
set search_path = public, extensions
as $$
  select m.role
  from memberships m
  where m.user_id = auth.uid()
    and m.tenant_id = p_tenant_id
    and m.is_active
    and m.deleted_at is null
    and not app.has_pending_password_change()
  limit 1;
$$;

create or replace function app.can_access_branch(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from branches b
    join memberships m
      on m.tenant_id = b.tenant_id
     and m.user_id = auth.uid()
     and m.is_active
     and m.deleted_at is null
    where b.id = p_branch_id
      and (
        m.role = 'owner'
        or exists (
          select 1
          from membership_branches mb
          where mb.membership_id = m.id
            and mb.branch_id = b.id
            and mb.deleted_at is null
        )
      )
  )
  and not app.has_pending_password_change();
$$;

create or replace function app.is_platform_admin()
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
  )
  and not app.has_pending_password_change();
$$;
