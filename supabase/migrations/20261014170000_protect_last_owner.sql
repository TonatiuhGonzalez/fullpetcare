-- Correcciones 1, C1.18 (PLAN.md D26): un negocio no se puede quedar sin dueño activo.
--
-- Hueco que dejó C1.6: `delete_employee()` ya rechaza eliminar al último dueño, pero la
-- regla vivía solo ahí y en la pantalla de empleados. Un UPDATE directo a `memberships`
-- (desactivar con `is_active = false`, poner `deleted_at` o cambiarle el rol a otra cosa)
-- se la saltaba, y un negocio sin dueño activo no tiene quién administre empleados,
-- sucursales ni facturación.
--
-- Por qué un trigger y no solo la RPC: la regla debe valer para TODAS las puertas de la tabla
-- (CLAUDE.md §7.3, mismo criterio que el trigger de citas programadas de C1.6).
--
-- Qué cuenta como "perder" al dueño: que una membresía que hoy es dueño activo y no está
-- eliminada pase a inactiva, eliminada, o deje de tener rol `owner`. Se permite si en el mismo
-- negocio queda OTRO dueño activo.
--
-- El candado (`pg_advisory_xact_lock`) evita la carrera de dos dueños que se desactivan entre
-- sí al mismo tiempo: sin él, cada transacción vería al otro todavía activo y las dos pasarían,
-- dejando cero dueños. Con el candado, la segunda espera a que la primera termine y entonces
-- ya ve que no queda nadie más.

create function app.prevent_losing_last_owner()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  -- Solo importa si ESTA fila era un dueño activo y vigente...
  if not (old.role = 'owner' and old.is_active and old.deleted_at is null) then
    return new;
  end if;

  -- ...y deja de serlo con este cambio.
  if new.is_active and new.deleted_at is null and new.role = 'owner' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('last_owner:' || old.tenant_id::text, 0));

  if not exists (
    select 1
    from memberships m
    where m.tenant_id = old.tenant_id
      and m.id <> old.id
      and m.role = 'owner'
      and m.is_active
      and m.deleted_at is null
  ) then
    raise exception 'Debe quedar al menos un dueño activo en el negocio.'
      using errcode = 'check_violation', hint = 'last_active_owner';
  end if;

  return new;
end;
$$;

comment on function app.prevent_losing_last_owner() is
  'Trigger BEFORE UPDATE en memberships: impide desactivar, eliminar o quitarle el rol owner al último dueño activo de un negocio. Candado por negocio contra dos cambios simultáneos.';

revoke execute on function app.prevent_losing_last_owner() from public, anon, authenticated;

create trigger prevent_losing_last_owner
  before update of is_active, deleted_at, role on memberships
  for each row execute function app.prevent_losing_last_owner();
