-- Fase 32 (PLAN.md D30, punto 9): catálogo de cirugías y su cobro.
--
-- =============================================================================
-- Qué es
-- =============================================================================
-- El veterinario tiene una lista de precios de cirugías en Excel: cada cirugía suma
-- consumibles, medicamentos y honorarios. El catálogo la guarda como PAQUETES con renglones
-- (`surgery_packages` y `surgery_package_items`). Al atender una cita de veterinaria se
-- APLICA un paquete: sus renglones se copian a la cita (`appointment_surgery_lines`) con el
-- precio de ese día y se pueden ajustar renglón por renglón, o armar una desde cero.
--
-- Cómo cada renglón llega al ticket sin tablas paralelas:
--   * con producto (consumible o medicamento): se registra como insumo de la consulta
--     (`appointment_products`, con su descuento de existencia y su cobro) y se corrige su
--     precio al del paquete. El cobro ya los copia (checkout_billable_supplies).
--   * sin producto (honorarios, o un consumible que no se lleva en inventario): se cobran
--     directo desde `appointment_surgery_lines` (checkout_appointment, abajo).
--
-- Migración ADITIVA (§8.1): tablas y columnas nuevas; se reemplaza checkout_appointment()
-- agregando un bloque, sin cambiar lo que hacía.

create type surgery_item_kind as enum ('consumable', 'medication', 'fee');

-- Claves del SAT de la partida cuando no viene de un servicio ni de un producto (honorarios):
-- la factura las usa en lugar de buscarlas en el catálogo.
alter table sale_items add column sat_product_code_snapshot text
  check (sat_product_code_snapshot is null or sat_product_code_snapshot ~ '^[0-9]{8}$');

-- =============================================================================
-- surgery_packages
-- =============================================================================
create table surgery_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null check (length(btrim(name)) > 0),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index surgery_packages_tenant_id_id_key on surgery_packages (tenant_id, id);
create unique index surgery_packages_tenant_name_key
  on surgery_packages (tenant_id, lower(btrim(name))) where deleted_at is null;
create index surgery_packages_tenant_id_idx on surgery_packages (tenant_id);

create table surgery_package_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  package_id uuid not null,
  position smallint not null default 0,
  kind surgery_item_kind not null,
  -- Producto del inventario (consumible o medicamento). Nulo = no se lleva en inventario.
  product_id uuid references products(id),
  description text not null check (length(btrim(description)) > 0),
  quantity integer not null default 1 check (quantity > 0),
  -- Con IVA incluido, en centavos (§8.2).
  unit_price_cents integer not null check (unit_price_cents >= 0),
  tax_rate_bp integer not null default 1600 check (tax_rate_bp >= 0),
  -- Para un producto fraccionado: se usa por envase o por unidad suelta (fase 29C).
  unit text not null default 'package' check (unit in ('package', 'unit')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint surgery_package_items_package_fkey
    foreign key (tenant_id, package_id) references surgery_packages (tenant_id, id),
  -- Un honorario no es un producto.
  constraint surgery_package_items_fee_without_product check (kind <> 'fee' or product_id is null)
);

create index surgery_package_items_tenant_package_idx on surgery_package_items (tenant_id, package_id);

-- =============================================================================
-- appointment_surgery_lines
-- =============================================================================
create table appointment_surgery_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  appointment_id uuid not null references appointments(id),
  -- De qué paquete salió (nulo = armada desde cero). Solo informativo.
  package_id uuid references surgery_packages(id),
  kind surgery_item_kind not null,
  product_id uuid references products(id),
  -- El insumo de la consulta que lleva su existencia y su cobro (solo con producto).
  appointment_product_id uuid references appointment_products(id),
  description text not null check (length(btrim(description)) > 0),
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  tax_rate_bp integer not null check (tax_rate_bp >= 0),
  is_billable boolean not null default true,
  sold_unit text not null default 'package' check (sold_unit in ('package', 'unit')),
  sat_product_code text not null default '70122000' check (sat_product_code ~ '^[0-9]{8}$'),
  sat_unit_code text not null default 'E48' check (sat_unit_code ~ '^[A-Z0-9]{2,3}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint surgery_lines_fee_without_product check (kind <> 'fee' or product_id is null)
);

create index appointment_surgery_lines_tenant_appt_idx
  on appointment_surgery_lines (tenant_id, appointment_id);

-- Triggers de las tres tablas: fecha de modificación, bitácora y solo-lectura de negocio.
create trigger surgery_packages_set_updated_at before update on surgery_packages
  for each row execute function app.set_updated_at();
