-- Fase 27 (PLAN.md D30, puntos 1 y 2): catálogo de grupos, especies y razas, y edad estimada.
--
-- =============================================================================
-- Qué cambia y por qué
-- =============================================================================
-- Hoy `pets.species` es el enum `dog | cat | other` y `pets.breed` es texto libre: el
-- veterinario escribe "Xoloitzcuintle" a mano (y se equivoca) y no hay aves ni reptiles.
-- Esta migración agrega tres catálogos POR NEGOCIO (cada negocio edita el suyo):
--
--   species_groups  Perros, Gatos, Aves, Reptiles, Roedores y conejos, Otros
--   species         Perro, Gato, Loro, Iguana…  (cuelga de un grupo)
--   breeds          razas, solo de las especies con `has_breeds`  (cuelga de una especie)
--
-- El grupo es el dato GENÉRICO para estadística (perro, gato, ave, reptil; fase 30).
--
-- Migración ADITIVA (§8.1): el enum `pet_species` y el texto `breed` SE CONSERVAN. Las
-- vacunas por especie, la búsqueda y la vista pública siguen leyéndolos, y las mascotas
-- que ya existen no se tocan (salvo enlazar perros y gatos a su especie del catálogo).
-- `species.legacy_kind` dice a qué valor del enum corresponde cada especie: la
-- interfaz escribe `pets.species` con él al elegir una especie del catálogo.

