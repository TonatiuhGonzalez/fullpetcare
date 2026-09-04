-- Funciones para agendar y reagendar citas (tarea 3.10), llamadas desde
-- services/appointments.ts vía `supabase.rpc(...)`.
--
-- =============================================================================
-- Por qué esto es una función de base de datos y no dos INSERTs seguidos
-- desde el frontend
-- =============================================================================
-- Agendar una cita escribe en DOS tablas relacionadas: `appointments` (la
-- cita) y `appointment_services` (qué servicios lleva, con sus
-- snapshots — CLAUDE.md §6.3). PostgREST (la API que arma Supabase sobre
-- las tablas) no da transacciones multi-tabla desde el cliente: cada
-- `.from(...).insert(...)` es su propia transacción, aislada de la
-- siguiente. Si se hicieran dos llamadas seguidas desde el frontend y la
-- segunda fallara (se cae la conexión, el navegador se cierra), quedaría
-- una cita "fantasma" sin ningún servicio — ni una fila normal ni un
-- error claro, un estado a medias.
--
-- Una función de Postgres, en cambio, SÍ corre dentro de una sola
-- transacción de base de datos: todo lo que hace el `insert into
-- appointments` y el `insert into appointment_services` de abajo se
-- confirma junto o se revierte junto si algo falla a medio camino (por
-- ejemplo, un service_id que no existe). No puede quedar una cita sin
-- sus servicios.
--
-- SECURITY DEFINER es obligatorio aquí (igual razón que en
-- audit.sql/log_change: sin esto, la función correría con los permisos
-- del usuario normal y su propio INSERT respetaría RLS de las tablas —
-- lo cual estaría bien en teoría, pero entonces esta función no
-- necesitaría existir: sería exactamente lo mismo que dos inserts
-- sueltos desde el cliente). Como SECURITY DEFINER SALTA RLS,
-- CLAUDE.md §7.3 regla 4 exige revalidar membresía y rol A MANO dentro
-- de la función — son las primeras líneas de create_appointment().
--
-- =============================================================================
-- Por qué esta función vive en "public" y no en "app"
-- =============================================================================
-- Todo lo demás "interno" del proyecto (is_member_of, role_in,
-- can_access_branch, log_change...) vive en el esquema `app`, separado
-- de `public` a propósito (extensions_and_helpers.sql, fase 1):
-- `public` es lo que PostgREST — la API que genera Supabase — expone
-- hacia afuera; `app` es maquinaria interna que ninguna tabla ni
-- cliente necesita "ver" directo. Esa misma regla significa que
-- `supabase.rpc('create_appointment', ...)` SOLO encuentra la función
-- si vive en `public` — PostgREST resuelve el nombre de la función
-- contra el esquema que expone como API, y por diseño de este proyecto
-- ese esquema es únicamente `public`. Una función pensada para
-- llamarse desde el frontend es, por definición, parte de la API — le
-- corresponde `public`, aunque por dentro llame a funciones de `app`
-- sin ningún problema (eso es una llamada normal de SQL, no pasa por
-- PostgREST).
--
-- =============================================================================
-- Sobre el traslape de horarios (tarea 3.12) — qué SÍ y qué NO garantiza esto
-- =============================================================================
-- La función revisa, dentro de la misma transacción, que no exista ya
-- una cita del mismo empleado que se traslape con el horario pedido, y
-- si la encuentra, cancela todo con una excepción — nada se llega a
-- escribir. Esto cubre el caso normal: dos solicitudes de agendar en
-- momentos distintos.
--
-- Lo que esto NO cubre: dos solicitudes verdaderamente SIMULTÁNEAS para
-- el mismo hueco (dos personas dando "guardar" en el mismo segundo). Con
-- el nivel de aislamiento por default de Postgres (READ COMMITTED), las
-- dos transacciones podrían revisar "¿hay traslape?" al mismo tiempo,
-- las dos ver que no, y las dos insertar. La forma de cerrar ESE hueco
-- del todo es una restricción EXCLUDE con un índice GIST sobre el rango
-- de tiempo — más pieza de la que hace falta para un demo de un usuario
-- a la vez tecleando en su propia sucursal (CLAUDE.md §11, "simple sobre
-- elegante"); se deja anotado aquí por si algún día el proyecto crece a
-- necesitarlo de verdad.
create function create_appointment(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_customer_id uuid,
  p_pet_id uuid,
  p_kind service_kind,
  p_employee_user_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_notes text,
  -- Arreglo de objetos: [{"service_id": "...", "quantity": 1}, ...].
  -- jsonb en vez de un tipo de Postgres a la medida: así
  -- services/appointments.ts arma un array de JS normal y
  -- supabase.rpc() lo manda tal cual, sin tener que declarar un tipo
  -- compuesto aparte solo para esta llamada.
  p_services jsonb
)
returns appointments
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role member_role;
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

  if p_ends_at <= p_starts_at then
    raise exception 'La cita debe terminar después de que empieza.' using errcode = 'check_violation';
  end if;

  -- Traslape: citas del MISMO empleado, no canceladas ni "no_show" (esas
  -- dejan el horario libre de verdad), cuyo rango se cruza con el
  -- pedido. "< / >" estrictos a propósito: una cita que termina
  -- exactamente cuando otra empieza no se traslapa (mismo criterio que
  -- lib/availability.ts, tarea 3.7).
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

  -- El *_snapshot se copia AQUÍ, del catálogo tal como está en este
  -- instante — nunca se vuelve a leer "services" para esta cita después
  -- (CLAUDE.md §6.3).
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
  'Crea una cita y sus appointment_services (con snapshots) en una sola transacción, revalidando membresía/rol/sucursal y traslape de horario.';

grant execute on function create_appointment(uuid, uuid, uuid, uuid, service_kind, uuid, timestamptz, timestamptz, text, jsonb)
  to authenticated;

-- Reagendar necesita el MISMO chequeo de traslape que crear (el nuevo
-- horario podría chocar con otra cita del empleado) — por eso también
-- es una función y no un UPDATE directo desde el cliente. Se excluye la
-- propia cita del chequeo de traslape (`a.id <> p_appointment_id`): de
-- lo contrario, la cita siempre "chocaría contra sí misma".
create function reschedule_appointment(
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
  v_conflict_count integer;
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
    raise exception 'La cita debe terminar después de que empieza.' using errcode = 'check_violation';
  end if;

  select count(*) into v_conflict_count
  from appointments a
  where a.tenant_id = v_appointment.tenant_id
    and a.employee_user_id = v_appointment.employee_user_id
    and a.id <> p_appointment_id
    and a.deleted_at is null
    and a.status not in ('cancelled', 'no_show')
    and a.starts_at < p_ends_at
    and a.ends_at > p_starts_at;

  if v_conflict_count > 0 then
    raise exception 'Este empleado ya tiene una cita en ese horario.' using errcode = 'check_violation';
  end if;

  update appointments
  set starts_at = p_starts_at, ends_at = p_ends_at
  where id = p_appointment_id
  returning * into v_appointment;

  return v_appointment;
end;
$$;

comment on function reschedule_appointment(uuid, timestamptz, timestamptz) is
  'Cambia el horario de una cita, revalidando permiso y traslape (excluyendo la propia cita del chequeo).';

grant execute on function reschedule_appointment(uuid, timestamptz, timestamptz) to authenticated;
