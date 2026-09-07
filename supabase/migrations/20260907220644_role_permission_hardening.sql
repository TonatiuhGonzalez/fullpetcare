-- Endurece varias reglas de permisos que hasta ahora solo vivían (a
-- medias) en la interfaz, encontradas probando la app con datos reales
-- (ronda de UAT, 2026-09-07). CLAUDE.md §7: "no se confía en que el
-- código de la app filtre bien" — el aislamiento y los permisos reales
-- viven en Postgres, así que cada punto de abajo es un cambio de RLS o
-- de la función de agendar, no solo un botón que se oculta.
--
-- =============================================================================
-- 1. create_appointment(): el empleado asignado debe poder atender ESE
--    tipo de cita
-- =============================================================================
-- Hasta ahora la función solo validaba que QUIEN AGENDA sea owner/
-- receptionist (rls_helpers + la propia función) y que no hubiera
-- traslape de horario — pero nunca revisaba que el EMPLEADO ASIGNADO
-- (p_employee_user_id) tuviera el rol correcto para el tipo de cita. En
-- la práctica, recepción podía asignar una cita de veterinaria a un
-- groomer, o una de estética a un vet, o incluso a sí misma
-- (receptionist no atiende citas, solo las agenda — CLAUDE.md §6.1).
--
-- La regla: el empleado asignado debe ser 'owner' (que puede todo,
-- CLAUDE.md §6.1) o tener el rol que corresponde al tipo de la cita
-- ('groomer' para 'grooming', 'vet' para 'veterinary'). 'receptionist'
-- nunca es asignable, sin importar el tipo.
create or replace function create_appointment(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_customer_id uuid,
  p_pet_id uuid,
  p_kind service_kind,
  p_employee_user_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_notes text,
  p_services jsonb
)
returns appointments
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role member_role;
  v_employee_role member_role;
  v_required_role member_role;
  v_appointment appointments;
  v_conflict_count integer;
begin
  if not app.is_member_of(p_tenant_id) then
    raise exception 'No perteneces a este negocio.' using errcode = 'insufficient_privilege';
  end if;

  v_role := app.role_in(p_tenant_id);
  if v_role not in ('owner', 'receptionist') then
    raise exception 'No tienes permiso para agendar citas.' using errcode = 'insufficient_privilege';
  end if;

  if not app.can_access_branch(p_branch_id) then
    raise exception 'No tienes acceso a esta sucursal.' using errcode = 'insufficient_privilege';
  end if;

  -- El empleado asignado debe pertenecer al mismo tenant y tener el rol
  -- correcto para el tipo de cita. Se consulta "memberships" directo (no
  -- app.role_in(), que solo sabe del usuario ACTUAL vía auth.uid()) —
  -- aquí se necesita el rol de OTRO usuario, el que se está asignando.
  select m.role into v_employee_role
  from memberships m
  where m.user_id = p_employee_user_id
    and m.tenant_id = p_tenant_id
    and m.is_active
    and m.deleted_at is null;

  if v_employee_role is null then
    raise exception 'El empleado no pertenece a este negocio.' using errcode = 'insufficient_privilege';
  end if;

  v_required_role := case p_kind
    when 'grooming' then 'groomer'::member_role
    when 'veterinary' then 'vet'::member_role
  end;

  if v_employee_role <> 'owner' and v_employee_role <> v_required_role then
    raise exception 'Este empleado no puede atender citas de este tipo.' using errcode = 'check_violation';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'La cita debe terminar después de que empieza.' using errcode = 'check_violation';
  end if;

  select count(*) into v_conflict_count
  from appointments a
  where a.tenant_id = p_tenant_id
    and a.employee_user_id = p_employee_user_id
    and a.deleted_at is null
    and a.status not in ('cancelled', 'no_show')
    and a.starts_at < p_ends_at
    and a.ends_at > p_starts_at;

  if v_conflict_count > 0 then
    raise exception 'Este empleado ya tiene una cita en ese horario.' using errcode = 'check_violation';
  end if;

  insert into appointments (
    tenant_id, branch_id, customer_id, pet_id, kind,
    employee_user_id, starts_at, ends_at, notes, created_by
  )
  values (
    p_tenant_id, p_branch_id, p_customer_id, p_pet_id, p_kind,
    p_employee_user_id, p_starts_at, p_ends_at, p_notes, auth.uid()
  )
  returning * into v_appointment;

  insert into appointment_services (
    tenant_id, appointment_id, service_id,
    name_snapshot, unit_price_cents, quantity, duration_minutes_snapshot
  )
  select
    p_tenant_id,
    v_appointment.id,
    s.id,
    s.name,
    s.price_cents,
    coalesce((elem->>'quantity')::integer, 1),
    s.duration_minutes
  from jsonb_array_elements(p_services) as elem
  join services s
    on s.id = (elem->>'service_id')::uuid
   and s.tenant_id = p_tenant_id;

  return v_appointment;
end;
$$;

comment on function create_appointment(uuid, uuid, uuid, uuid, service_kind, uuid, timestamptz, timestamptz, text, jsonb) is
  'Crea una cita y sus appointment_services (con snapshots) en una sola transacción, revalidando membresía/rol/sucursal, que el EMPLEADO asignado pueda atender ese tipo de cita, y traslape de horario.';

