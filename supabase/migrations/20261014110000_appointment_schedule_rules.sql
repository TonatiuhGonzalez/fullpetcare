-- Correcciones 1, tarea C1.2 (PLAN.md D26 puntos 1 y 2): reglas de fecha y hora
-- en la base y traslape que deja de rechazarse.
--
-- =============================================================================
-- Qué cambia
-- =============================================================================
-- 1. SE QUITA el rechazo "Este empleado ya tiene una cita en ese horario" de
--    create_appointment() y reschedule_appointment(). Un empleado puede quedar
--    con dos citas encimadas: ahora el traslape es un AVISO de la interfaz
--    (chip amarillo), no un bloqueo. Si la base siguiera rechazando, la
--    interfaz avisaría "esto se encima" y al guardar fallaría.
-- 2. SE AGREGAN, solo al crear con cita normal y al reprogramar, cuatro reglas
--    con mensaje y `hint` DISTINTOS (para que la interfaz sepa cuál fue):
--      - appointment_in_past:     inicio antes de now() de la base, sin
--                                 tolerancia. El "ahora" es el de la base, no el
--                                 del navegador (puede estar desfasado).
--      - end_before_start:        el fin no es posterior al inicio.
--      - branch_closed_day:       la sucursal no abre ese día de la semana.
--      - outside_branch_hours:    la cita no cabe completa en [apertura, cierre].
--    El horario se evalúa en la zona IANA de la sucursal (CLAUDE.md §8.3), no
--    en UTC: las 15:00Z son las 09:00 en Ciudad de México pero las 07:00 en
--    Tijuana en invierno. Mismo criterio que hoursForDate() y
--    computeAvailableSlots() de src/lib/availability.ts (clave por día de la
--    semana, valor {opensAt, closesAt} o null = cerrado; la cita cabe si
--    apertura <= inicio y fin <= cierre).
--
-- =============================================================================
-- Diseño: una función interna con una bandera, no copiar el cuerpo
-- =============================================================================
-- create_walk_in_appointment() (visita sin cita) llamaba a create_appointment()
-- y tiene su propia ventana de pasado de 10 minutos. Si siguiera llamando a la
-- función pública heredaría "pasado sin tolerancia" y "dentro del horario", que
-- NO le tocan (una urgencia puede llegar a las 8 pm). Opciones:
--   (a) un parámetro nuevo en create_appointment(): cambia la firma pública y
--       deja que quien llama desde el navegador se salte las reglas con
--       `p_validate_schedule = false`. Descartada: una regla que depende de
--       quien llama no protege nada.
--   (b) duplicar el cuerpo en las dos funciones: dos copias que se desfasan.
--   (c) elegida: el cuerpo vive en app.create_appointment_core(), que NO es
--       ejecutable por authenticated ni anon (solo la llaman las dos funciones
--       públicas, que son SECURITY DEFINER y corren como el dueño). La bandera
--       solo la pone el servidor, nunca el navegador.
-- Las firmas públicas no cambian, así que ni el frontend ni los GRANT existentes
-- se tocan (CREATE OR REPLACE conserva los permisos).
--
-- La interna revalida membresía, rol y sucursal por su cuenta (§7.3.4): aunque
-- algún día alguien la exponga por error, no es una puerta trasera.

