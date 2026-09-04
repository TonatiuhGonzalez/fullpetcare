-- Tabla grooming_records: la ficha de estética (CLAUDE.md §6.4).
--
-- Es EXPEDIENTE (junto con medical_records y vaccinations, que llegan en
-- esta misma fase): a diferencia de toda otra tabla del proyecto, NO
-- lleva `deleted_at`. CLAUDE.md §8.5 es explícito: "en expediente
-- clínico no hay borrado, ni suave ni duro. Se corrige con una nueva
-- versión del registro y la bitácora guarda la anterior." — es decir,
-- un error se arregla con un UPDATE normal (que sí está permitido; lo
-- que nunca se permite es que la fila desaparezca), y `app.log_change()`
-- ya guarda automáticamente el valor anterior en `audit_log` en cada
-- UPDATE, así que "la versión vieja" nunca se pierde aunque la tabla no
-- tenga su propio historial de versiones.
create table grooming_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  appointment_id uuid not null unique references appointments(id),
  pet_id uuid not null references pets(id),
  cut_style text,
  blade_used text,
  shampoo_used text,
  behavior_notes text,
  groomer_notes text,
  condition_observations text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger grooming_records_set_updated_at
  before update on grooming_records
  for each row execute function app.set_updated_at();

create trigger grooming_records_audit
  after insert or update or delete on grooming_records
  for each row execute function app.log_change();

-- El cinturón además del tirante de CLAUDE.md §8.5: sin política de
-- DELETE ya nadie autenticado normal puede borrar (regla general, CLAUDE.md
-- §7.3), pero service_role sí bypassa RLS — este trigger lo detiene a
-- él también. Ver el comentario largo en la migración soft_delete.sql
-- (fase 2) para el porqué completo.
create trigger grooming_records_prevent_hard_delete
  before delete on grooming_records
  for each row execute function app.prevent_hard_delete();

create index grooming_records_tenant_id_idx on grooming_records (tenant_id);
create index grooming_records_tenant_pet_idx on grooming_records (tenant_id, pet_id);

alter table grooming_records enable row level security;
alter table grooming_records force row level security;

-- Lectura: owner, receptionist y groomer (tarea 4.1) — receptionist NO
-- atiende cortes, pero sí necesita poder consultar el historial al
-- recibir a un cliente o al cobrar. vet queda fuera a propósito: no es
-- su dominio, mismo criterio que excluye a groomer de medical_records.
create policy grooming_records_select on grooming_records for select
  to authenticated
  using (app.is_member_of(tenant_id) and app.role_in(tenant_id) in ('owner', 'receptionist', 'groomer'));

-- Escribir la ficha si sí es tarea operativa de quien atiende: owner, o
-- el groomer ASIGNADO a esa cita en particular (no cualquier groomer del
-- tenant) — mismo criterio que appointments_update en la fase 3.
create policy grooming_records_insert on grooming_records for insert
  to authenticated
  with check (
    app.is_member_of(tenant_id)
    and (
      app.role_in(tenant_id) = 'owner'
      or exists (
        select 1 from appointments a
        where a.id = grooming_records.appointment_id
          and a.employee_user_id = auth.uid()
      )
    )
  );

create policy grooming_records_update on grooming_records for update
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and (
      app.role_in(tenant_id) = 'owner'
      or exists (
        select 1 from appointments a
        where a.id = grooming_records.appointment_id
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
        where a.id = grooming_records.appointment_id
          and a.employee_user_id = auth.uid()
      )
    )
  );

-- Sin política de DELETE — CLAUDE.md §7.3 y §8.5: ni siquiera un borrado
-- suave existe para expediente.
