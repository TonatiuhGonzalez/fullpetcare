-- Tabla appointments y appointment_services (CLAUDE.md §6.3).
create type appointment_status as enum (
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
  'no_show'
);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  branch_id uuid not null references branches(id),
  customer_id uuid not null references customers(id),
  pet_id uuid not null references pets(id),
  -- Reusa el enum service_kind (migración services.sql): una cita es de
  -- un solo tipo (CLAUDE.md §6.3) — el mismo valor que ya separa el
  -- catálogo separa la agenda, no hace falta un segundo enum idéntico.
  kind service_kind not null,
  employee_user_id uuid not null references auth.users(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status appointment_status not null default 'scheduled',
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- Una cita no puede terminar antes de empezar. No valida traslapes
  -- entre citas distintas — eso necesita ver OTRAS filas, algo que un
  -- check constraint no puede hacer; se prueba a nivel de servicio
  -- (tarea 3.12, computeAvailableSlots en lib/availability.ts).
  check (ends_at > starts_at)
);

create trigger appointments_set_updated_at
  before update on appointments
  for each row execute function app.set_updated_at();

create trigger appointments_audit
  after insert or update or delete on appointments
  for each row execute function app.log_change();

-- Índice pedido explícitamente por la tarea 3.2: es exactamente el
-- filtro de "la agenda del día de esta sucursal" (tarea 3.17), la
-- consulta que más se repite en toda la app.
create index appointments_tenant_branch_starts_idx
  on appointments (tenant_id, branch_id, starts_at);

-- Para "la agenda de ESTE empleado" (filtro de useAgendaStore, tarea 3.14).
create index appointments_tenant_employee_starts_idx
  on appointments (tenant_id, employee_user_id, starts_at);

alter table appointments enable row level security;
alter table appointments force row level security;

-- Sin "and deleted_at is null" — misma trampa de siempre (CLAUDE.md
-- §7.2): esta tabla tiene UPDATE para roles autenticados.
--
-- app.can_access_branch() (no solo is_member_of): el rol importa para
-- QUIÉN puede escribir, pero para LEER lo que importa es la sucursal —
-- CLAUDE.md §6.1 dice "receptionist: sus sucursales", "groomer/vet: sus
-- sucursales". can_access_branch() ya resuelve "owner ve todas sin
-- necesidad de fila en membership_branches" por dentro (rls_helpers.sql).
create policy appointments_select on appointments for select
  to authenticated
  using (app.is_member_of(tenant_id) and app.can_access_branch(branch_id));

-- Agendar es tarea de recepción/dueño (CLAUDE.md §6.1) — groomer/vet
-- atienden citas, no las agendan.
create policy appointments_insert on appointments for insert
  to authenticated
  with check (
    app.is_member_of(tenant_id)
    and app.can_access_branch(branch_id)
    and app.role_in(tenant_id) in ('owner', 'receptionist')
  );

-- UPDATE es más permisivo que INSERT a propósito: además de
-- owner/receptionist (reagendar, cancelar — tarea 3.19), el EMPLEADO
-- asignado a la cita puede actualizarla — es como marca su propia cita
-- "en curso" o "completada" al atenderla (fase 4). No puede tocar
-- citas de otros empleados: la condición exige que sea SU cita.
create policy appointments_update on appointments for update
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and app.can_access_branch(branch_id)
    and (
      app.role_in(tenant_id) in ('owner', 'receptionist')
      or employee_user_id = auth.uid()
    )
  )
  with check (
    app.is_member_of(tenant_id)
    and app.can_access_branch(branch_id)
    and (
      app.role_in(tenant_id) in ('owner', 'receptionist')
      or employee_user_id = auth.uid()
    )
  );

-- =============================================================================
-- appointment_services
-- =============================================================================
create table appointment_services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  appointment_id uuid not null references appointments(id),
  service_id uuid not null references services(id),
  -- *_snapshot: copiados del servicio AL MOMENTO de agendar, y nunca se
  -- vuelven a leer de "services" después (CLAUDE.md §6.3). Si mañana
  -- sube el precio del baño, esta fila conserva el precio de hoy — un
  -- ticket histórico nunca cambia de monto.
  name_snapshot text not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity integer not null default 1 check (quantity > 0),
  duration_minutes_snapshot integer not null check (duration_minutes_snapshot > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger appointment_services_set_updated_at
  before update on appointment_services
  for each row execute function app.set_updated_at();

create trigger appointment_services_audit
  after insert or update or delete on appointment_services
  for each row execute function app.log_change();

create index appointment_services_tenant_appointment_idx
  on appointment_services (tenant_id, appointment_id);

alter table appointment_services enable row level security;
alter table appointment_services force row level security;

-- El acceso de appointment_services sigue al de su cita: si no se puede
-- ver la cita (otra sucursal), tampoco sus servicios. Se resuelve con un
-- EXISTS contra appointments — sus políticas YA filtran por sucursal,
-- así que no hace falta repetir can_access_branch() aquí.
create policy appointment_services_select on appointment_services for select
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and exists (
      select 1 from appointments a
      where a.id = appointment_services.appointment_id
        and app.can_access_branch(a.branch_id)
    )
  );

-- Componer qué servicios lleva una cita es parte de agendarla —
-- owner/receptionist, igual que appointments_insert.
create policy appointment_services_insert on appointment_services for insert
  to authenticated
  with check (
    app.is_member_of(tenant_id)
    and app.role_in(tenant_id) in ('owner', 'receptionist')
  );

create policy appointment_services_update on appointment_services for update
  to authenticated
  using (app.is_member_of(tenant_id) and app.role_in(tenant_id) in ('owner', 'receptionist'))
  with check (
    app.is_member_of(tenant_id) and app.role_in(tenant_id) in ('owner', 'receptionist')
  );

-- Deuda pendiente de la migración pets.sql (fase 2): pet_weights.
-- appointment_id se dejó sin FK porque appointments todavía no existía
-- — Postgres no permite una foreign key contra una tabla inexistente.
-- Ahora que sí existe, se completa la restricción.
alter table pet_weights
  add constraint pet_weights_appointment_id_fkey
  foreign key (appointment_id) references appointments(id);
