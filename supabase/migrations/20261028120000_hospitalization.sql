-- Fase 33 (PLAN.md D30, punto 10): hospitalización con bitácora.
--
-- =============================================================================
-- Alcance de esta migración
-- =============================================================================
-- Estancia Y control (decisión del usuario): ingreso, alta, espacio, días, bitácora con
-- biometrías, medicamentos administrados (con inventario y cobro) y el cobro de la estancia.
--
-- NO incluye la lectura del dueño de la mascota ni la notificación: dependen de la cuenta del
-- cliente (16B, sin construir). Por ahora solo el personal lee. Cuando exista la 16B bastará
-- una función de servidor que filtre estas mismas tablas con las reglas de visibilidad de la
-- fase 31 (app.customer_can_view_pet*).
--
-- Quién escribe (D30): veterinario, dueño y recepción. El groomer no ve nada de esto.
-- Todo se escribe con RPC `SECURITY DEFINER` que revalidan rol y sucursal (§7.3.4).
--
-- La bitácora es EXPEDIENTE clínico (§8.5): sin borrado, sin UPDATE; se corrige con una nota
-- nueva, y todo cambio queda en `audit_log`.
--
-- Migración ADITIVA (§8.1): tablas nuevas y una columna nula en stock_movements.

-- =============================================================================
-- Configuración del negocio
-- =============================================================================
-- Cómo cuenta el negocio los días ('natural': cada día calendario tocado cuenta, y cambia a
-- medianoche; '24h': bloques de 24 horas desde el ingreso) y la tarifa por defecto, que cada
-- espacio puede sobrescribir (tarifa única o por tipo de espacio, D30). Una fila por negocio.
create table hospital_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references tenants(id),
  day_rule text not null default 'natural' check (day_rule in ('natural', '24h')),
  default_daily_rate_cents integer check (default_daily_rate_cents is null or default_daily_rate_cents >= 0),
  default_stay_rate_cents integer check (default_stay_rate_cents is null or default_stay_rate_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- =============================================================================
-- hospital_spaces: jaulas o espacios por sucursal (sin tope de mascotas por espacio)
-- =============================================================================
create table hospital_spaces (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  branch_id uuid not null references branches(id),
  name text not null check (length(btrim(name)) > 0),
  -- Texto libre ("Jaula chica", "Aislamiento"): agrupa espacios y sus tarifas.
  space_type text,
  -- Tarifas propias del espacio; nulas = se usa la del negocio (hospital_settings).
  daily_rate_cents integer check (daily_rate_cents is null or daily_rate_cents >= 0),
  stay_rate_cents integer check (stay_rate_cents is null or stay_rate_cents >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index hospital_spaces_branch_name_key
  on hospital_spaces (branch_id, lower(btrim(name))) where deleted_at is null;
create index hospital_spaces_tenant_branch_idx on hospital_spaces (tenant_id, branch_id);

-- =============================================================================
-- hospital_stays: una estancia de una mascota
-- =============================================================================
create table hospital_stays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  branch_id uuid not null references branches(id),
  pet_id uuid not null references pets(id),
  -- El dueño al momento del ingreso (copia): la estancia se cobra a quien la dejó aunque la
  -- mascota se transfiera después.
  customer_id uuid references customers(id),
  space_id uuid not null references hospital_spaces(id),
  admitted_at timestamptz not null default now(),
  discharged_at timestamptz,
  admitted_by uuid not null references auth.users(id),
  discharged_by uuid references auth.users(id),
  reason text,
  -- Cómo se cobra: por día (tarifa × días) o por estancia (monto único), con COPIA de la
  -- tarifa y de la regla de días del momento del ingreso, para que cambiarlas después no
  -- altere una estancia ya abierta (mismo criterio que los `*_snapshot`, §6.3).
  rate_mode text not null check (rate_mode in ('per_day', 'per_stay')),
  rate_cents integer not null check (rate_cents >= 0),
  day_rule text not null check (day_rule in ('natural', '24h')),
  tax_rate_bp integer not null default 1600 check (tax_rate_bp >= 0),
  -- La venta que la cobró (nula = sin cobrar).
  billed_sale_id uuid references sales(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hospital_stays_discharge_check check (discharged_at is null or discharged_at >= admitted_at)
);

create index hospital_stays_tenant_branch_idx on hospital_stays (tenant_id, branch_id, admitted_at);
create index hospital_stays_tenant_pet_idx on hospital_stays (tenant_id, pet_id);
-- Una mascota solo puede tener UNA estancia abierta.
create unique index hospital_stays_open_pet_key on hospital_stays (pet_id) where discharged_at is null;

-- =============================================================================
-- hospital_notes: la bitácora
-- =============================================================================
create table hospital_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  stay_id uuid not null references hospital_stays(id),
  -- La hora a la que se hizo lo anotado (puede ser anterior a cuando se capturó).
  noted_at timestamptz not null default now(),
  content text,
  -- Biometrías: todas opcionales y enteras (§8.2): décimas de grado, gramos, latidos.
  temperature_deci_c integer check (temperature_deci_c is null or temperature_deci_c between 250 and 480),
  weight_grams integer check (weight_grams is null or weight_grams > 0),
  heart_rate_bpm integer check (heart_rate_bpm is null or heart_rate_bpm between 10 and 400),
  -- Opciones fijas (D30). Texto con `check` para poder ampliarlas con una migración simple.
  mucous_color text check (mucous_color is null or mucous_color in ('pink', 'pale', 'yellow', 'cyanotic', 'red')),
  mood text check (mood is null or mood in ('alert', 'calm', 'depressed', 'agitated', 'sleeping')),
  elimination text check (
    elimination is null or elimination in ('both', 'urine_only', 'stool_only', 'none', 'diarrhea')
  ),
  author_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  -- Una nota sin nada no dice nada.
  constraint hospital_notes_not_empty check (
    nullif(btrim(coalesce(content, '')), '') is not null
    or temperature_deci_c is not null or weight_grams is not null or heart_rate_bpm is not null
    or mucous_color is not null or mood is not null or elimination is not null
  )
);

create index hospital_notes_tenant_stay_idx on hospital_notes (tenant_id, stay_id, noted_at);

-- =============================================================================
-- hospital_medications: medicamentos administrados (con inventario y cobro)
-- =============================================================================
create table hospital_medications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  stay_id uuid not null references hospital_stays(id),
  product_id uuid not null references products(id),
  -- Copias del día en que se administró (igual que appointment_products).
  name_snapshot text not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  tax_rate_bp integer not null check (tax_rate_bp >= 0),
  quantity integer not null check (quantity > 0),
  sold_unit text not null default 'package' check (sold_unit in ('package', 'unit')),
  units_per_package_snapshot integer not null default 1 check (units_per_package_snapshot >= 1),
  is_billable boolean not null default true,
  administered_at timestamptz not null default now(),
  administered_by uuid not null references auth.users(id),
  -- Venta que la cobró (nula = sin cobrar o de uso interno).
  billed_sale_id uuid references sales(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index hospital_medications_tenant_stay_idx on hospital_medications (tenant_id, stay_id);

-- El movimiento de existencia de un medicamento administrado apunta a él (para devolverlo
-- si se quita). Columna nula: el resto de los movimientos no cambia.
alter table stock_movements add column hospital_medication_id uuid references hospital_medications(id);

-- =============================================================================
-- Triggers: fecha de modificación, bitácora (§8.6), solo-lectura de negocio (§6.8)
-- =============================================================================
create trigger hospital_settings_set_updated_at before update on hospital_settings
  for each row execute function app.set_updated_at();
create trigger hospital_spaces_set_updated_at before update on hospital_spaces
  for each row execute function app.set_updated_at();
create trigger hospital_stays_set_updated_at before update on hospital_stays
  for each row execute function app.set_updated_at();
create trigger hospital_medications_set_updated_at before update on hospital_medications
  for each row execute function app.set_updated_at();

create trigger hospital_settings_audit after insert or update or delete on hospital_settings
  for each row execute function app.log_change();
create trigger hospital_spaces_audit after insert or update or delete on hospital_spaces
  for each row execute function app.log_change();
create trigger hospital_stays_audit after insert or update or delete on hospital_stays
  for each row execute function app.log_change();
create trigger hospital_notes_audit after insert or update or delete on hospital_notes
  for each row execute function app.log_change();
create trigger hospital_medications_audit after insert or update or delete on hospital_medications
  for each row execute function app.log_change();

create trigger enforce_tenant_writable before insert or update on hospital_settings
  for each row execute function app.enforce_tenant_writable();
create trigger enforce_tenant_writable before insert or update on hospital_spaces
  for each row execute function app.enforce_tenant_writable();
create trigger enforce_tenant_writable before insert or update on hospital_stays
  for each row execute function app.enforce_tenant_writable();
create trigger enforce_tenant_writable before insert or update on hospital_notes
  for each row execute function app.enforce_tenant_writable();
create trigger enforce_tenant_writable before insert or update on hospital_medications
  for each row execute function app.enforce_tenant_writable();

-- Expediente (§8.5): ni borrado físico (ni con service_role) ni UPDATE de una nota.
create trigger hospital_stays_prevent_hard_delete before delete on hospital_stays
  for each row execute function app.prevent_hard_delete();
create trigger hospital_notes_prevent_hard_delete before delete on hospital_notes
  for each row execute function app.prevent_hard_delete();
create trigger hospital_medications_prevent_hard_delete before delete on hospital_medications
  for each row execute function app.prevent_hard_delete();

create function app.reject_hospital_note_update()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'Una nota de la bitácora no se modifica: se corrige con una nota nueva (CLAUDE.md §8.5).'
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger hospital_notes_no_update before update on hospital_notes
  for each row execute function app.reject_hospital_note_update();

-- =============================================================================
-- RLS (§7.3)
-- =============================================================================
-- Lectura: dueño, recepción y veterinario de la sucursal. El groomer no ve nada de esto.
-- Escritura de estancias, notas y medicamentos: SOLO por RPC (no hay política de INSERT/UPDATE).
-- Espacios y configuración: los administra el dueño (política de escritura de dueño).
alter table hospital_settings enable row level security;
alter table hospital_settings force row level security;
alter table hospital_spaces enable row level security;
alter table hospital_spaces force row level security;
alter table hospital_stays enable row level security;
alter table hospital_stays force row level security;
alter table hospital_notes enable row level security;
alter table hospital_notes force row level security;
alter table hospital_medications enable row level security;
alter table hospital_medications force row level security;

create policy hospital_settings_select on hospital_settings for select
  to authenticated
  using (app.is_member_of(tenant_id) and app.role_in(tenant_id) in ('owner', 'receptionist', 'vet'));
create policy hospital_settings_insert on hospital_settings for insert
  to authenticated
  with check (app.is_member_of(tenant_id) and app.role_in(tenant_id) = 'owner');
create policy hospital_settings_update on hospital_settings for update
  to authenticated
  using (app.is_member_of(tenant_id) and app.role_in(tenant_id) = 'owner')
  with check (app.is_member_of(tenant_id) and app.role_in(tenant_id) = 'owner');

-- Sin `deleted_at is null` en SELECT (trampa de §7.2: hay UPDATE para el dueño).
create policy hospital_spaces_select on hospital_spaces for select
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and app.role_in(tenant_id) in ('owner', 'receptionist', 'vet')
    and app.can_access_branch(branch_id)
  );
create policy hospital_spaces_insert on hospital_spaces for insert
  to authenticated
  with check (
    app.is_member_of(tenant_id) and app.role_in(tenant_id) = 'owner'
    and exists (select 1 from branches b where b.id = branch_id and b.tenant_id = hospital_spaces.tenant_id)
  );
create policy hospital_spaces_update on hospital_spaces for update
  to authenticated
  using (app.is_member_of(tenant_id) and app.role_in(tenant_id) = 'owner')
  with check (app.is_member_of(tenant_id) and app.role_in(tenant_id) = 'owner');

create policy hospital_stays_select on hospital_stays for select
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and app.role_in(tenant_id) in ('owner', 'receptionist', 'vet')
    and app.can_access_branch(branch_id)
  );

create policy hospital_notes_select on hospital_notes for select
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and app.role_in(tenant_id) in ('owner', 'receptionist', 'vet')
    and exists (
      select 1 from hospital_stays s
       where s.id = hospital_notes.stay_id and app.can_access_branch(s.branch_id)
    )
  );

