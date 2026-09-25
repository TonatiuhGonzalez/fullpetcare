-- Cierra el pendiente que dejó anotado rls_tenancy.sql desde la fase 1
-- (tarea 1.16): "memberships" y "membership_branches" nacieron con SOLO
-- política de SELECT porque v1 no tenía ninguna pantalla de
-- administración — se llenaban a mano por seed.sql. Esta fase SÍ agrega
-- esa pantalla (gestión de empleados), así que toca agregar las
-- políticas de escritura que ese comentario ya prometía, con su propio
-- test (CLAUDE.md §7.3: "toda tabla nueva... una tabla existente que
-- gana su primera escritura se cierra igual, con su política y su test").
--
-- El permiso real de "quién puede dar de alta/editar un empleado" NO se
-- hardcodea a 'owner' aquí: se pregunta a app.has_permission(), la misma
-- función que ya decide si se muestra la pestaña de empleados. Así, si
-- algún día un tenant decide que su "receptionist" también gestione
-- empleados, basta con cambiar una fila de role_permissions — ninguna
-- política de esta migración necesita tocarse.

-- =============================================================================
-- memberships: alta y edición de un empleado
-- =============================================================================
create policy memberships_insert on memberships for insert
  to authenticated
  with check (
    app.is_member_of(tenant_id)
    and app.has_permission(tenant_id, 'employees', 'edit')
  );

-- UPDATE cubre tanto editar el rol como desactivar el acceso
-- (`is_active = false`) — nunca se borra una membership (CLAUDE.md §7.3:
-- ninguna tabla de negocio tiene política de DELETE). Sin "and deleted_at
-- is null" en ninguna política de esta tabla, mismo motivo documentado en
-- customers.sql y ya anotado en rls_tenancy.sql para estas mismas cinco
-- tablas de tenencia.
create policy memberships_update on memberships for update
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and app.has_permission(tenant_id, 'employees', 'edit')
  )
  with check (
    app.is_member_of(tenant_id)
    and app.has_permission(tenant_id, 'employees', 'edit')
  );

-- Auditoría (CLAUDE.md §8.6): "memberships" ya estaba listada desde la
-- migración de audit.sql (fase 2) como tabla sensible pendiente de este
-- trigger — hasta hoy no tenía sentido, porque nunca se escribía desde la
-- app. Ahora que sí, se cierra el pendiente: quién le cambió el rol o
-- desactivó el acceso a quién, y cuándo.
create trigger memberships_audit
  after insert or update or delete on memberships
  for each row execute function app.log_change();

-- =============================================================================
-- membership_branches: a qué sucursales entra un empleado
-- =============================================================================
create policy membership_branches_insert on membership_branches for insert
  to authenticated
  with check (
    app.is_member_of(tenant_id)
    and app.has_permission(tenant_id, 'employees', 'edit')
  );

create policy membership_branches_update on membership_branches for update
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and app.has_permission(tenant_id, 'employees', 'edit')
  )
  with check (
    app.is_member_of(tenant_id)
    and app.has_permission(tenant_id, 'employees', 'edit')
  );

-- =============================================================================
-- profiles: el nombre de un empleado se edita desde la pantalla de
-- empleados, no solo por la propia persona
-- =============================================================================
-- "profiles" es identidad GLOBAL, sin tenant_id (CLAUDE.md §6.1: una
-- persona puede trabajar en dos negocios). Por eso esta política no
-- puede comparar contra "tenant_id" de la propia fila (no existe) — en
-- vez de eso, busca si la persona editada (profiles.id) tiene una
-- membership activa en ALGÚN tenant donde quien edita tenga
-- "employees:edit". Nota aceptada (documentada también en el plan de
-- esta fase): si una misma persona trabajara en dos negocios de este
-- sistema a la vez, el dueño de cualquiera de los dos podría cambiarle el
-- nombre para ambos — con datos ficticios de demo esto no ocurre; no se
-- resuelve con más estructura por ahora (CLAUDE.md §11, "no ampliar el
-- alcance").
create policy profiles_update on profiles for update
  to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from memberships m
      where m.user_id = profiles.id
        and m.is_active
        and m.deleted_at is null
        and app.has_permission(m.tenant_id, 'employees', 'edit')
    )
  )
  with check (
    id = auth.uid()
    or exists (
      select 1
      from memberships m
      where m.user_id = profiles.id
        and m.is_active
        and m.deleted_at is null
        and app.has_permission(m.tenant_id, 'employees', 'edit')
    )
  );