create trigger surgery_package_items_set_updated_at before update on surgery_package_items
  for each row execute function app.set_updated_at();
create trigger appointment_surgery_lines_set_updated_at before update on appointment_surgery_lines
  for each row execute function app.set_updated_at();

create trigger surgery_packages_audit after insert or update or delete on surgery_packages
  for each row execute function app.log_change();
create trigger surgery_package_items_audit after insert or update or delete on surgery_package_items
  for each row execute function app.log_change();
create trigger appointment_surgery_lines_audit after insert or update or delete on appointment_surgery_lines
  for each row execute function app.log_change();

create trigger enforce_tenant_writable before insert or update on surgery_packages
  for each row execute function app.enforce_tenant_writable();
create trigger enforce_tenant_writable before insert or update on surgery_package_items
  for each row execute function app.enforce_tenant_writable();
create trigger enforce_tenant_writable before insert or update on appointment_surgery_lines
  for each row execute function app.enforce_tenant_writable();

-- =============================================================================
-- RLS (§7.3)
-- =============================================================================
-- El catálogo de cirugías es configuración: lo lee todo el negocio y se escribe SOLO con
-- save_surgery_package() (dueño y veterinario). Los renglones aplicados a una cita los leen
-- dueño, recepción (para cobrar) y veterinario, y se escriben solo con las RPC de abajo.
alter table surgery_packages enable row level security;
alter table surgery_packages force row level security;
alter table surgery_package_items enable row level security;
alter table surgery_package_items force row level security;
alter table appointment_surgery_lines enable row level security;
alter table appointment_surgery_lines force row level security;

create policy surgery_packages_select on surgery_packages for select
  to authenticated using (app.is_member_of(tenant_id) and app.role_in(tenant_id) in ('owner', 'receptionist', 'vet'));
create policy surgery_package_items_select on surgery_package_items for select
  to authenticated using (app.is_member_of(tenant_id) and app.role_in(tenant_id) in ('owner', 'receptionist', 'vet'));
create policy appointment_surgery_lines_select on appointment_surgery_lines for select
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and app.role_in(tenant_id) in ('owner', 'receptionist', 'vet')
  );

comment on table surgery_packages is
  'Paquetes de cirugía del negocio (nombre y renglones con precio). Se escribe con save_surgery_package().';
comment on table appointment_surgery_lines is
  'Renglones de cirugía aplicados a una cita, con el precio de ese día. Los que tienen producto también son un insumo de la consulta.';

