-- Catálogo `vaccines` y registro `vaccinations` (CLAUDE.md §6.4).
--
-- `vaccines` es un catálogo normal (como `services`, fase 3): sigue la
-- regla general de toda tabla de negocio, con `deleted_at`. `species`
-- va NULLABLE — null significa "aplica a cualquier especie" (p. ej.
-- rabia y bordetella se aplican igual a perros y gatos); un valor
-- concreto restringe la vacuna a esa especie (p. ej. la séxtuple es
-- solo para perros). Mismo criterio que `pets.sex` nullable: "no
-- restringido" es NULL, no un tercer valor del enum.
create table vaccines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  species pet_species,
  -- Nullable a propósito (tarea 4.7 prueba justo este caso): no toda
  -- vacuna tiene un esquema de refuerzo fijo — algunas se aplican una
  -- sola vez, sin "próxima dosis" calculable.
  default_interval_days integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger vaccines_set_updated_at
  before update on vaccines
  for each row execute function app.set_updated_at();

create index vaccines_tenant_id_idx on vaccines (tenant_id);

alter table vaccines enable row level security;
alter table vaccines force row level security;

-- Sin "and deleted_at is null" — misma trampa documentada en CLAUDE.md
-- §7.2 (esta tabla tiene UPDATE para un rol autenticado).
create policy vaccines_select on vaccines for select
  to authenticated
  using (app.is_member_of(tenant_id));

-- Catálogo = configuración del negocio, igual que "services" en fase 3:
-- solo owner lo edita.
create policy vaccines_insert on vaccines for insert
  to authenticated
  with check (app.is_member_of(tenant_id) and app.role_in(tenant_id) = 'owner');

create policy vaccines_update on vaccines for update
  to authenticated
  using (app.is_member_of(tenant_id) and app.role_in(tenant_id) = 'owner')
  with check (app.is_member_of(tenant_id) and app.role_in(tenant_id) = 'owner');

-- =============================================================================
-- vaccinations
-- =============================================================================
-- Es EXPEDIENTE (CLAUDE.md §8.5 la nombra junto con medical_records y
-- grooming_records): sin `deleted_at`, sin política de DELETE, con
-- `prevent_hard_delete()`.
create table vaccinations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  pet_id uuid not null references pets(id),
  vaccine_id uuid not null references vaccines(id),
  applied_at timestamptz not null default now(),
  batch_number text,
  applied_by_user_id uuid references auth.users(id),
  next_due_date date,
  -- Nullable: una vacuna puede registrarse sin estar ligada a una cita
  -- de este sistema (p. ej. capturar el historial previo de un cliente
  -- nuevo, aplicado en otro lugar).
  appointment_id uuid references appointments(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger vaccinations_set_updated_at
  before update on vaccinations
  for each row execute function app.set_updated_at();

create trigger vaccinations_audit
  after insert or update or delete on vaccinations
  for each row execute function app.log_change();

create trigger vaccinations_prevent_hard_delete
  before delete on vaccinations
  for each row execute function app.prevent_hard_delete();

create index vaccinations_tenant_id_idx on vaccinations (tenant_id);
create index vaccinations_tenant_pet_idx on vaccinations (tenant_id, pet_id);

alter table vaccinations enable row level security;
alter table vaccinations force row level security;

-- A diferencia de medical_records, la cartilla de vacunación NO es
-- información restringida a owner/vet — CLAUDE.md §7.4 dice que hasta
-- la vista PÚBLICA (sin login, por link) va a mostrar la cartilla. Aquí,
-- cualquier miembro activo del tenant puede leerla: receptionist la
-- necesita para recordarle al cliente que ya toca refuerzo, groomer para
-- saber si puede bañar a una mascota con las vacunas al día.
create policy vaccinations_select on vaccinations for select
  to authenticated
  using (app.is_member_of(tenant_id));

-- Aplicar una vacuna SÍ es un acto médico — owner o vet, sin importar
-- si está ligada a una cita puntual (a diferencia de medical_records,
-- que exige ser el vet ASIGNADO a esa cita: aquí puede no haber cita).
create policy vaccinations_insert on vaccinations for insert
  to authenticated
  with check (app.is_member_of(tenant_id) and app.role_in(tenant_id) in ('owner', 'vet'));

create policy vaccinations_update on vaccinations for update
  to authenticated
  using (app.is_member_of(tenant_id) and app.role_in(tenant_id) in ('owner', 'vet'))
  with check (app.is_member_of(tenant_id) and app.role_in(tenant_id) in ('owner', 'vet'));

-- Sin política de DELETE — igual que medical_records/grooming_records.