-- =============================================================================
-- species_groups
-- =============================================================================
create table species_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null check (length(btrim(name)) > 0),
  -- Orden en que se muestran los grupos (el catálogo base va 1 a 6).
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- =============================================================================
-- species
-- =============================================================================
create table species (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  group_id uuid not null,
  name text not null check (length(btrim(name)) > 0),
  -- A qué valor del enum `pet_species` corresponde (dog, cat u other). Las especies que el
  -- negocio agregue nacen como 'other': las vacunas "por especie" solo distinguen perro y
  -- gato (ver D30; ampliar el enum de vacunas queda fuera de esta fase).
  legacy_kind pet_species not null default 'other',
  -- Si la especie lleva razas (perros y gatos en el catálogo base). En aves y reptiles el
  -- nivel es la especie común y no hay razas (D30 punto 1).
  has_breeds boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- =============================================================================
-- breeds
-- =============================================================================
create table breeds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  species_id uuid not null,
  name text not null check (length(btrim(name)) > 0),
  -- Otras formas de escribir o llamar a la raza ("xolo", "teckel", "dachshund"): la
  -- búsqueda las toma en cuenta para que nadie tenga que recordar la ortografía exacta.
  search_aliases text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Llaves únicas compuestas (tenant_id, id): las necesitan las llaves foráneas compuestas de
-- abajo, que garantizan que una especie no cuelgue del grupo de OTRO negocio (mismo
-- patrón que product_categories).
create unique index species_groups_tenant_id_id_key on species_groups (tenant_id, id);
create unique index species_tenant_id_id_key on species (tenant_id, id);
-- (tenant_id, species_id, id): para que la mascota no combine una raza con otra especie.
create unique index breeds_tenant_species_id_key on breeds (tenant_id, species_id, id);

alter table species
  add constraint species_group_fkey
  foreign key (tenant_id, group_id) references species_groups (tenant_id, id);
alter table breeds
  add constraint breeds_species_fkey
  foreign key (tenant_id, species_id) references species (tenant_id, id);

-- Nombres sin repetir DENTRO de un negocio (parciales: una oculta libera su nombre).
create unique index species_groups_tenant_name_key
  on species_groups (tenant_id, lower(btrim(name))) where deleted_at is null;
create unique index species_tenant_name_key
  on species (tenant_id, lower(btrim(name))) where deleted_at is null;
create unique index breeds_tenant_species_name_key
  on breeds (tenant_id, species_id, lower(btrim(name))) where deleted_at is null;

create index species_groups_tenant_id_idx on species_groups (tenant_id);
create index species_tenant_group_idx on species (tenant_id, group_id);
create index breeds_tenant_species_idx on breeds (tenant_id, species_id);

-- Triggers: fecha de modificación, bitácora (§8.6; un cambio aquí cambia lo que ofrece el
-- formulario de todas las mascotas) y bloqueo de escritura en negocios en solo lectura (§6.8).
create trigger species_groups_set_updated_at before update on species_groups
  for each row execute function app.set_updated_at();
create trigger species_set_updated_at before update on species
  for each row execute function app.set_updated_at();
create trigger breeds_set_updated_at before update on breeds
  for each row execute function app.set_updated_at();

create trigger species_groups_audit after insert or update or delete on species_groups
  for each row execute function app.log_change();
create trigger species_audit after insert or update or delete on species
  for each row execute function app.log_change();
create trigger breeds_audit after insert or update or delete on breeds
  for each row execute function app.log_change();

create trigger enforce_tenant_writable before insert or update on species_groups
  for each row execute function app.enforce_tenant_writable();
create trigger enforce_tenant_writable before insert or update on species
  for each row execute function app.enforce_tenant_writable();
create trigger enforce_tenant_writable before insert or update on breeds
  for each row execute function app.enforce_tenant_writable();

-- =============================================================================
-- RLS (§7.3): lectura para todo el negocio, escritura para dueño y veterinario
-- =============================================================================
-- Mismo criterio que el catálogo de vacunas (D29). Sin `deleted_at is null` en SELECT por
-- la trampa de §7.2 (hay UPDATE para un rol normal); el filtro vive en los servicios.
-- Sin política de DELETE: se oculta con `deleted_at`.
alter table species_groups enable row level security;
alter table species_groups force row level security;
alter table species enable row level security;
alter table species force row level security;
alter table breeds enable row level security;
alter table breeds force row level security;

create policy species_groups_select on species_groups for select
  to authenticated using (app.is_member_of(tenant_id));
create policy species_groups_insert on species_groups for insert
  to authenticated
  with check (app.is_member_of(tenant_id) and app.role_in(tenant_id) in ('owner', 'vet'));
create policy species_groups_update on species_groups for update
  to authenticated
  using (app.is_member_of(tenant_id) and app.role_in(tenant_id) in ('owner', 'vet'))
  with check (app.is_member_of(tenant_id) and app.role_in(tenant_id) in ('owner', 'vet'));

create policy species_select on species for select
  to authenticated using (app.is_member_of(tenant_id));
create policy species_insert on species for insert
  to authenticated
  with check (app.is_member_of(tenant_id) and app.role_in(tenant_id) in ('owner', 'vet'));
create policy species_update on species for update
  to authenticated
  using (app.is_member_of(tenant_id) and app.role_in(tenant_id) in ('owner', 'vet'))
  with check (app.is_member_of(tenant_id) and app.role_in(tenant_id) in ('owner', 'vet'));

create policy breeds_select on breeds for select
  to authenticated using (app.is_member_of(tenant_id));
create policy breeds_insert on breeds for insert
  to authenticated
  with check (app.is_member_of(tenant_id) and app.role_in(tenant_id) in ('owner', 'vet'));
create policy breeds_update on breeds for update
  to authenticated
  using (app.is_member_of(tenant_id) and app.role_in(tenant_id) in ('owner', 'vet'))
  with check (app.is_member_of(tenant_id) and app.role_in(tenant_id) in ('owner', 'vet'));

comment on table species_groups is
  'Grandes grupos de especies de un negocio (Perros, Gatos, Aves…). Dato genérico para estadística.';
comment on table species is
  'Especies comunes de un negocio, colgadas de un grupo. legacy_kind las mapea al enum pet_species.';
comment on table breeds is
  'Razas de las especies que las llevan. search_aliases guarda otras formas de escribir o llamar a la raza.';

-- =============================================================================
-- pets: especie y raza de catálogo, y edad estimada
-- =============================================================================
-- Nulos a propósito: las mascotas existentes siguen funcionando con el enum y el texto.
alter table pets add column species_id uuid;
alter table pets add column breed_id uuid;
-- La fecha de nacimiento se calculó a partir de "tiene 3 años": es una propuesta, no un dato
-- del documento del dueño. La interfaz la marca como aproximada.
alter table pets add column birth_date_is_estimated boolean not null default false;

alter table pets
  add constraint pets_species_fkey
  foreign key (tenant_id, species_id) references species (tenant_id, id);
-- La raza debe ser de la especie elegida (la base lo garantiza, no solo la pantalla). Con
-- breed_id nulo la llave no se evalúa (MATCH SIMPLE).
alter table pets
  add constraint pets_breed_fkey
  foreign key (tenant_id, species_id, breed_id) references breeds (tenant_id, species_id, id);
-- MATCH SIMPLE no evalúa la llave si species_id es nulo: este check cierra ese hueco.
alter table pets
  add constraint pets_breed_requires_species check (breed_id is null or species_id is not null);

create index pets_species_id_idx on pets (tenant_id, species_id);

-- =============================================================================
-- Catálogo base de un negocio
-- =============================================================================
-- SECURITY DEFINER: corre desde un trigger al crear el negocio, antes de que exista
-- ninguna membresía, así que no hay `auth.uid()` con quién validar; solo la invocan el
-- trigger de abajo y esta migración (EXECUTE se revoca a todos los roles de la API).
-- Es idempotente: si el negocio ya tiene grupos, no hace nada.
create function app.seed_species_catalog(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_group_id uuid;
  v_species_id uuid;
  g record;
  s record;
  b record;
begin
  if exists (select 1 from species_groups where tenant_id = p_tenant_id) then
    return;
  end if;

  -- Grupos y sus especies. `kind` es el valor de pet_species; `breeds` indica si lleva razas.
  for g in
    select * from (values
      (1, 'Perros'),
      (2, 'Gatos'),
      (3, 'Aves'),
      (4, 'Reptiles'),
      (5, 'Roedores y conejos'),
      (6, 'Otros')
    ) as t(position, name)
  loop
    insert into species_groups (tenant_id, name, sort_order)
    values (p_tenant_id, g.name, g.position)
    returning id into v_group_id;

    for s in
      select * from (values
        ('Perros', 'Perro', 'dog', true),
        ('Gatos', 'Gato', 'cat', true),
        ('Aves', 'Loro', 'other', false),
        ('Aves', 'Cotorra', 'other', false),
        ('Aves', 'Perico', 'other', false),
        ('Aves', 'Periquito australiano', 'other', false),
        ('Aves', 'Ninfa', 'other', false),
        ('Aves', 'Agapornis', 'other', false),
        ('Aves', 'Canario', 'other', false),
        ('Aves', 'Cacatúa', 'other', false),
        ('Aves', 'Paloma', 'other', false),
        ('Aves', 'Gallina', 'other', false),
        ('Reptiles', 'Iguana', 'other', false),
        ('Reptiles', 'Gecko leopardo', 'other', false),
        ('Reptiles', 'Dragón barbudo', 'other', false),
        ('Reptiles', 'Camaleón', 'other', false),
        ('Reptiles', 'Tortuga de agua', 'other', false),
        ('Reptiles', 'Tortuga terrestre', 'other', false),
        ('Reptiles', 'Pitón bola', 'other', false),
        ('Reptiles', 'Serpiente del maíz', 'other', false),
        ('Roedores y conejos', 'Conejo', 'other', false),
        ('Roedores y conejos', 'Cobayo', 'other', false),
        ('Roedores y conejos', 'Hámster', 'other', false),
        ('Roedores y conejos', 'Chinchilla', 'other', false),
        ('Roedores y conejos', 'Jerbo', 'other', false),
        ('Roedores y conejos', 'Rata', 'other', false),
        ('Roedores y conejos', 'Ratón', 'other', false),
        ('Otros', 'Hurón', 'other', false),
        ('Otros', 'Erizo pigmeo', 'other', false),
        ('Otros', 'Pez', 'other', false),
        ('Otros', 'Anfibio', 'other', false)
      ) as t(group_name, name, kind, has_breeds)
      where t.group_name = g.name
    loop
      insert into species (tenant_id, group_id, name, legacy_kind, has_breeds)
      values (p_tenant_id, v_group_id, s.name, s.kind::pet_species, s.has_breeds)
      returning id into v_species_id;

      -- Razas (solo Perro y Gato). Variantes de búsqueda: ortografías comunes y nombres en
      -- otro idioma que cuesta recordar. La búsqueda ya ignora acentos y mayúsculas.
      if s.has_breeds then
        for b in
          select * from (values
            ('Perro', 'Mestizo', array['criollo', 'corriente', 'sin raza']),
            ('Perro', 'Chihuahua', array['chihuahueño', 'chiwawa']),
            ('Perro', 'Poodle', array['caniche', 'pudel']),
            ('Perro', 'Schnauzer', array['esnauzer', 'schnauser']),
            ('Perro', 'Pastor alemán', array['deutscher schäferhund', 'german shepherd']),
            ('Perro', 'Labrador', array['labrador retriever', 'lab']),
            ('Perro', 'Golden retriever', array['golden']),
            ('Perro', 'Bulldog francés', array['frenchie', 'french bulldog']),
            ('Perro', 'Bulldog inglés', array['english bulldog']),
            ('Perro', 'Pug', array['carlino']),
            ('Perro', 'Shih tzu', array['shitzu', 'shih-tzu', 'shi tzu']),
            ('Perro', 'Yorkshire terrier', array['yorkie', 'yorkshire']),
            ('Perro', 'Salchicha', array['dachshund', 'teckel', 'perro salchicha']),
            ('Perro', 'Beagle', array[]::text[]),
            ('Perro', 'Bóxer', array['boxer']),
            ('Perro', 'Rottweiler', array['rotweiler', 'rotwailer', 'rottie']),
            ('Perro', 'Husky siberiano', array['husky', 'siberian husky']),
            ('Perro', 'Pitbull', array['pit bull', 'american pit bull terrier']),
            ('Perro', 'Xoloitzcuintle', array['xolo', 'xoloescuincle', 'perro pelón mexicano']),
            ('Perro', 'Doberman', array['dobermann', 'doberman pinscher']),
            ('Perro', 'Maltés', array['maltese', 'bichón maltés']),
            ('Perro', 'Cocker spaniel', array['cocker']),
            ('Perro', 'Border collie', array['collie']),
            ('Perro', 'Pomerania', array['pomeranian', 'lulú de pomerania']),
            ('Perro', 'Gran danés', array['dogo alemán', 'great dane']),
            ('Perro', 'San Bernardo', array['saint bernard']),
            ('Gato', 'Mestizo', array['doméstico', 'criollo', 'gato de casa']),
            ('Gato', 'Siamés', array['siamese']),
            ('Gato', 'Persa', array['persian']),
            ('Gato', 'Angora', array['angora turco']),
            ('Gato', 'Maine coon', array['maine']),
            ('Gato', 'Bengala', array['bengal']),
            ('Gato', 'Británico de pelo corto', array['british shorthair', 'británico']),
            ('Gato', 'Ragdoll', array[]::text[]),
            ('Gato', 'Sphynx', array['esfinge', 'gato pelón']),
            ('Gato', 'Azul ruso', array['russian blue']),
            ('Gato', 'Birmano', array['birman', 'sagrado de birmania']),
            ('Gato', 'Himalayo', array['himalayan'])
          ) as t(species_name, name, aliases)
          where t.species_name = s.name
        loop
          insert into breeds (tenant_id, species_id, name, search_aliases)
          values (p_tenant_id, v_species_id, b.name, b.aliases);
        end loop;
      end if;
    end loop;
  end loop;
end;
$$;

revoke execute on function app.seed_species_catalog(uuid) from public, anon, authenticated;

-- Cada negocio nuevo trae su catálogo base, sin tocar `platform_create_tenant` (que es de
-- la plataforma): un trigger sobre `tenants` basta y lo cubre cualquier forma de alta.
create function app.seed_species_catalog_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform app.seed_species_catalog(new.id);
  return new;
end;
$$;

revoke execute on function app.seed_species_catalog_trigger() from public, anon, authenticated;

create trigger tenants_seed_species_catalog
  after insert on tenants
  for each row execute function app.seed_species_catalog_trigger();

-- Los negocios que ya existen reciben el catálogo base ahora.
-- Los triggers de bitácora y de escritura se apagan solo durante la siembra: es
-- preparación del catálogo, no un cambio de nadie (mismo criterio que la migración is_demo).
alter table species_groups disable trigger species_groups_audit;
alter table species disable trigger species_audit;
alter table breeds disable trigger breeds_audit;
select app.seed_species_catalog(t.id) from tenants t;
alter table species_groups enable trigger species_groups_audit;
alter table species enable trigger species_audit;
alter table breeds enable trigger breeds_audit;

-- Perros y gatos que ya existen se enlazan a su especie del catálogo. El texto de `breed`
-- no se toca ni se adivina; `other` queda sin especie del catálogo (D30, 27.1).
alter table pets disable trigger pets_audit;
update pets p
set species_id = s.id
from species s
where s.tenant_id = p.tenant_id
  and s.deleted_at is null
  and s.has_breeds
  and s.legacy_kind = p.species
  and p.species in ('dog', 'cat')
  and p.species_id is null;
alter table pets enable trigger pets_audit;

-- =============================================================================
-- Alta de cliente con mascota: especie, raza y edad estimada
-- =============================================================================
-- Se reemplaza create_customer_with_pet (C1.4) agregando tres parámetros con valor por
-- defecto al final. Es un `drop` + `create` y no un `create or replace` porque la lista de
-- parámetros cambia (Postgres crearía una sobrecarga y la llamada con nombres sería
-- ambigua). La lógica anterior queda igual; solo se valida y se guarda lo nuevo.
drop function create_customer_with_pet(uuid, text, text, text, text, text, text, text, text, text, text, boolean, text, pet_species, text, pet_sex, date, boolean, text, text);

create function create_customer_with_pet(
  p_tenant_id uuid,
  -- Cliente
  p_first_name text,
  p_last_name text,
  p_phone text default null,
  p_email text default null,
  p_notes text default null,
  p_rfc text default null,
  p_legal_name text default null,
  p_tax_regime_code text default null,
  p_cfdi_use text default null,
  p_postal_code text default null,
  p_requires_invoice boolean default false,
  -- Mascota
  p_pet_name text default null,
  p_pet_species pet_species default null,
  p_pet_breed text default null,
  p_pet_sex pet_sex default null,
  p_pet_birth_date date default null,
  p_pet_is_sterilized boolean default false,
  p_pet_grooming_notes text default null,
  p_pet_medical_alerts text default null,
  -- Fase 27: catálogo y edad estimada
  p_pet_species_id uuid default null,
  p_pet_breed_id uuid default null,
  p_pet_birth_date_is_estimated boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_customer customers;
  v_pet pets;
begin
  -- Revalidación primero (§7.3.4): membresía y rol, antes de leer o escribir.
  if not app.is_member_of(p_tenant_id) then
    raise exception 'No perteneces a este negocio.' using errcode = 'insufficient_privilege';
  end if;

  if app.role_in(p_tenant_id) not in ('owner', 'receptionist') then
    raise exception 'No tienes permiso para dar de alta clientes.' using errcode = 'insufficient_privilege';
  end if;

  if p_first_name is null or btrim(p_first_name) = '' then
    raise exception 'El nombre del cliente es obligatorio.' using errcode = 'check_violation';
  end if;

  if p_last_name is null or btrim(p_last_name) = '' then
    raise exception 'El apellido del cliente es obligatorio.' using errcode = 'check_violation';
  end if;

  if p_pet_name is null or btrim(p_pet_name) = '' then
    raise exception 'El nombre de la mascota es obligatorio.' using errcode = 'check_violation';
  end if;

  if p_pet_species is null then
    raise exception 'La especie de la mascota es obligatoria.' using errcode = 'check_violation';
  end if;

  -- La especie y la raza del catálogo deben ser de ESTE negocio y no estar ocultas. Las
  -- llaves compuestas de pets ya impiden la mezcla entre negocios; esto da el mensaje.
  if p_pet_species_id is not null and not exists (
    select 1 from species
    where id = p_pet_species_id and tenant_id = p_tenant_id and deleted_at is null
  ) then
    raise exception 'La especie elegida no existe.' using errcode = 'check_violation';
  end if;

  if p_pet_breed_id is not null and not exists (
    select 1 from breeds
    where id = p_pet_breed_id and tenant_id = p_tenant_id
      and species_id = p_pet_species_id and deleted_at is null
  ) then
    raise exception 'La raza elegida no corresponde a la especie.' using errcode = 'check_violation';
  end if;

  insert into customers (
    tenant_id, first_name, last_name, phone, email, notes,
    rfc, legal_name, tax_regime_code, cfdi_use, postal_code, requires_invoice
  )
  values (
    p_tenant_id, btrim(p_first_name), btrim(p_last_name), p_phone, p_email, p_notes,
    p_rfc, p_legal_name, p_tax_regime_code, p_cfdi_use, p_postal_code,
    coalesce(p_requires_invoice, false)
  )
  returning * into v_customer;

  insert into pets (
    tenant_id, customer_id, name, species, breed, sex, birth_date,
    is_sterilized, grooming_notes, medical_alerts,
    species_id, breed_id, birth_date_is_estimated
  )
  values (
    p_tenant_id, v_customer.id, btrim(p_pet_name), p_pet_species, p_pet_breed, p_pet_sex,
    p_pet_birth_date, coalesce(p_pet_is_sterilized, false), p_pet_grooming_notes,
    p_pet_medical_alerts,
    p_pet_species_id, p_pet_breed_id,
    -- Sin fecha no hay nada que marcar como estimado.
    p_pet_birth_date is not null and coalesce(p_pet_birth_date_is_estimated, false)
  )
  returning * into v_pet;

  return jsonb_build_object('customer', to_jsonb(v_customer), 'pet', to_jsonb(v_pet));
end;
$$;

comment on function create_customer_with_pet(uuid, text, text, text, text, text, text, text, text, text, text, boolean, text, pet_species, text, pet_sex, date, boolean, text, text, uuid, uuid, boolean) is
  'Da de alta un cliente y su mascota (obligatoria) en una sola transacción. Revalida membresía y rol dueño/recepción. Acepta especie y raza del catálogo (fase 27). Devuelve {customer, pet}.';

revoke execute on function create_customer_with_pet(uuid, text, text, text, text, text, text, text, text, text, text, boolean, text, pet_species, text, pet_sex, date, boolean, text, text, uuid, uuid, boolean) from public, anon;
grant execute on function create_customer_with_pet(uuid, text, text, text, text, text, text, text, text, text, text, boolean, text, pet_species, text, pet_sex, date, boolean, text, text, uuid, uuid, boolean) to authenticated;
