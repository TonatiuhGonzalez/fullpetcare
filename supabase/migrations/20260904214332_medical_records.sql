-- Tabla medical_records: el expediente clínico (CLAUDE.md §6.4). Mismo
-- criterio de "expediente" que grooming_records (ver el comentario largo
-- ahí): sin `deleted_at`, sin política de DELETE, con
-- `prevent_hard_delete()` como refuerzo contra service_role.
create table medical_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  appointment_id uuid not null unique references appointments(id),
  pet_id uuid not null references pets(id),
  reason text,
  history text,
  examination text,
  diagnosis text,
  treatment text,
  indications text,
  -- Décimas de grado: 385 = 38.5 °C (CLAUDE.md §6.2, mismo criterio que
  -- weight_grams — nunca decimales para una magnitud médica).
  temperature_deci_c integer,
  -- Fecha SIN hora (CLAUDE.md §8.3): "próxima visita" es un día, no un
  -- instante — por eso `date`, no `timestamptz`.
  next_visit_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger medical_records_set_updated_at
  before update on medical_records
  for each row execute function app.set_updated_at();

create trigger medical_records_audit
  after insert or update or delete on medical_records
  for each row execute function app.log_change();

create trigger medical_records_prevent_hard_delete
  before delete on medical_records
  for each row execute function app.prevent_hard_delete();

create index medical_records_tenant_id_idx on medical_records (tenant_id);
create index medical_records_tenant_pet_idx on medical_records (tenant_id, pet_id);

alter table medical_records enable row level security;
alter table medical_records force row level security;

-- Lectura RESTRINGIDA a owner y vet (tarea 4.2, y CLAUDE.md §7.2 lo pone
-- de ejemplo explícito): ni receptionist ni groomer ven el expediente
-- clínico. Es la política que prueba la tarea 4.3 — que esto se cumpla
-- de verdad contra Postgres, no que la UI simplemente no muestre el
-- botón (CLAUDE.md §7: "no confiar en que el código de la app filtre
-- bien").
create policy medical_records_select on medical_records for select
  to authenticated
  using (app.is_member_of(tenant_id) and app.role_in(tenant_id) in ('owner', 'vet'));

-- Escribir: owner, o el vet ASIGNADO a esa cita — mismo criterio que
-- grooming_records con groomer.
create policy medical_records_insert on medical_records for insert
  to authenticated
  with check (
    app.is_member_of(tenant_id)
    and (
      app.role_in(tenant_id) = 'owner'
      or exists (
        select 1 from appointments a
        where a.id = medical_records.appointment_id
          and a.employee_user_id = auth.uid()
      )
    )
  );

create policy medical_records_update on medical_records for update
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and (
      app.role_in(tenant_id) = 'owner'
      or exists (
        select 1 from appointments a
        where a.id = medical_records.appointment_id
          and a.employee_user_id = auth.uid()
      )
    )
  )
  with check (
    app.is_member_of(tenant_id)
    and (
      app.role_in(tenant_id) = 'owner'
      or exists (
        select 1 from appointments a
        where a.id = medical_records.appointment_id
          and a.employee_user_id = auth.uid()
      )
    )
  );

-- Sin política de DELETE — igual que grooming_records.
