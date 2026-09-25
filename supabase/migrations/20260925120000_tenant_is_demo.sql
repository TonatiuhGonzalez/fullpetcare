-- Marca de "empresa de demostración" en tenant_platform_info, para que
-- `demo:reset` deje de ocultar TODA empresa fuera de la semilla.
--
-- =============================================================================
-- El problema que resuelve
-- =============================================================================
-- El último bloque de supabase/seed/demo_reset.sql ocultaba (borrado suave)
-- toda empresa que no fuera una de las 3 de la semilla. Correcto mientras
-- producción fuera puro demo; con el primer cliente real dado de alta desde
-- /superadmin, el siguiente `npm run demo:reset` lo habría hecho desaparecer.
--
-- La solución es que el reset solo toque lo que alguien marcó como demo:
--
--   is_demo boolean not null DEFAULT FALSE
--
-- El default en false es lo que hace esto seguro: si alguien olvida marcar
-- algo, la empresa se trata como REAL y el reset no la toca. El error
-- contrario (olvidar marcar una empresa de demo) solo deja una empresa de
-- sobra en la lista, que se oculta a mano desde el panel.
--
-- =============================================================================
-- Qué cambia
-- =============================================================================
--   1. Columna `is_demo` en tenant_platform_info (aditiva, sin tocar filas).
--   2. Las 3 empresas de la semilla se marcan como demo. Se hace por id
--      fijo, no "todas las que existen hoy": una empresa real que ya
--      estuviera creada en este momento no debe marcarse por accidente.
--   3. `platform_create_tenant` recibe un sexto parámetro, `p_is_demo`
--      (default false), y lo guarda al dar de alta.
--
-- Por qué se elimina y se vuelve a crear la función en vez de solo agregarle
-- un parámetro: `create or replace` con otra lista de parámetros NO
-- reemplaza, crea una SEGUNDA función (sobrecarga). PostgREST no sabe cuál
-- elegir cuando la llamada no manda el parámetro nuevo, y responde error.
-- Con `drop` primero queda una sola versión. Las migraciones de fase 10 no
-- se editan: se escribe esta encima (CLAUDE.md §8.1).

alter table tenant_platform_info
  add column is_demo boolean not null default false;

comment on column tenant_platform_info.is_demo is
  'true = empresa de demostración: `demo:reset` puede ocultarla. Default false: una empresa sin marcar se trata como real y el reset no la toca.';

-- Las 3 empresas de la semilla (mismos ids que seed.sql y demo_reset.sql).
-- En un ambiente donde no existan (staging vacío) el UPDATE no toca nada.
--
-- El trigger de bitácora se apaga solo durante este UPDATE: es una marca de
-- mantenimiento hecha por la migración, no un cambio de nadie, y sin esto
-- quedarían 3 entradas "del Sistema" en la pestaña Bitácora de cada empresa.
-- Mismo criterio que el backfill de tenant_platform_info.sql.
alter table tenant_platform_info disable trigger tenant_platform_info_audit;

update tenant_platform_info
set is_demo = true
where tenant_id in (
  'b0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000002',
  'b0000000-0000-4000-8000-000000000003'
);

alter table tenant_platform_info enable trigger tenant_platform_info_audit;

drop function platform_create_tenant(uuid, text, text, text, text);

create function platform_create_tenant(
  p_user_id uuid,
  p_tenant_name text,
  p_branch_name text,
  p_owner_full_name text,
  p_owner_phone text,
  p_is_demo boolean default false
)
returns tenants
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant tenants;
  v_tenant_name text := btrim(coalesce(p_tenant_name, ''));
  v_branch_name text := btrim(coalesce(p_branch_name, ''));
  v_owner_name text := btrim(coalesce(p_owner_full_name, ''));
begin
  if not app.is_platform_admin() then
    raise exception 'No tienes permiso para administrar la plataforma.' using errcode = 'insufficient_privilege';
  end if;

  if v_tenant_name = '' then
    raise exception 'Indica el nombre de la empresa.' using errcode = 'check_violation';
  end if;
  if v_branch_name = '' then
    raise exception 'Indica el nombre de la sucursal.' using errcode = 'check_violation';
  end if;
  if v_owner_name = '' then
    raise exception 'Indica el nombre del dueño.' using errcode = 'check_violation';
  end if;

  if not exists (select 1 from profiles p where p.id = p_user_id) then
    raise exception 'El usuario del dueño no existe.' using errcode = 'foreign_key_violation';
  end if;

  insert into tenants (name)
  values (v_tenant_name)
  returning * into v_tenant;

  -- La fila de tenant_platform_info ya la creó el trigger de tenants (con
  -- is_demo = false); aquí solo se ajusta si el alta se pidió como demo.
  -- `coalesce(..., false)`: un NULL explícito no debe marcar nada.
  if coalesce(p_is_demo, false) then
    update tenant_platform_info set is_demo = true where tenant_id = v_tenant.id;
  end if;

  insert into branches (tenant_id, name)
  values (v_tenant.id, v_branch_name);

  insert into memberships (tenant_id, user_id, role, is_active)
  values (v_tenant.id, p_user_id, 'owner', true);

  update profiles
  set full_name = v_owner_name,
      phone = nullif(btrim(coalesce(p_owner_phone, '')), '')
  where id = p_user_id;

  return v_tenant;
end;
$$;

comment on function platform_create_tenant(uuid, text, text, text, text, boolean) is
  'Superadmin: alta de un negocio (tenant + una sucursal + membresía owner) en una sola transacción. p_is_demo marca la empresa como de demostración (demo:reset puede ocultarla). El usuario de auth.users debe existir ya (lo crea la Edge Function platform-admin).';

revoke execute on function platform_create_tenant(uuid, text, text, text, text, boolean) from public, anon;
grant execute on function platform_create_tenant(uuid, text, text, text, text, boolean) to authenticated;
