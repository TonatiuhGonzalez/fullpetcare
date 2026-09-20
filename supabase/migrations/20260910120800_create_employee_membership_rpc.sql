-- RPC create_employee_membership() (CLAUDE.md §6.7, fase 9): da de alta
-- el ACCESO de un empleado ya invitado — membership + membership_branches
-- + employee_details, en una sola transacción. Mismo motivo que
-- checkout_appointment/create_appointment (PLAN.md §1.2): si la segunda
-- o tercera escritura fallara (una sucursal inválida, un dato raro),
-- quedaría un membership sin ficha o sin sucursales — un empleado a
-- medias. Se hace todo o nada.
--
-- Este RPC NO crea el usuario de auth.users — eso solo lo puede hacer
-- `auth.admin.inviteUserByEmail`, que exige la llave service_role y por
-- lo tanto vive en la Edge Function `invite-employee`, nunca en el
-- frontend (CLAUDE.md §10). El flujo completo (services/employees.ts):
-- 1) el frontend llama la Edge Function, que invita al correo y devuelve
--    el user_id ya creado (o reutilizado, si esa persona ya tenía cuenta
--    en otro negocio); 2) el frontend, con la sesión normal del dueño (NO
--    la Edge Function), llama este RPC con ese user_id.
create function create_employee_membership(
  p_tenant_id uuid,
  p_user_id uuid,
  p_role member_role,
  -- Ids de sucursal a asignar. Se ignora si p_role = 'owner' (el dueño ve
  -- todas las sucursales del tenant sin fila en membership_branches,
  -- CLAUDE.md §6.1 — mismo criterio que ya asume
  -- services/memberships.ts#listMyMemberships).
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
  v_valid_branch_count integer;
begin
  -- Revalida membresía y permiso aunque las políticas de RLS de
  -- memberships/membership_branches/employee_details ya pidan lo mismo
  -- (CLAUDE.md §7.3.4: toda función SECURITY DEFINER revalida adentro —
  -- salta RLS, así que sin esto sería una puerta trasera).
  if not app.is_member_of(p_tenant_id) then
    raise exception 'No perteneces a este negocio.' using errcode = 'insufficient_privilege';
  end if;

  if not app.has_permission(p_tenant_id, 'employees', 'edit') then
    raise exception 'No tienes permiso para dar de alta empleados.' using errcode = 'insufficient_privilege';
  end if;

  -- El unique(tenant_id, user_id) de memberships ya rechazaría un alta
  -- duplicada, pero con un error de restricción poco amigable — este
  -- chequeo previo da un mensaje que la UI puede mostrar tal cual
  -- (CLAUDE.md §5.4: sin jerga técnica).
  if exists (
    select 1 from memberships m
    where m.tenant_id = p_tenant_id and m.user_id = p_user_id
  ) then
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
  'Crea membership + membership_branches + employee_details en una sola transacción, revalidando "employees:edit". El usuario de auth.users debe existir ya (lo crea la Edge Function invite-employee antes de llamar este RPC).';

grant execute on function create_employee_membership(uuid, uuid, member_role, uuid[], date, text, text, text)
  to authenticated;