-- =============================================================================
-- 1. Regla de ventana: pasado, día cerrado y horario de la sucursal
-- =============================================================================
create or replace function app.assert_appointment_window(
  p_branch_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns void
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_timezone text;
  v_hours_by_day jsonb;
  v_hours jsonb;
  v_local_start timestamp;
  v_local_end timestamp;
  v_day_key text;
  v_opens timestamp;
  v_closes timestamp;
begin
  -- Sin tolerancia: un inicio de hace un segundo ya es pasado. El valor lo
  -- manda el navegador, pero la comparación es contra el reloj de la base.
  if p_starts_at < now() then
    raise exception 'No se puede agendar una cita en una fecha u hora que ya pasó.'
      using errcode = 'check_violation', hint = 'appointment_in_past';
  end if;

  select b.timezone, b.opening_hours
    into v_timezone, v_hours_by_day
  from branches b
  where b.id = p_branch_id;

  if not found then
    raise exception 'La sucursal no existe.' using errcode = 'no_data_found';
  end if;

  -- `timestamptz AT TIME ZONE zona` devuelve la hora de pared local (sin zona).
  -- Con eso se saca el día de la semana y las horas del reloj de la sucursal.
  v_local_start := p_starts_at at time zone v_timezone;
  v_local_end := p_ends_at at time zone v_timezone;

  -- extract(dow) da 0 = domingo ... 6 = sábado, igual que Date.getDay() en JS
  -- y que el orden de WEEKDAY_KEYS en lib/availability.ts.
  v_day_key := (array['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])
    [extract(dow from v_local_start)::int + 1];

  v_hours := v_hours_by_day -> v_day_key;

  -- Cerrado = clave ausente, `null` JSON, o sin horas de apertura/cierre.
  if v_hours is null
     or jsonb_typeof(v_hours) <> 'object'
     or v_hours ->> 'opensAt' is null
     or v_hours ->> 'closesAt' is null then
    raise exception 'La sucursal está cerrada ese día.'
      using errcode = 'check_violation', hint = 'branch_closed_day';
  end if;

  v_opens := v_local_start::date + (v_hours ->> 'opensAt')::time;
  v_closes := v_local_start::date + (v_hours ->> 'closesAt')::time;

  -- La cita completa debe caber en [apertura, cierre]: terminar justo al cierre
  -- SÍ se permite, un minuto después NO. Una cita que cruza la medianoche
  -- siempre termina después del cierre de su día y también se rechaza.
  if v_local_start < v_opens or v_local_end > v_closes then
    raise exception 'La cita queda fuera del horario de la sucursal (de % a % ese día).',
      to_char(v_opens, 'HH24:MI'), to_char(v_closes, 'HH24:MI')
      using errcode = 'check_violation', hint = 'outside_branch_hours';
  end if;
end;
$$;

comment on function app.assert_appointment_window(uuid, timestamptz, timestamptz) is
  'Rechaza (check_violation, con hint) una cita en el pasado, en un día cerrado o fuera del horario de la sucursal, evaluado en la zona IANA de la sucursal. No revalida permisos: la usan funciones que ya lo hicieron.';

revoke execute on function app.assert_appointment_window(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- =============================================================================
-- 2. Cuerpo común de create_appointment() / create_walk_in_appointment()
-- =============================================================================
-- Es el cuerpo vigente de create_appointment() (role_permission_hardening.sql)
-- SIN el rechazo por traslape, y con la ventana de fechas opcional.
create function app.create_appointment_core(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_customer_id uuid,
  p_pet_id uuid,
  p_kind service_kind,
  p_employee_user_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_notes text,
  p_services jsonb,
  p_validate_schedule boolean
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
  -- correcto para el tipo de cita (se consulta memberships directo: aquí
  -- importa el rol de OTRO usuario, no el de auth.uid()).
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

  -- Esta regla vale siempre, incluso para una visita sin cita.
  if p_ends_at <= p_starts_at then
    raise exception 'La cita debe terminar después de que empieza.'
      using errcode = 'check_violation', hint = 'end_before_start';
  end if;

  -- Pasado, día cerrado y horario: solo en la agenda normal. La visita sin cita
  -- trae su propia ventana (10 minutos) y puede llegar fuera de horario.
  if p_validate_schedule then
    perform app.assert_appointment_window(p_branch_id, p_starts_at, p_ends_at);
  end if;

  -- OJO: aquí había un rechazo por traslape del mismo empleado. Se quitó a
  -- propósito (D26 punto 1): el traslape es un aviso de la interfaz.

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

comment on function app.create_appointment_core(uuid, uuid, uuid, uuid, service_kind, uuid, timestamptz, timestamptz, text, jsonb, boolean) is
  'Cuerpo común de create_appointment() y create_walk_in_appointment(). Solo ejecutable por las funciones públicas (SECURITY DEFINER); p_validate_schedule la fija el servidor.';

revoke execute on function app.create_appointment_core(uuid, uuid, uuid, uuid, service_kind, uuid, timestamptz, timestamptz, text, jsonb, boolean) from public, anon, authenticated;

-- =============================================================================
-- 3. create_appointment(): misma firma, ahora con las reglas de fecha
-- =============================================================================
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
begin
  -- Revalidación en la primera línea (§7.3.4); la interna la repite.
  if not app.is_member_of(p_tenant_id) then
    raise exception 'No perteneces a este negocio.' using errcode = 'insufficient_privilege';
  end if;

  return app.create_appointment_core(
    p_tenant_id, p_branch_id, p_customer_id, p_pet_id, p_kind,
    p_employee_user_id, p_starts_at, p_ends_at, p_notes, p_services, true
  );
end;
$$;

comment on function create_appointment(uuid, uuid, uuid, uuid, service_kind, uuid, timestamptz, timestamptz, text, jsonb) is
  'Crea una cita y sus appointment_services (con snapshots) en una sola transacción, revalidando membresía/rol/sucursal y que el empleado asignado pueda atender ese tipo. Rechaza pasado, fin <= inicio, día cerrado y fuera de horario (zona de la sucursal). NO rechaza traslape (D26).';

-- =============================================================================
-- 4. create_walk_in_appointment(): sin reglas de fecha de la agenda normal
-- =============================================================================
create or replace function create_walk_in_appointment(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_customer_id uuid,
  p_pet_id uuid,
  p_kind service_kind,
  p_employee_user_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_is_urgent boolean,
  p_notes text,
  p_services jsonb
)
returns appointments
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_appointment appointments;
begin
  if not app.is_member_of(p_tenant_id) then
    raise exception 'No perteneces a este negocio.' using errcode = 'insufficient_privilege';
  end if;

  if app.role_in(p_tenant_id) not in ('owner', 'receptionist') then
    raise exception 'No tienes permiso para registrar visitas.' using errcode = 'insufficient_privilege';
  end if;

  -- Un walk-in es "llegó ahora": su ventana de pasado es de 10 minutos y es la
  -- única regla de fecha que aplica (no horario de sucursal: una urgencia
  -- puede llegar fuera de horario).
  if p_starts_at < now() - interval '10 minutes' then
    raise exception 'Una visita sin cita debe empezar ahora o más tarde.' using errcode = 'check_violation';
  end if;

  v_appointment := app.create_appointment_core(
    p_tenant_id, p_branch_id, p_customer_id, p_pet_id, p_kind,
    p_employee_user_id, p_starts_at, p_ends_at, p_notes, p_services, false
  );

  update appointments
  set is_walk_in = true,
      is_urgent = coalesce(p_is_urgent, false),
      status = case
        when p_starts_at <= now() + interval '2 minutes' then 'in_progress'::appointment_status
        else 'scheduled'::appointment_status
      end
  where id = v_appointment.id
  returning * into v_appointment;

  return v_appointment;
end;
$$;

comment on function create_walk_in_appointment(uuid, uuid, uuid, uuid, service_kind, uuid, timestamptz, timestamptz, boolean, text, jsonb) is
  'Crea una cita marcada como visita sin cita (is_walk_in), opcionalmente urgente. Usa el cuerpo común sin las reglas de horario de la agenda; su única regla de fecha es la ventana de 10 minutos. No rechaza traslape.';

-- =============================================================================
-- 5. reschedule_appointment(): misma firma, mismas reglas de fecha
-- =============================================================================
create or replace function reschedule_appointment(
  p_appointment_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns appointments
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_appointment appointments;
  v_role member_role;
begin
  select * into v_appointment from appointments where id = p_appointment_id and deleted_at is null;
  if not found then
    raise exception 'La cita no existe.' using errcode = 'no_data_found';
  end if;

  if not app.is_member_of(v_appointment.tenant_id) or not app.can_access_branch(v_appointment.branch_id) then
    raise exception 'No tienes acceso a esta cita.' using errcode = 'insufficient_privilege';
  end if;

  v_role := app.role_in(v_appointment.tenant_id);
  if v_role not in ('owner', 'receptionist') and v_appointment.employee_user_id <> auth.uid() then
    raise exception 'No tienes permiso para reagendar esta cita.' using errcode = 'insufficient_privilege';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'La cita debe terminar después de que empieza.'
      using errcode = 'check_violation', hint = 'end_before_start';
  end if;

  -- Pasado, día cerrado y horario, con el horario de la sucursal de la cita.
  perform app.assert_appointment_window(v_appointment.branch_id, p_starts_at, p_ends_at);

  -- Sin rechazo por traslape (D26 punto 1).

  update appointments
  set starts_at = p_starts_at, ends_at = p_ends_at
  where id = p_appointment_id
  returning * into v_appointment;

  return v_appointment;
end;
$$;

comment on function reschedule_appointment(uuid, timestamptz, timestamptz) is
  'Cambia el horario de una cita, revalidando permiso y las mismas reglas de fecha que create_appointment() (pasado, fin <= inicio, día cerrado, fuera de horario). No rechaza traslape (D26).';
