-- Tabla pets y pet_weights (CLAUDE.md §6.2).
create type pet_species as enum ('dog', 'cat', 'other');
create type pet_sex as enum ('male', 'female');

create table pets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  customer_id uuid not null references customers(id),
  name text not null,
  species pet_species not null,
  breed text,
  -- Nullable a propósito: no siempre se sabe el sexo al momento del alta
  -- (un rescate, por ejemplo). "No especificado" es simplemente NULL, no
  -- un tercer valor del enum — evita tener que tratar "unknown" como un
  -- caso especial en cada UPDATE o comparación.
  sex pet_sex,
  birth_date date,
  is_sterilized boolean not null default false,
  -- La ruta del archivo en el bucket de Storage "pet-photos" (tarea
  -- 2.14). Nullable: no toda mascota tiene foto todavía.
  photo_path text,
  grooming_notes text,
  medical_alerts text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger pets_set_updated_at
  before update on pets
  for each row execute function app.set_updated_at();

create trigger pets_audit
  after insert or update or delete on pets
  for each row execute function app.log_change();

create index pets_tenant_id_idx on pets (tenant_id);

-- Para "listByCustomer" (tarea 2.12): la ficha de un cliente (tarea 2.18)
-- necesita "todas las mascotas de ESTE cliente" — consulta que se hace
-- constantemente, así que le corresponde su propio índice en vez de
-- confiar en un escaneo del índice de tenant_id nada más.
create index pets_tenant_customer_idx on pets (tenant_id, customer_id);

alter table pets enable row level security;
alter table pets force row level security;

-- Mismo criterio que customers: cualquier miembro activo del tenant ve
-- las mascotas (un groomer necesita ver la ficha de estética de
-- cualquier mascota que le toque atender, no solo las que él mismo dio
-- de alta); solo owner y receptionist dan de alta o editan.
--
-- Sin "and deleted_at is null" por la misma razón que customers_select
-- (ver el comentario largo en customers.sql): con esa condición, el
-- borrado suave de pets_update fallaría con "violates row-level security
-- policy" porque Postgres exige que la fila resultante de un UPDATE siga
-- siendo seleccionable. El filtro vive en services/pets.ts.
create policy pets_select on pets for select
  to authenticated
  using (app.is_member_of(tenant_id));

create policy pets_insert on pets for insert
  to authenticated
  with check (
    app.is_member_of(tenant_id)
    and app.role_in(tenant_id) in ('owner', 'receptionist')
  );

create policy pets_update on pets for update
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
-- pet_weights
-- =============================================================================
create table pet_weights (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  pet_id uuid not null references pets(id),
  -- Sin "references appointments(id)" todavía: la tabla appointments no
  -- existe hasta la fase 3. Queda como uuid suelto por ahora; cuando
  -- appointments exista, una migración de esa fase agrega la restricción
  -- con "alter table pet_weights add constraint ... foreign key ...".
  -- Postgres no permite crear un FK contra una tabla que no existe, así
  -- que no hay otra forma de dejarlo listo desde ya.
  appointment_id uuid,
  weight_grams integer not null check (weight_grams > 0),
  measured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger pet_weights_set_updated_at
  before update on pet_weights
  for each row execute function app.set_updated_at();

create trigger pet_weights_audit
  after insert or update or delete on pet_weights
  for each row execute function app.log_change();

create index pet_weights_tenant_id_idx on pet_weights (tenant_id);

-- Para "el historial de peso de ESTA mascota, del más reciente al más
-- viejo" — la consulta que arma la gráfica/lista de peso en la ficha.
create index pet_weights_tenant_pet_measured_idx
  on pet_weights (tenant_id, pet_id, measured_at desc);

alter table pet_weights enable row level security;
alter table pet_weights force row level security;

-- Sin "and deleted_at is null" — mismo motivo que pets_select arriba.
create policy pet_weights_select on pet_weights for select
  to authenticated
  using (app.is_member_of(tenant_id));

-- A diferencia de pets/customers, CUALQUIER rol activo puede registrar un
-- peso (no solo owner/receptionist): pesar a la mascota es parte de
-- atenderla, ya sea en una cita de estética (groomer) o de veterinaria
-- (vet), no una tarea exclusiva de recepción.
create policy pet_weights_insert on pet_weights for insert
  to authenticated
  with check (app.is_member_of(tenant_id));

-- Corregir un peso mal capturado sí queda reservado a owner/receptionist
-- (incluye el borrado suave, que es un UPDATE de deleted_at).
create policy pet_weights_update on pet_weights for update
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and app.role_in(tenant_id) in ('owner', 'receptionist')
  )
  with check (
    app.is_member_of(tenant_id)
    and app.role_in(tenant_id) in ('owner', 'receptionist')
  );
