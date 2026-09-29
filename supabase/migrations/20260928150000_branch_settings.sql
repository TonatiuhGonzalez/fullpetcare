-- Vista de configuración de sucursales (tarea #1959).
--
-- Hasta hoy "branches" solo tenía política de SELECT: las sucursales nacían
-- por la semilla y nadie las escribía desde la app. La nueva pantalla de
-- configuración las crea, edita y (des)habilita, así que esta migración:
--   1. agrega la columna `is_active` (habilitada / deshabilitada),
--   2. agrega las políticas de INSERT y UPDATE, solo para el dueño,
--   3. bloquea en la base deshabilitar una sucursal que todavía se usa,
--   4. engancha la bitácora de auditoría (CLAUDE.md §8.6).
--
-- "Deshabilitar" NO es borrar: `deleted_at` es borrado suave y aquí no se
-- usa. Una sucursal deshabilitada conserva su historial de citas y se puede
-- volver a habilitar.

-- =============================================================================
-- 1. Columna is_active
-- =============================================================================
alter table branches add column is_active boolean not null default true;

-- =============================================================================
-- 2. Políticas de escritura: solo el dueño
-- =============================================================================
-- No se usa app.has_permission(): ese mecanismo solo existe para el módulo
-- 'employees' (§6.7), y CLAUDE.md §6.1 dice que la configuración de sucursales
-- es del dueño. Mismo patrón de rol fijo que customers_insert.
--
-- Sin "and deleted_at is null" en el UPDATE, por la trampa de §7.2 (la política
-- de SELECT de branches tampoco filtra deleted_at).
create policy branches_insert on branches for insert
  to authenticated
  with check (
    app.is_member_of(tenant_id)
    and app.role_in(tenant_id) = 'owner'
  );

create policy branches_update on branches for update
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and app.role_in(tenant_id) = 'owner'
  )
  with check (
    app.is_member_of(tenant_id)
    and app.role_in(tenant_id) = 'owner'
  );

-- =============================================================================
-- 3. Bloqueo al deshabilitar una sucursal que todavía se usa
-- =============================================================================
-- Vive en un trigger y no en la pantalla: así también se respeta si alguien
-- llama la API directo. Se bloquea cuando la sucursal:
--   a) tiene citas pendientes a futuro (agendadas o en curso),
--   b) tiene empleados con acceso activo asignados, o
--   c) es la última sucursal activa del negocio.
--
-- SECURITY DEFINER porque debe contar TODAS las filas, sin que RLS las filtre.
-- Es un trigger (nadie lo llama directo) y solo se dispara después de que la
-- política de UPDATE dejó pasar al dueño, así que no abre ninguna puerta.
create function app.prevent_disabling_branch_in_use()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Solo importa el paso de habilitada -> deshabilitada.
  if not (old.is_active and not new.is_active) then
    return new;
  end if;

  if exists (
    select 1 from appointments a
    where a.branch_id = old.id
      and a.deleted_at is null
      and a.status in ('scheduled', 'in_progress')
      and a.starts_at > now()
  ) then
    raise exception 'No se puede deshabilitar la sucursal: tiene citas pendientes.'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from membership_branches mb
    join memberships m on m.id = mb.membership_id
    where mb.branch_id = old.id
      and mb.deleted_at is null
      and m.is_active
  ) then
    raise exception 'No se puede deshabilitar la sucursal: tiene empleados asignados.'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from branches b
    where b.tenant_id = old.tenant_id
      and b.id <> old.id
      and b.is_active
      and b.deleted_at is null
  ) then
    raise exception 'No se puede deshabilitar la última sucursal activa del negocio.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function app.prevent_disabling_branch_in_use() is
  'Trigger BEFORE UPDATE en branches: impide deshabilitar una sucursal con citas pendientes, con empleados asignados o que sea la última activa.';

revoke execute on function app.prevent_disabling_branch_in_use() from public, anon, authenticated;

create trigger prevent_disabling_branch_in_use
  before update on branches
  for each row execute function app.prevent_disabling_branch_in_use();

-- =============================================================================
-- 4. Auditoría
-- =============================================================================
-- Quién cambió el nombre, el horario o el estado de una sucursal, y cuándo.
create trigger branches_audit
  after insert or update or delete on branches
  for each row execute function app.log_change();
