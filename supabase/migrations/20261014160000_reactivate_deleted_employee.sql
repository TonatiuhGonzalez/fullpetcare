-- Correcciones 1 (PLAN.md D26 punto 8): volver a dar de alta a un empleado
-- ELIMINADO lo reactiva en vez de rechazarlo.
--
-- Problema: memberships tiene unique (tenant_id, user_id) y esa restricción
-- incluye las filas con borrado suave. Tras delete_employee() (C1.6), la fila
-- eliminada seguía ocupando el lugar y create_employee_membership() decía
-- "Esta persona ya tiene acceso" aunque ya no lo tuviera.
--
-- Solución: si existe una membresía del mismo usuario en el mismo negocio con
-- deleted_at NO nulo, el alta la REACTIVA (deleted_at = null, is_active = true,
-- rol nuevo), reemplaza sus sucursales y actualiza su ficha. Si la membresía
-- existe y NO está eliminada (activa o solo desactivada), se rechaza igual que
-- antes. Se reutiliza la fila (no se inserta otra) porque el unique la haría
-- chocar y porque así la bitácora (audit_log, trigger memberships_audit)
-- conserva la historia de la misma membresía: queda un UPDATE de reactivación.
--
-- Qué se conserva: firma pública, revalidación de membresía y permiso
-- employees:edit (§7.3.4), y el trigger de negocio en solo lectura (corre en
-- los INSERT/UPDATE de abajo, auth.uid() sigue siendo quien llama). El trigger
-- de citas programadas de C1.6 solo vigila el paso a "sin acceso", así que no
-- estorba al reactivar.
--
-- membership_branches: unique (membership_id, branch_id) también incluye
-- borradas suaves (igual que explica replaceBranchAssignments en
-- src/services/employees.ts): por eso las sucursales que ya tenía se
-- reactivan con UPDATE, las que sobran se ocultan y solo las realmente nuevas
-- se insertan.
--
-- Migración aditiva (§8.1): CREATE OR REPLACE, misma firma.

create or replace function create_employee_membership(
  p_tenant_id uuid,
  p_user_id uuid,
  p_role member_role,
  p_branch_ids uuid[],
  p_birth_date date,
  p_curp text,
  p_rfc text,
  p_voter_id_number text
)
returns memberships
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_membership memberships;
  v_existing memberships;
  v_valid_branch_count integer;
begin
  if not app.is_member_of(p_tenant_id) then
    raise exception 'No perteneces a este negocio.' using errcode = 'insufficient_privilege';
  end if;

  if not app.has_permission(p_tenant_id, 'employees', 'edit') then
    raise exception 'No tienes permiso para dar de alta empleados.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_existing
  from memberships m
  where m.tenant_id = p_tenant_id and m.user_id = p_user_id;

  -- Existe y NO está eliminada: se rechaza como siempre. (Una eliminada de
  -- OTRO negocio no entra aquí: la búsqueda es por tenant_id.)
  if found and v_existing.deleted_at is null then
    raise exception 'Esta persona ya tiene acceso a este negocio.' using errcode = 'unique_violation';
  end if;

  if p_role <> 'owner' and coalesce(array_length(p_branch_ids, 1), 0) > 0 then
    select count(*) into v_valid_branch_count
    from branches b
    where b.id = any(p_branch_ids) and b.tenant_id = p_tenant_id;

    if v_valid_branch_count <> array_length(p_branch_ids, 1) then
      raise exception 'Una o más sucursales no pertenecen a este negocio.' using errcode = 'insufficient_privilege';
    end if;
  end if;

  if v_existing.id is not null then
    -- Reactivación de una membresía eliminada.
    update memberships
       set deleted_at = null, is_active = true, role = p_role
     where id = v_existing.id
    returning * into v_membership;

    -- Se ocultan las sucursales que ya no van (todas, si es dueño)...
    update membership_branches
       set deleted_at = now()
     where membership_id = v_membership.id
       and deleted_at is null
       and (p_role = 'owner' or branch_id <> all (coalesce(p_branch_ids, '{}'::uuid[])));

    if p_role <> 'owner' then
      -- ...se reactivan las que ya existían (borradas suaves)...
      update membership_branches
         set deleted_at = null
       where membership_id = v_membership.id
         and deleted_at is not null
         and branch_id = any(coalesce(p_branch_ids, '{}'::uuid[]));

      -- ...y se insertan solo las verdaderamente nuevas.
      insert into membership_branches (tenant_id, membership_id, branch_id)
      select p_tenant_id, v_membership.id, b
      from unnest(coalesce(p_branch_ids, '{}'::uuid[])) as b
      where not exists (
        select 1 from membership_branches mb
        where mb.membership_id = v_membership.id and mb.branch_id = b
      );
    end if;

    -- La ficha personal (1 a 1 con la membresía) se actualiza o se crea.
    update employee_details
       set birth_date = p_birth_date, curp = p_curp, rfc = p_rfc,
           voter_id_number = p_voter_id_number, deleted_at = null
     where membership_id = v_membership.id;

    if not found then
      insert into employee_details (tenant_id, membership_id, birth_date, curp, rfc, voter_id_number)
      values (p_tenant_id, v_membership.id, p_birth_date, p_curp, p_rfc, p_voter_id_number);
    end if;

    return v_membership;
  end if;

  insert into memberships (tenant_id, user_id, role, is_active)
  values (p_tenant_id, p_user_id, p_role, true)
  returning * into v_membership;

  if p_role <> 'owner' then
    insert into membership_branches (tenant_id, membership_id, branch_id)
    select p_tenant_id, v_membership.id, branch_id
    from unnest(p_branch_ids) as branch_id;
  end if;

  insert into employee_details (tenant_id, membership_id, birth_date, curp, rfc, voter_id_number)
  values (p_tenant_id, v_membership.id, p_birth_date, p_curp, p_rfc, p_voter_id_number);

  return v_membership;
end;
$$;

comment on function create_employee_membership(uuid, uuid, member_role, uuid[], date, text, text, text) is
  'Crea membership + membership_branches + employee_details en una sola transacción, revalidando "employees:edit". Si ya existe una membresía ELIMINADA del mismo usuario en el negocio, la reactiva (rol y sucursales nuevos). Rechaza si existe y no está eliminada.';

-- anon y PUBLIC no deben poder ni intentar ejecutarla (§7.3, regla 3); la
-- migración original solo hacía GRANT a authenticated y dejaba el default.
revoke execute on function create_employee_membership(uuid, uuid, member_role, uuid[], date, text, text, text) from public, anon;
grant execute on function create_employee_membership(uuid, uuid, member_role, uuid[], date, text, text, text) to authenticated;