-- =============================================================================
-- save_surgery_package(): crea o corrige un paquete con todos sus renglones
-- =============================================================================
-- p_items: [{ kind, product_id?, description, quantity, unit_price_cents, tax_rate_bp?, unit? }].
-- Reemplaza los renglones anteriores (se ocultan). Dueño y veterinario.
create function save_surgery_package(
  p_tenant_id uuid,
  p_package_id uuid,
  p_name text,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_package_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_item jsonb;
  v_index integer := 0;
  v_kind surgery_item_kind;
  v_product_id uuid;
  v_description text;
begin
  if not app.is_member_of(p_tenant_id) or app.role_in(p_tenant_id) not in ('owner', 'vet') then
    raise exception 'No tienes permiso para administrar las cirugías.' using errcode = 'insufficient_privilege';
  end if;
  if v_name = '' then
    raise exception 'Escribe el nombre de la cirugía.' using errcode = 'check_violation';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agrega al menos un renglón a la cirugía.' using errcode = 'check_violation';
  end if;

  -- Mensaje claro en lugar del error del índice único.
  if exists (
    select 1 from surgery_packages
     where tenant_id = p_tenant_id and deleted_at is null
       and lower(btrim(name)) = lower(v_name)
       and id is distinct from p_package_id
  ) then
    raise exception 'Ya hay una cirugía con ese nombre.' using errcode = 'check_violation';
  end if;

  if p_package_id is null then
    insert into surgery_packages (tenant_id, name, notes)
    values (p_tenant_id, v_name, nullif(btrim(coalesce(p_notes, '')), ''))
    returning id into v_package_id;
  else
    if not exists (
      select 1 from surgery_packages where id = p_package_id and tenant_id = p_tenant_id and deleted_at is null
    ) then
      raise exception 'La cirugía no existe.' using errcode = 'no_data_found';
    end if;
    v_package_id := p_package_id;
    update surgery_packages
       set name = v_name, notes = nullif(btrim(coalesce(p_notes, '')), '')
     where id = v_package_id;
    update surgery_package_items set deleted_at = now()
     where package_id = v_package_id and deleted_at is null;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_index := v_index + 1;
    v_kind := (v_item->>'kind')::surgery_item_kind;
    v_description := btrim(coalesce(v_item->>'description', ''));
    v_product_id := nullif(v_item->>'product_id', '')::uuid;

    if v_description = '' then
      raise exception 'El renglón % no tiene descripción.', v_index using errcode = 'check_violation';
    end if;
    if v_kind = 'fee' and v_product_id is not null then
      raise exception 'Un honorario no lleva producto.' using errcode = 'check_violation';
    end if;
    if v_product_id is not null and not exists (
      select 1 from products where id = v_product_id and tenant_id = p_tenant_id and deleted_at is null
    ) then
      raise exception 'El producto del renglón % no existe.', v_index using errcode = 'check_violation';
    end if;

    insert into surgery_package_items (
      tenant_id, package_id, position, kind, product_id, description,
      quantity, unit_price_cents, tax_rate_bp, unit
    )
    values (
      p_tenant_id, v_package_id, v_index, v_kind, v_product_id, v_description,
      coalesce((v_item->>'quantity')::integer, 1),
      (v_item->>'unit_price_cents')::integer,
      coalesce((v_item->>'tax_rate_bp')::integer, 1600),
      coalesce(nullif(v_item->>'unit', ''), 'package')
    );
  end loop;

  return v_package_id;
end;
$$;

comment on function save_surgery_package(uuid, uuid, text, text, jsonb) is
  'Crea o corrige un paquete de cirugía con todos sus renglones. Solo dueño y veterinario.';

-- Activar o desactivar un paquete (no se borra: las citas ya atendidas conservan sus renglones).
create function set_surgery_package_active(p_package_id uuid, p_is_active boolean)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from surgery_packages where id = p_package_id and deleted_at is null;
  if not found then
    raise exception 'La cirugía no existe.' using errcode = 'no_data_found';
  end if;
  if not app.is_member_of(v_tenant) or app.role_in(v_tenant) not in ('owner', 'vet') then
    raise exception 'No tienes permiso para administrar las cirugías.' using errcode = 'insufficient_privilege';
  end if;
  update surgery_packages set is_active = coalesce(p_is_active, true) where id = p_package_id;
end;
$$;

-- =============================================================================
-- apply_surgery_lines(): aplica renglones (de un paquete, ajustados o armados a mano) a una cita
-- =============================================================================
-- p_lines: [{ kind, product_id?, description, quantity, unit_price_cents, tax_rate_bp?,
--             is_billable?, unit? }]. Mismas reglas que registrar un insumo (dueño o veterinario,
-- cita veterinaria no cobrada ni cancelada). Un renglón con producto baja la existencia.
create function apply_surgery_lines(
  p_appointment_id uuid,
  p_package_id uuid,
  p_lines jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_appointment appointments;
  v_line jsonb;
  v_index integer := 0;
  v_kind surgery_item_kind;
  v_product products;
  v_product_id uuid;
  v_description text;
  v_quantity integer;
  v_price integer;
  v_tax integer;
  v_billable boolean;
  v_unit text;
  v_ap_id uuid;
begin
  -- Revalida membresía, sucursal, rol y que la cita admita cambios (mismo helper que los insumos).
  v_appointment := app.appointment_for_consumption(p_appointment_id);

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Agrega al menos un renglón.' using errcode = 'check_violation';
  end if;
  if p_package_id is not null and not exists (
    select 1 from surgery_packages where id = p_package_id and tenant_id = v_appointment.tenant_id
  ) then
    raise exception 'La cirugía no existe.' using errcode = 'no_data_found';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_index := v_index + 1;
    v_kind := (v_line->>'kind')::surgery_item_kind;
    v_description := btrim(coalesce(v_line->>'description', ''));
    v_quantity := (v_line->>'quantity')::integer;
    v_price := (v_line->>'unit_price_cents')::integer;
    v_tax := coalesce((v_line->>'tax_rate_bp')::integer, 1600);
    v_billable := coalesce((v_line->>'is_billable')::boolean, true);
    v_unit := coalesce(nullif(v_line->>'unit', ''), 'package');
    v_product_id := nullif(v_line->>'product_id', '')::uuid;
    v_ap_id := null;

    if v_description = '' then
      raise exception 'El renglón % no tiene descripción.', v_index using errcode = 'check_violation';
    end if;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'La cantidad del renglón % debe ser mayor a cero.', v_index using errcode = 'check_violation';
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'El precio del renglón % no es válido.', v_index using errcode = 'check_violation';
    end if;
    if v_kind = 'fee' and v_product_id is not null then
      raise exception 'Un honorario no lleva producto.' using errcode = 'check_violation';
    end if;

    if v_product_id is not null then
      select * into v_product from products
       where id = v_product_id and tenant_id = v_appointment.tenant_id and deleted_at is null and is_active;
      if not found then
        raise exception 'El producto del renglón % no existe o no está disponible.', v_index
          using errcode = 'no_data_found';
      end if;

      -- Baja la existencia y registra el insumo (con su validación de existencia).
      v_ap_id := add_appointment_product(p_appointment_id, v_product_id, v_quantity, v_billable, v_unit);
      -- El precio y el IVA son los del paquete, no los del catálogo del día.
      update appointment_products
         set unit_price_cents = v_price, tax_rate_bp = v_tax
       where id = v_ap_id;
    end if;

    insert into appointment_surgery_lines (
      tenant_id, appointment_id, package_id, kind, product_id, appointment_product_id,
      description, quantity, unit_price_cents, tax_rate_bp, is_billable, sold_unit, created_by
    )
    values (
      v_appointment.tenant_id, p_appointment_id, p_package_id, v_kind, v_product_id, v_ap_id,
      v_description, v_quantity, v_price, v_tax, v_billable, v_unit, auth.uid()
    );
  end loop;

  return v_index;
end;
$$;

comment on function apply_surgery_lines(uuid, uuid, jsonb) is
  'Aplica renglones de cirugía a una cita veterinaria: los de producto bajan existencia y los demás se cobran directo. Dueño o veterinario.';

-- Quita un renglón aplicado (y devuelve la existencia si traía producto).
create function remove_surgery_line(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_line appointment_surgery_lines;
begin
  select * into v_line from appointment_surgery_lines where id = p_line_id and deleted_at is null;
  if not found then
    raise exception 'El renglón no existe.' using errcode = 'no_data_found';
  end if;

  perform app.appointment_for_consumption(v_line.appointment_id);

  update appointment_surgery_lines set deleted_at = now() where id = p_line_id;
  if v_line.appointment_product_id is not null then
    perform remove_appointment_product(v_line.appointment_product_id);
  end if;
end;
$$;

revoke execute on function save_surgery_package(uuid, uuid, text, text, jsonb) from public, anon;
revoke execute on function set_surgery_package_active(uuid, boolean) from public, anon;
revoke execute on function apply_surgery_lines(uuid, uuid, jsonb) from public, anon;
revoke execute on function remove_surgery_line(uuid) from public, anon;
grant execute on function save_surgery_package(uuid, uuid, text, text, jsonb) to authenticated;
grant execute on function set_surgery_package_active(uuid, boolean) to authenticated;
grant execute on function apply_surgery_lines(uuid, uuid, jsonb) to authenticated;
grant execute on function remove_surgery_line(uuid) to authenticated;

-- =============================================================================
-- checkout_appointment(): también cobra los renglones de cirugía sin producto
-- =============================================================================
-- Misma función de la migración checkout_billable_supplies, con un bloque nuevo antes de los
-- productos extra. Nada de lo que hacía cambia.
create or replace function checkout_appointment(
  p_appointment_id uuid,
  p_payments jsonb,
  p_discount_cents integer default 0,
  -- [{"product_id": "...", "quantity": 2}]: productos que se suman al ticket.
  p_products jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_appointment appointments;
  v_role member_role;
  v_item_count integer;
  v_sale_id uuid;
  v_folio integer;
  v_discount_cents integer := coalesce(p_discount_cents, 0);
begin
  select * into v_appointment from appointments where id = p_appointment_id and deleted_at is null;
  if not found then
    raise exception 'La cita no existe.' using errcode = 'no_data_found';
  end if;

  if not app.is_member_of(v_appointment.tenant_id) then
    raise exception 'No perteneces a este negocio.' using errcode = 'insufficient_privilege';
  end if;

  if not app.can_access_branch(v_appointment.branch_id) then
    raise exception 'No tienes acceso a esta sucursal.' using errcode = 'insufficient_privilege';
  end if;

  v_role := app.role_in(v_appointment.tenant_id);
  if v_role not in ('owner', 'receptionist') then
    raise exception 'No tienes permiso para cobrar.' using errcode = 'insufficient_privilege';
  end if;

  if v_appointment.status <> 'completed' then
    raise exception 'La cita debe estar atendida antes de cobrarse.' using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from sale_items si
    join sales s on s.id = si.sale_id
    where si.appointment_id = p_appointment_id
      and si.deleted_at is null
      and s.status <> 'cancelled'
  ) then
    raise exception 'Esta cita ya fue cobrada.' using errcode = 'check_violation';
  end if;

  select count(*) into v_item_count
  from appointment_services
  where appointment_id = p_appointment_id and deleted_at is null;

  if v_item_count = 0 then
    raise exception 'Esta cita no tiene servicios que cobrar.' using errcode = 'check_violation';
  end if;

  if p_payments is null or jsonb_array_length(p_payments) = 0 then
    raise exception 'Debes registrar al menos un pago.' using errcode = 'check_violation';
  end if;

  if v_discount_cents < 0 then
    raise exception 'El descuento no puede ser negativo.' using errcode = 'check_violation';
  end if;

  select coalesce(max(folio), 0) + 1 into v_folio
  from sales
  where tenant_id = v_appointment.tenant_id and branch_id = v_appointment.branch_id;

  insert into sales (
    tenant_id, branch_id, customer_id, folio, status,
    subtotal_cents, tax_cents, discount_cents, total_cents, paid_at, closed_by
  )
  values (
    v_appointment.tenant_id, v_appointment.branch_id, v_appointment.customer_id, v_folio, 'paid',
    0, 0, v_discount_cents, 0, now(), auth.uid()
  )
  returning id into v_sale_id;

  insert into sale_items (
    tenant_id, sale_id, item_type, service_id, appointment_id,
    description, quantity, unit_price_cents, tax_rate_bp, tax_cents, line_total_cents
  )
  select
    v_appointment.tenant_id,
    v_sale_id,
    'service',
    aps.service_id,
    p_appointment_id,
    aps.name_snapshot,
    aps.quantity,
    aps.unit_price_cents,
    s.tax_rate_bp,
    (aps.unit_price_cents * aps.quantity)
      - round(((aps.unit_price_cents * aps.quantity)::numeric * 10000) / (10000 + s.tax_rate_bp))::integer,
    aps.unit_price_cents * aps.quantity
  from appointment_services aps
  join services s on s.id = aps.service_id
  where aps.appointment_id = p_appointment_id and aps.deleted_at is null;

  -- Insumos cobrables de la consulta (tarea 11.14). Se copian los snapshots de
  -- appointment_products (nombre, precio e IVA del día en que se registraron). NO
  -- se crea movimiento de stock: la pieza ya salió al registrarla (consumption).
  -- Los de uso interno (is_billable = false) no entran al ticket.
  insert into sale_items (
    tenant_id, sale_id, item_type, product_id, appointment_id, appointment_product_id,
    description, quantity, unit_price_cents, tax_rate_bp, tax_cents, line_total_cents
  )
  select
    ap.tenant_id,
    v_sale_id,
    'product',
    ap.product_id,
    p_appointment_id,
    ap.id,
    ap.name_snapshot,
    ap.quantity,
    ap.unit_price_cents,
    ap.tax_rate_bp,
    (ap.unit_price_cents * ap.quantity)
      - round(((ap.unit_price_cents * ap.quantity)::numeric * 10000) / (10000 + ap.tax_rate_bp))::integer,
    ap.unit_price_cents * ap.quantity
  from appointment_products ap
  where ap.appointment_id = p_appointment_id and ap.is_billable and ap.deleted_at is null;

  -- Renglones de cirugía SIN producto (honorarios y consumibles que no se llevan en inventario;
  -- fase 32). Los que sí tienen producto ya viajan arriba como insumos de la consulta. Se
  -- copian con el precio y el IVA del día en que se aplicaron, y con sus claves del SAT.
  insert into sale_items (
    tenant_id, sale_id, item_type, appointment_id,
    description, quantity, unit_price_cents, tax_rate_bp, tax_cents, line_total_cents,
    sat_product_code_snapshot, sat_unit_code_snapshot
  )
  select
    sl.tenant_id,
    v_sale_id,
    'service',
    p_appointment_id,
    sl.description,
    sl.quantity,
    sl.unit_price_cents,
    sl.tax_rate_bp,
    (sl.unit_price_cents * sl.quantity)
      - round(((sl.unit_price_cents * sl.quantity)::numeric * 10000) / (10000 + sl.tax_rate_bp))::integer,
    sl.unit_price_cents * sl.quantity,
    sl.sat_product_code,
    sl.sat_unit_code
  from appointment_surgery_lines sl
  where sl.appointment_id = p_appointment_id
    and sl.product_id is null
    and sl.is_billable
    and sl.deleted_at is null;

  perform app.add_product_items(v_sale_id, v_appointment.tenant_id, v_appointment.branch_id, p_products);
  perform app.finalize_sale(v_sale_id, v_appointment.tenant_id, v_discount_cents, p_payments);

  return v_sale_id;
end;
$$;