create policy hospital_medications_select on hospital_medications for select
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and app.role_in(tenant_id) in ('owner', 'receptionist', 'vet')
    and exists (
      select 1 from hospital_stays s
       where s.id = hospital_medications.stay_id and app.can_access_branch(s.branch_id)
    )
  );

comment on table hospital_stays is
  'Estancia de una mascota hospitalizada (ingreso, alta, espacio y tarifa con copia). Se escribe con las RPC de hospitalización.';
comment on table hospital_notes is
  'Bitácora de la estancia: expediente clínico, sin UPDATE ni borrado; se corrige con una nota nueva.';

-- =============================================================================
-- Días de una estancia (misma regla que lib/hospitalization.ts#stayDays)
-- =============================================================================
-- 'natural': cada día calendario (en la zona de la sucursal) tocado cuenta; ingresar el lunes
-- y darse de alta el lunes es 1 día, el martes son 2. '24h': bloques de 24 horas desde el
-- ingreso, redondeando hacia arriba. Mínimo 1 día en ambas.
create function app.hospital_stay_days(
  p_admitted_at timestamptz,
  p_end_at timestamptz,
  p_rule text,
  p_timezone text
)
returns integer
language sql
immutable
as $$
  select case
    when p_rule = '24h' then
      greatest(1, ceil(extract(epoch from (p_end_at - p_admitted_at)) / 86400.0)::integer)
    else
      greatest(1, ((p_end_at at time zone p_timezone)::date - (p_admitted_at at time zone p_timezone)::date) + 1)
  end;
$$;

-- Cuánto cuesta la estancia hasta `p_end_at`: (días, importe con IVA incluido).
create function app.hospital_stay_charge(p_stay hospital_stays, p_end_at timestamptz)
returns table (days integer, amount_cents integer)
language sql
stable
as $$
  select
    case when p_stay.rate_mode = 'per_day'
      then app.hospital_stay_days(
        p_stay.admitted_at, p_end_at, p_stay.day_rule,
        (select b.timezone from branches b where b.id = p_stay.branch_id)
      )
      else 1 end,
    case when p_stay.rate_mode = 'per_day'
      then p_stay.rate_cents * app.hospital_stay_days(
        p_stay.admitted_at, p_end_at, p_stay.day_rule,
        (select b.timezone from branches b where b.id = p_stay.branch_id)
      )
      else p_stay.rate_cents end;
$$;

-- =============================================================================
-- Permisos comunes de las RPC de la estancia
-- =============================================================================
-- Devuelve la estancia validando negocio, sucursal y rol. `p_write_roles` lista quién puede.
create function app.hospital_stay_for_staff(p_stay_id uuid, p_roles text[])
returns hospital_stays
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_stay hospital_stays;
begin
  select * into v_stay from hospital_stays where id = p_stay_id;
  if not found then
    raise exception 'La estancia no existe.' using errcode = 'no_data_found';
  end if;
  if not app.is_member_of(v_stay.tenant_id) then
    raise exception 'No perteneces a este negocio.' using errcode = 'insufficient_privilege';
  end if;
  if not app.can_access_branch(v_stay.branch_id) then
    raise exception 'No tienes acceso a esta sucursal.' using errcode = 'insufficient_privilege';
  end if;
  if not (app.role_in(v_stay.tenant_id)::text = any (p_roles)) then
    raise exception 'No tienes permiso para esta acción de hospitalización.'
      using errcode = 'insufficient_privilege';
  end if;
  return v_stay;
end;
$$;

revoke execute on function app.hospital_stay_for_staff(uuid, text[]) from public, anon, authenticated;

-- =============================================================================
-- admit_pet(): ingresar una mascota
-- =============================================================================
create function admit_pet(
  p_pet_id uuid,
  p_space_id uuid,
  p_rate_mode text,
  p_rate_cents integer,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pet pets;
  v_space hospital_spaces;
  v_rule text;
  v_stay_id uuid;
begin
  select * into v_pet from pets where id = p_pet_id and deleted_at is null;
  if not found then
    raise exception 'La mascota no existe.' using errcode = 'no_data_found';
  end if;

  select * into v_space from hospital_spaces
   where id = p_space_id and tenant_id = v_pet.tenant_id and deleted_at is null and is_active;
  if not found then
    raise exception 'El espacio no existe o no está disponible.' using errcode = 'no_data_found';
  end if;

  -- Revalidación (§7.3.4): negocio, sucursal DEL ESPACIO y rol.
  if not app.is_member_of(v_pet.tenant_id) then
    raise exception 'No perteneces a este negocio.' using errcode = 'insufficient_privilege';
  end if;
  if not app.can_access_branch(v_space.branch_id) then
    raise exception 'No tienes acceso a esta sucursal.' using errcode = 'insufficient_privilege';
  end if;
  if app.role_in(v_pet.tenant_id) not in ('owner', 'receptionist', 'vet') then
    raise exception 'No tienes permiso para ingresar mascotas a hospitalización.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_rate_mode not in ('per_day', 'per_stay') then
    raise exception 'Elige si la tarifa es por día o por estancia.' using errcode = 'check_violation';
  end if;
  if p_rate_cents is null or p_rate_cents < 0 then
    raise exception 'La tarifa no puede ser negativa.' using errcode = 'check_violation';
  end if;

  if exists (select 1 from hospital_stays where pet_id = p_pet_id and discharged_at is null) then
    raise exception '% ya está hospitalizada.', v_pet.name using errcode = 'check_violation';
  end if;

  select coalesce(
    (select day_rule from hospital_settings
      where tenant_id = v_pet.tenant_id and deleted_at is null),
    'natural'
  ) into v_rule;

  insert into hospital_stays (
    tenant_id, branch_id, pet_id, customer_id, space_id, admitted_by, reason,
    rate_mode, rate_cents, day_rule
  )
  values (
    v_pet.tenant_id, v_space.branch_id, v_pet.id, v_pet.customer_id, v_space.id, auth.uid(),
    nullif(btrim(coalesce(p_reason, '')), ''), p_rate_mode, p_rate_cents, v_rule
  )
  returning id into v_stay_id;

  return v_stay_id;
end;
$$;

-- =============================================================================
-- add_hospital_note(): una nota de la bitácora
-- =============================================================================
create function add_hospital_note(
  p_stay_id uuid,
  p_content text default null,
  p_noted_at timestamptz default null,
  p_temperature_deci_c integer default null,
  p_weight_grams integer default null,
  p_heart_rate_bpm integer default null,
  p_mucous_color text default null,
  p_mood text default null,
  p_elimination text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_stay hospital_stays;
  v_id uuid;
begin
  v_stay := app.hospital_stay_for_staff(p_stay_id, array['owner', 'receptionist', 'vet']);
  if v_stay.discharged_at is not null then
    raise exception 'La mascota ya fue dada de alta: no admite más notas.' using errcode = 'check_violation';
  end if;

  insert into hospital_notes (
    tenant_id, stay_id, noted_at, content, temperature_deci_c, weight_grams, heart_rate_bpm,
    mucous_color, mood, elimination, author_user_id
  )
  values (
    v_stay.tenant_id, v_stay.id, coalesce(p_noted_at, now()),
    nullif(btrim(coalesce(p_content, '')), ''),
    p_temperature_deci_c, p_weight_grams, p_heart_rate_bpm,
    p_mucous_color, p_mood, p_elimination, auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- =============================================================================
-- administer_hospital_medication() / remove_hospital_medication()
-- =============================================================================
-- Baja la existencia de la sucursal de la estancia en la misma transacción (por envase o por
-- unidad suelta, fase 29C) y deja la línea lista para cobrarse con la estancia.
create function administer_hospital_medication(
  p_stay_id uuid,
  p_product_id uuid,
  p_quantity integer,
  p_is_billable boolean default true,
  p_unit text default 'package'
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_stay hospital_stays;
  v_product products;
  v_unit text := coalesce(nullif(p_unit, ''), 'package');
  v_units integer;
  v_stock integer;
  v_id uuid;
begin
  v_stay := app.hospital_stay_for_staff(p_stay_id, array['owner', 'receptionist', 'vet']);
  if v_stay.discharged_at is not null then
    raise exception 'La mascota ya fue dada de alta: no admite más medicamentos.'
      using errcode = 'check_violation';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La cantidad debe ser mayor a cero.' using errcode = 'check_violation';
  end if;
  if v_unit not in ('package', 'unit') then
    raise exception 'La unidad no es válida.' using errcode = 'check_violation';
  end if;

  select * into v_product from products
   where id = p_product_id and tenant_id = v_stay.tenant_id and deleted_at is null and is_active;
  if not found then
    raise exception 'El producto no existe o no está disponible.' using errcode = 'no_data_found';
  end if;
  if v_unit = 'unit' and v_product.units_per_package = 1 then
    raise exception 'El producto "%" no se usa por unidad.', v_product.name using errcode = 'check_violation';
  end if;

  v_units := p_quantity * case when v_unit = 'unit' then 1 else v_product.units_per_package end;

  select coalesce(sum(quantity), 0)::integer into v_stock
    from stock_movements
   where tenant_id = v_stay.tenant_id and branch_id = v_stay.branch_id and product_id = v_product.id;
  if v_stock <= 0 then
    raise exception 'El producto "%" no tiene existencia.', v_product.name using errcode = 'check_violation';
  end if;

  insert into hospital_medications (
    tenant_id, stay_id, product_id, name_snapshot, unit_price_cents, tax_rate_bp, quantity,
    sold_unit, units_per_package_snapshot, is_billable, administered_by
  )
  values (
    v_stay.tenant_id, v_stay.id, v_product.id,
    v_product.name || case when v_unit = 'unit' then ' (' || v_product.unit_name || ')' else '' end,
    case when v_unit = 'unit' then app.product_unit_price_cents(v_product) else v_product.price_cents end,
    v_product.tax_rate_bp, p_quantity, v_unit, v_product.units_per_package,
    coalesce(p_is_billable, true), auth.uid()
  )
  returning id into v_id;

  -- Si no alcanza, el trigger de stock_movements lanza y se deshace TODO.
  insert into stock_movements (
    tenant_id, branch_id, product_id, movement_type, quantity, hospital_medication_id, created_by
  )
  values (v_stay.tenant_id, v_stay.branch_id, v_product.id, 'consumption', -v_units, v_id, auth.uid());

  return v_id;
end;
$$;

create function remove_hospital_medication(p_medication_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_med hospital_medications;
  v_stay hospital_stays;
  v_consumed integer;
begin
  select * into v_med from hospital_medications where id = p_medication_id and deleted_at is null;
  if not found then
    raise exception 'El medicamento no existe.' using errcode = 'no_data_found';
  end if;
  v_stay := app.hospital_stay_for_staff(v_med.stay_id, array['owner', 'receptionist', 'vet']);

  if v_med.billed_sale_id is not null then
    raise exception 'Este medicamento ya se cobró.' using errcode = 'check_violation';
  end if;

  update hospital_medications set deleted_at = now() where id = p_medication_id;

  -- Regresa lo que esa línea sacó (neto de sus movimientos), exacto aunque tuviera varios.
  select -coalesce(sum(quantity), 0)::integer into v_consumed
    from stock_movements where hospital_medication_id = p_medication_id;
  if v_consumed > 0 then
    insert into stock_movements (
      tenant_id, branch_id, product_id, movement_type, quantity, hospital_medication_id, created_by
    )
    values (
      v_stay.tenant_id, v_stay.branch_id, v_med.product_id, 'consumption_reversal',
      v_consumed, p_medication_id, auth.uid()
    );
  end if;
end;
$$;

-- =============================================================================
-- discharge_pet(): dar de alta
-- =============================================================================
create function discharge_pet(p_stay_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_stay hospital_stays;
begin
  v_stay := app.hospital_stay_for_staff(p_stay_id, array['owner', 'receptionist', 'vet']);
  if v_stay.discharged_at is not null then
    raise exception 'La mascota ya fue dada de alta.' using errcode = 'check_violation';
  end if;
  update hospital_stays
     set discharged_at = now(), discharged_by = auth.uid()
   where id = p_stay_id;
end;
$$;

-- =============================================================================
-- bill_hospital_stay(): cobrar la estancia con sus medicamentos
-- =============================================================================
-- Solo dueño y recepción (quien cobra). Exige el alta (los días se cuentan hasta ella). Crea
-- una venta ligada al dueño del ingreso con: la estancia (por día o por estancia) y los
-- medicamentos cobrables sin cobrar. La existencia ya salió al administrarlos.
create function bill_hospital_stay(
  p_stay_id uuid,
  p_payments jsonb,
  p_discount_cents integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_stay hospital_stays;
  v_days integer;
  v_amount integer;
  v_unit_price integer;
  v_quantity integer;
  v_sale_id uuid;
  v_folio integer;
  v_discount integer := coalesce(p_discount_cents, 0);
  v_pet_name text;
  v_description text;
begin
  v_stay := app.hospital_stay_for_staff(p_stay_id, array['owner', 'receptionist']);
  if v_stay.discharged_at is null then
    raise exception 'Da de alta a la mascota antes de cobrar la estancia.' using errcode = 'check_violation';
  end if;
  if v_stay.billed_sale_id is not null then
    raise exception 'Esta estancia ya fue cobrada.' using errcode = 'check_violation';
  end if;
  if v_discount < 0 then
    raise exception 'El descuento no puede ser negativo.' using errcode = 'check_violation';
  end if;

  select days, amount_cents into v_days, v_amount
    from app.hospital_stay_charge(v_stay, v_stay.discharged_at);

  select name into v_pet_name from pets where id = v_stay.pet_id;
  if v_stay.rate_mode = 'per_day' then
    v_quantity := v_days;
    v_unit_price := v_stay.rate_cents;
    v_description := format('Hospitalización de %s (%s %s)', v_pet_name, v_days,
                            case when v_days = 1 then 'día' else 'días' end);
  else
    v_quantity := 1;
    v_unit_price := v_stay.rate_cents;
    v_description := format('Hospitalización de %s (estancia)', v_pet_name);
  end if;

  select coalesce(max(folio), 0) + 1 into v_folio
    from sales where tenant_id = v_stay.tenant_id and branch_id = v_stay.branch_id;

  insert into sales (
    tenant_id, branch_id, customer_id, folio, status,
    subtotal_cents, tax_cents, discount_cents, total_cents, paid_at, closed_by
  )
  values (
    v_stay.tenant_id, v_stay.branch_id, v_stay.customer_id, v_folio, 'paid',
    0, 0, v_discount, 0, now(), auth.uid()
  )
  returning id into v_sale_id;

  -- La estancia: una partida de servicio sin servicio de catálogo (lleva sus claves del SAT).
  insert into sale_items (
    tenant_id, sale_id, item_type, description, quantity, unit_price_cents, tax_rate_bp,
    tax_cents, line_total_cents, sat_product_code_snapshot, sat_unit_code_snapshot
  )
  values (
    v_stay.tenant_id, v_sale_id, 'service', v_description, v_quantity, v_unit_price,
    v_stay.tax_rate_bp,
    v_amount - round((v_amount::numeric * 10000) / (10000 + v_stay.tax_rate_bp))::integer,
    v_amount, '70122000', 'E48'
  );

  -- Los medicamentos cobrables sin cobrar: ya salieron del inventario, solo pasan al ticket.
  insert into sale_items (
    tenant_id, sale_id, item_type, product_id, description, quantity, unit_price_cents,
    tax_rate_bp, tax_cents, line_total_cents, sold_unit, units_per_package_snapshot,
    sat_unit_code_snapshot
  )
  select
    m.tenant_id, v_sale_id, 'product', m.product_id, m.name_snapshot, m.quantity, m.unit_price_cents,
    m.tax_rate_bp,
    (m.unit_price_cents * m.quantity)
      - round(((m.unit_price_cents * m.quantity)::numeric * 10000) / (10000 + m.tax_rate_bp))::integer,
    m.unit_price_cents * m.quantity,
    m.sold_unit, m.units_per_package_snapshot,
    case when m.sold_unit = 'unit'
      then (select p.unit_sat_code from products p where p.id = m.product_id) end
  from hospital_medications m
  where m.stay_id = v_stay.id and m.is_billable and m.deleted_at is null and m.billed_sale_id is null;

  perform app.finalize_sale(v_sale_id, v_stay.tenant_id, v_discount, coalesce(p_payments, '[]'::jsonb));

  update hospital_medications set billed_sale_id = v_sale_id
   where stay_id = v_stay.id and is_billable and deleted_at is null and billed_sale_id is null;
  update hospital_stays set billed_sale_id = v_sale_id where id = v_stay.id;

  return v_sale_id;
end;
$$;

comment on function bill_hospital_stay(uuid, jsonb, integer) is
  'Cobra una estancia dada de alta con sus medicamentos cobrables. Solo dueño y recepción.';

-- Permisos de ejecución: nada para anon ni PUBLIC.
revoke execute on function admit_pet(uuid, uuid, text, integer, text) from public, anon;
revoke execute on function add_hospital_note(uuid, text, timestamptz, integer, integer, integer, text, text, text) from public, anon;
revoke execute on function administer_hospital_medication(uuid, uuid, integer, boolean, text) from public, anon;
revoke execute on function remove_hospital_medication(uuid) from public, anon;
revoke execute on function discharge_pet(uuid) from public, anon;
revoke execute on function bill_hospital_stay(uuid, jsonb, integer) from public, anon;
grant execute on function admit_pet(uuid, uuid, text, integer, text) to authenticated;
grant execute on function add_hospital_note(uuid, text, timestamptz, integer, integer, integer, text, text, text) to authenticated;
grant execute on function administer_hospital_medication(uuid, uuid, integer, boolean, text) to authenticated;
grant execute on function remove_hospital_medication(uuid) to authenticated;
grant execute on function discharge_pet(uuid) to authenticated;
grant execute on function bill_hospital_stay(uuid, jsonb, integer) to authenticated;
