-- Tabla employee_details (CLAUDE.md §6.7, fase 9): datos personales del
-- empleado que NO viven en "profiles" (identidad global, compartida entre
-- negocios, CLAUDE.md §6.1) ni en "memberships" (relación con el rol).
-- Extiende 1 a 1 una membership YA existente — un "empleado" en esta
-- pantalla ES la persona que ya tiene membership en este tenant, no un
-- registro de RH aparte (decisión tomada con el usuario antes de esta
-- fase). Por eso membership_id es UNIQUE y no hay columna user_id propia:
-- para saber quién es esta persona, se llega a través del membership.
create table employee_details (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  membership_id uuid not null unique references memberships(id),
  birth_date date,
  -- CURP y RFC como texto libre, sin "check" de formato en la base — mismo
  -- criterio que customers.rfc (customers.sql): la validación de FORMA
  -- vive en lib/validation.ts (función pura, fácil de probar y de ajustar
  -- sin migración), no en una restricción de columna.
  curp text,
  rfc text,
  -- Clave de la credencial de elector (INE), como texto. El documento
  -- escaneado (foto/PDF) es un archivo aparte en Storage — ver
  -- employee_documents.sql — porque un archivo necesita su propia fila
  -- (quién lo subió, cuándo, qué tipo) y su propia política de Storage.
  voter_id_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index employee_details_tenant_id_idx on employee_details (tenant_id);

create trigger employee_details_set_updated_at
  before update on employee_details
  for each row execute function app.set_updated_at();

-- Auditoría (CLAUDE.md §8.6): CURP y RFC son datos personales sensibles,
-- igual criterio que customers/pets — cada cambio queda en audit_log con
-- quién lo hizo y los valores antes/después.
create trigger employee_details_audit
  after insert or update or delete on employee_details
  for each row execute function app.log_change();

comment on table employee_details is
  'Datos personales de un empleado (CURP, RFC, fecha de nacimiento, clave de elector), 1 a 1 con una membership. Visible/editable solo con permiso del módulo "employees" (app.has_permission).';

alter table employee_details enable row level security;
alter table employee_details force row level security;

-- A propósito SIN "and deleted_at is null" (misma trampa de CLAUDE.md
-- §7.2 documentada en customers.sql): esta tabla SÍ tiene UPDATE para un
-- rol autenticado normal (quien tiene permiso de "employees:edit"), y
-- Postgres exige que la fila resultante de un UPDATE siga pasando el
-- SELECT de su propia tabla. Si aquí se filtrara "deleted_at is null", el
-- borrado suave fallaría siempre. Ocultar los registros borrados de una
-- lista es trabajo de services/employees.ts (`.is('deleted_at', null)`
-- explícito), no de esta política.
create policy employee_details_select on employee_details for select
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and app.has_permission(tenant_id, 'employees', 'view')
  );

create policy employee_details_insert on employee_details for insert
  to authenticated
  with check (
    app.is_member_of(tenant_id)
    and app.has_permission(tenant_id, 'employees', 'edit')
  );

create policy employee_details_update on employee_details for update
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and app.has_permission(tenant_id, 'employees', 'edit')
  )
  with check (
    app.is_member_of(tenant_id)
    and app.has_permission(tenant_id, 'employees', 'edit')
  );

-- Sin política de DELETE (CLAUDE.md §7.3): el borrado es siempre suave,
-- vía `update ... set deleted_at = now()`, que cae bajo la política de
-- UPDATE de arriba. A diferencia del expediente clínico, employee_details
-- SÍ admite borrado suave normal (no es un documento legal que deba
-- conservar versiones) — lo que nunca se hace es borrar el acceso: eso es
-- responsabilidad de memberships.is_active, no de esta tabla.
