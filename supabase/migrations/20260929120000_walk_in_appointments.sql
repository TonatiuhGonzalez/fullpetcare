-- Visitas sin cita (walk-in): alguien llega directo al establecimiento,
-- por emergencia o sin conocer el sistema (tarea #1969).
--
-- =============================================================================
-- Decisión de modelo: un walk-in ES una cita, no una tabla aparte
-- =============================================================================
-- Todo lo que viene después de agendar (atender, cobrar, historial de la
-- mascota, vista pública) cuelga de `appointments`. Si el walk-in viviera
-- en otra tabla, habría que duplicar cada uno de esos flujos. En cambio,
-- se marca la cita con dos booleanos y ya: el resto del sistema no se
-- entera de la diferencia.
--
--   - is_walk_in: llegó sin cita previa. Sirve para distinguirla en la
--     agenda y, más adelante, medir cuánto negocio llega sin agendar.
--   - is_urgent: es una emergencia. Solo informativo en v1 (se pinta
--     distinto en la agenda); no cambia reglas de traslape.
--
-- Ambos son `not null default false`: las citas que ya existen quedan como
-- "con cita, no urgente" sin tocarlas (migración aditiva, sin reescribir
-- datos).
alter table appointments
  add column is_walk_in boolean not null default false,
  add column is_urgent boolean not null default false;

-- =============================================================================
-- create_walk_in_appointment(): crea la cita y la marca, en una transacción
-- =============================================================================
-- No repite las validaciones de create_appointment() (membresía, rol,
-- sucursal, que el empleado pueda atender ese tipo, traslape, snapshots de
-- servicios): la LLAMA. Una función de Postgres corre dentro de una sola
-- transacción, así que si create_appointment() falla, no se escribe nada;
-- y si el UPDATE de abajo falla, tampoco queda la cita a medias.
--
-- Por qué así y no un parámetro nuevo en create_appointment(): cambiar la
-- firma de una función que ya usa el frontend obligaría a borrarla y
-- recrearla (Postgres trata dos firmas distintas como dos funciones), y
-- cualquier llamada vieja se rompería. Una función nueva no toca nada de
-- lo que ya funciona.
--
-- El estado inicial lo decide la base, no el cliente:
--   - Empieza ya (p_starts_at a lo más 2 minutos en el futuro) →
--     'in_progress': la mascota ya está ahí siendo atendida.
--   - Empieza más tarde (el empleado está ocupado y el cliente decidió
--     esperar) → se queda 'scheduled', y se atiende desde la agenda como
--     cualquier cita.
-- Se compara contra now() de la base, no contra el reloj del navegador,
-- que puede estar desfasado.
--
-- SECURITY DEFINER por la misma razón que create_appointment(): el UPDATE
-- final de estado lo hace la propia función. La revalidación de membresía
-- y rol ya ocurrió dentro de create_appointment() (regla §7.3.4) y aquí se
-- repite solo lo mínimo para no dejar una puerta trasera si esa función
-- cambiara algún día.
create function create_walk_in_appointment(
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

  -- Un walk-in es "llegó ahora". Aceptar un inicio de hace horas sería
  -- registrar con esta función una cita ya pasada, que no es su propósito.
  if p_starts_at < now() - interval '10 minutes' then
    raise exception 'Una visita sin cita debe empezar ahora o más tarde.' using errcode = 'check_violation';
  end if;

  v_appointment := create_appointment(
    p_tenant_id, p_branch_id, p_customer_id, p_pet_id, p_kind,
    p_employee_user_id, p_starts_at, p_ends_at, p_notes, p_services
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
  'Crea una cita marcada como visita sin cita (is_walk_in), opcionalmente urgente. Reutiliza create_appointment() (validaciones, traslape, snapshots) y la deja en curso si empieza ya.';

-- Como en toda función pública del proyecto: solo usuarios con sesión.
-- `anon` y PUBLIC no pueden llamarla (CLAUDE.md §7.3, regla 3).
revoke execute on function create_walk_in_appointment(uuid, uuid, uuid, uuid, service_kind, uuid, timestamptz, timestamptz, boolean, text, jsonb) from public, anon;
grant execute on function create_walk_in_appointment(uuid, uuid, uuid, uuid, service_kind, uuid, timestamptz, timestamptz, boolean, text, jsonb) to authenticated;