-- =============================================================================
-- 2. appointments: groomer/vet solo ven SUS PROPIAS citas, no las de toda
--    la sucursal
-- =============================================================================
-- CLAUDE.md §6.1 ya decía "groomer/vet: Su agenda", pero la política
-- original solo filtraba por sucursal (app.can_access_branch), dejando
-- que cualquier rol viera TODAS las citas de la sucursal — un groomer
-- podía consultar (vía API directa, no solo ocultando el filtro en la
-- UI) las citas de veterinaria del vet. owner/receptionist siguen viendo
-- todo lo de sus sucursales (agendan y coordinan para todos).
drop policy appointments_select on appointments;

create policy appointments_select on appointments for select
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and app.can_access_branch(branch_id)
    and (
      app.role_in(tenant_id) in ('owner', 'receptionist')
      or employee_user_id = auth.uid()
    )
  );

-- appointment_services no necesita tocarse: su política de SELECT ya
-- hace un EXISTS contra appointments (migración appointments.sql), así
-- que hereda esta misma restricción automáticamente — Postgres aplica la
-- política de appointments también dentro de esa subconsulta.

-- =============================================================================
-- 3. share_links: generar y revocar el link público es tarea de
--    recepción/dueño, no de quien atiende
-- =============================================================================
-- La fase 7 dejó esto abierto a "cualquier rol activo" a propósito
-- ("generar el link de una mascota es parte de atenderla, sin importar
-- quién la atendió") — el UAT pidió lo contrario: ni groomer ni vet
-- deben poder generar (ni revocar) el link. Se restringe INSERT y
-- UPDATE a owner/receptionist; SELECT se deja igual (cualquier rol
-- puede seguir viendo qué links existen, por si necesita decirle al
-- cliente que ya tiene uno — nadie pidió ocultar eso).
drop policy share_links_insert on share_links;

create policy share_links_insert on share_links for insert
  to authenticated
  with check (
    app.is_member_of(tenant_id)
    and app.role_in(tenant_id) in ('owner', 'receptionist')
  );

drop policy share_links_update on share_links;

create policy share_links_update on share_links for update
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and app.role_in(tenant_id) in ('owner', 'receptionist')
  )
  with check (
    app.is_member_of(tenant_id)
    and app.role_in(tenant_id) in ('owner', 'receptionist')
  );

-- =============================================================================
-- 4. vaccinations / pet_weights: el groomer ve el ESTADO más reciente,
--    no el historial completo
-- =============================================================================
-- Punto medio decidido con el usuario: bloquear TODA lectura le quita al
-- groomer la razón original por la que vaccinations_select se dejó
-- abierta ("saber si puede bañar a una mascota con las vacunas al día",
-- migración vaccines.sql) — pero mostrarle el historial completo (fechas
-- de aplicaciones viejas, la gráfica de peso completa) es justo lo que
-- pidió el UAT que se ocultara. La política de abajo deja pasar una
-- fila SOLO si, para ese groomer, no existe otra fila MÁS RECIENTE del
-- mismo (pet_id, vaccine_id) [o del mismo pet_id, para pet_weights] — es
-- decir, únicamente la aplicación/pesada vigente. El resto de los roles
-- (owner, receptionist, vet) no cambia: siguen viendo todo.
--
-- Nota técnica: una política de RLS NO puede consultar la MISMA tabla
-- que protege directamente en su USING — Postgres lo rechaza en tiempo
-- de planeación con "infinite recursion detected in policy" (se
-- confirmó al correr los tests: intentar un `not exists (select 1 from
-- vaccinations v2 ...)` directo en la política de "vaccinations" truena
-- así, sin llegar siquiera a ejecutar la consulta). La solución es la
-- misma que ya usa TODO el proyecto para el problema hermano de
-- "memberships no puede consultarse a sí misma" (rls_helpers.sql):
-- envolver la pregunta en una función `SECURITY DEFINER`. Al correr con
-- los permisos de quien CREÓ la función (un superusuario en este
-- proyecto), esa consulta interna no está sujeta a RLS —
-- ni siquiera a la de "vaccinations"/"pet_weights" — así que puede
-- comparar contra las demás filas sin volver a disparar la política que
-- la está llamando.
create function app.is_latest_vaccination(
  p_pet_id uuid,
  p_vaccine_id uuid,
  p_applied_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select not exists (
    select 1
    from vaccinations v2
    where v2.pet_id = p_pet_id
      and v2.vaccine_id = p_vaccine_id
      and v2.applied_at > p_applied_at
  );
$$;

comment on function app.is_latest_vaccination(uuid, uuid, timestamptz) is
  'true si no existe otra vacunación del mismo (pet_id, vaccine_id) aplicada DESPUÉS de p_applied_at — o sea, si esta fila es la vigente.';

grant execute on function app.is_latest_vaccination(uuid, uuid, timestamptz) to authenticated;

create function app.is_latest_weight(p_pet_id uuid, p_measured_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select not exists (
    select 1
    from pet_weights w2
    where w2.pet_id = p_pet_id
      and w2.measured_at > p_measured_at
  );
$$;

comment on function app.is_latest_weight(uuid, timestamptz) is
  'true si no existe otra pesada de la misma mascota registrada DESPUÉS de p_measured_at — o sea, si esta fila es el peso actual.';

grant execute on function app.is_latest_weight(uuid, timestamptz) to authenticated;

drop policy vaccinations_select on vaccinations;

create policy vaccinations_select on vaccinations for select
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and (
      app.role_in(tenant_id) <> 'groomer'
      or app.is_latest_vaccination(pet_id, vaccine_id, applied_at)
    )
  );

drop policy pet_weights_select on pet_weights;

create policy pet_weights_select on pet_weights for select
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and (
      app.role_in(tenant_id) <> 'groomer'
      or app.is_latest_weight(pet_id, measured_at)
    )
  );
