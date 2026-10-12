-- Correcciones 1, tarea C1.6 (PLAN.md D26): eliminar empleados y no poder
-- desactivar ni eliminar a quien tiene citas programadas.
--
-- =============================================================================
-- Qué se agrega
-- =============================================================================
--   1. Un trigger en `memberships` que impide dejar sin acceso (is_active =
--      false) o eliminar (deleted_at) a una persona que tiene citas con
--      status = 'scheduled' asignadas como EMPLEADO en ese negocio.
--   2. La RPC delete_employee(p_membership_id): borrado suave de la membresía y
--      de sus sucursales asignadas.
--
-- Por qué el trigger y no solo la RPC: desactivar (is_active = false) ya se hace
-- hoy con un UPDATE normal desde la pantalla de empleados, y la regla debe
-- valer también ahí, y para cualquier llamada directa a la API. Una regla que
-- solo vive en una de las dos puertas deja la otra abierta (CLAUDE.md §7).
-- Es el mismo patrón que prevent_disabling_branch_in_use() de las sucursales
-- (20260928150000_branch_settings.sql).
--
-- Por qué importa: una cita programada de alguien sin acceso queda "huérfana":
-- nadie la ve en su agenda (la política de appointments deja ver a groomer/vet
-- solo las suyas) y nadie la atenderá. Se pide reasignarlas o cancelarlas antes.
--
-- Qué NO se toca (a propósito):
--   * `auth.users` ni `profiles`: la persona es una identidad GLOBAL
--     (CLAUDE.md §6.1), puede trabajar en otro negocio. Solo se quita su acceso
--     a ESTE negocio.
--   * Sus citas completadas, canceladas o no asistidas, y su expediente
--     (§8.5): siguen mostrando quién atendió.
--   * `employee_details` y sus documentos: datos personales del negocio,
--     que no se destruyen al quitar el acceso.
--
-- Migración aditiva (§8.1): una función de trigger, un trigger y una RPC nuevas.

-- =============================================================================
-- 1. Trigger: no desactivar ni eliminar con citas programadas
-- =============================================================================
-- SECURITY DEFINER porque la cuenta debe ser de TODAS las citas del empleado: la
-- política de SELECT de appointments hace que quien edita (p. ej. recepción con
-- una sola sucursal) vea solo las de sus sucursales, y un conteo parcial dejaría
-- pasar a un empleado con citas en otra sucursal. No revela nada más que un
-- número a alguien que ya tiene permiso de gestionar empleados.
create function app.prevent_deactivating_employee_with_appointments()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pending integer;
begin
  -- Solo importan los dos pasos hacia "sin acceso": desactivar o eliminar.
  -- Cambiar el rol, o reactivar, no pasa por aquí.
  if not (
    (old.is_active and not new.is_active)
    or (old.deleted_at is null and new.deleted_at is not null)
  ) then
    return new;
  end if;

  select count(*) into v_pending
  from appointments a
  where a.tenant_id = old.tenant_id
    and a.employee_user_id = old.user_id
    and a.status = 'scheduled'
    and a.deleted_at is null;

  if v_pending > 0 then
    raise exception 'Tiene % %; reasígnalas o cancélalas primero.',
      v_pending,
      case when v_pending = 1 then 'cita programada' else 'citas programadas' end
      using errcode = 'check_violation', hint = 'employee_has_scheduled_appointments';
  end if;

  return new;
end;
$$;

comment on function app.prevent_deactivating_employee_with_appointments() is
  'Trigger BEFORE UPDATE en memberships: impide desactivar (is_active = false) o eliminar (deleted_at) a quien tiene citas con status scheduled como empleado en ese negocio. Dice cuántas son.';

revoke execute on function app.prevent_deactivating_employee_with_appointments() from public, anon, authenticated;

-- UPDATE OF: solo se evalúa cuando el UPDATE menciona is_active o deleted_at.
create trigger prevent_deactivating_employee_with_appointments
  before update of is_active, deleted_at on memberships
  for each row execute function app.prevent_deactivating_employee_with_appointments();

-- =============================================================================
-- 2. delete_employee(): borrado suave de la membresía y sus sucursales
-- =============================================================================
-- Por qué una RPC y no dos UPDATE desde el navegador: son dos tablas
-- (memberships y membership_branches). En una función corren en UNA
-- transacción: no queda una membresía eliminada con sus sucursales todavía
-- activas, ni al revés.
--
-- SECURITY DEFINER: las políticas de UPDATE ya exigen employees:edit, pero la
-- función además aplica reglas que RLS no expresa (no a uno mismo, no al último
-- dueño). Salta RLS, así que REVALIDA ella misma membresía y permiso ANTES de
-- tocar nada (§7.3.4). El permiso es app.has_permission(..., 'employees',
-- 'edit') y no "ser dueño" a secas (§7.2): si un negocio le da ese permiso a
-- recepción, la función lo respeta.
create function delete_employee(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_membership memberships;
begin
  select * into v_membership
  from memberships
  where id = p_membership_id and deleted_at is null;

  if not found then
    raise exception 'El empleado no existe.' using errcode = 'no_data_found';
  end if;

  if not app.is_member_of(v_membership.tenant_id) then
    raise exception 'No perteneces a este negocio.' using errcode = 'insufficient_privilege';
  end if;

  if not app.has_permission(v_membership.tenant_id, 'employees', 'edit') then
    raise exception 'No tienes permiso para eliminar empleados.' using errcode = 'insufficient_privilege';
  end if;

  -- Nadie se elimina a sí mismo: se quedaría sin acceso a media sesión y, si
  -- es el dueño, sin forma de administrar el negocio.
  if v_membership.user_id = auth.uid() then
    raise exception 'No puedes eliminar tu propio acceso.' using errcode = 'check_violation';
  end if;

  -- Nunca quedarse sin dueño activo: un negocio sin dueño no tiene quien
  -- administre empleados, sucursales ni permisos.
  if v_membership.role = 'owner' and not exists (
    select 1
    from memberships m
    where m.tenant_id = v_membership.tenant_id
      and m.id <> v_membership.id
      and m.role = 'owner'
      and m.is_active
      and m.deleted_at is null
  ) then
    raise exception 'No se puede eliminar al último dueño del negocio.' using errcode = 'check_violation';
  end if;

  -- Si tiene citas programadas, el trigger de arriba lanza el error (con el
  -- conteo) en este UPDATE y la transacción completa se deshace.
  update memberships
     set is_active = false,
         deleted_at = now()
   where id = v_membership.id;

  update membership_branches
     set deleted_at = now()
   where membership_id = v_membership.id
     and deleted_at is null;
end;
$$;

comment on function delete_employee(uuid) is
  'Borrado suave de una membresía y sus sucursales asignadas. Revalida membresía y employees:edit. No a uno mismo, no al último dueño, no con citas programadas (trigger). No toca auth.users ni profiles.';

revoke execute on function delete_employee(uuid) from public, anon;
grant execute on function delete_employee(uuid) to authenticated;
