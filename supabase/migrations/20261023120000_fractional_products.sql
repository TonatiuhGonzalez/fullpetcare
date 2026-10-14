-- Fase 29C (PLAN.md D30, punto 5): medicamentos fraccionados — vender un blíster recortado
-- sin descuadrar el inventario.
--
-- =============================================================================
-- Modelo (decisión 29.1)
-- =============================================================================
-- La existencia de un producto se guarda siempre en su UNIDAD BASE (la tableta, el mililitro),
-- como entero (§8.2). Un envase (la caja, el frasco) equivale a `units_per_package` unidades.
-- Un producto que no se fracciona tiene `units_per_package = 1`: su unidad base ES el envase,
-- y todo funciona exactamente como antes (las existencias ya guardadas no cambian).
--
--   existencia = suma de stock_movements.quantity                 (en unidades base)
--   envase abierto = existencia mod units_per_package            (se DERIVA, no se guarda)
--
-- Por qué derivarlo: si la existencia está en unidades base, lo que sobra después de contar
-- envases completos ES el envase abierto y lo que le queda. Una tabla "envases abiertos" sería
-- un segundo dato que puede descuadrarse del primero.
--
-- Al vender (o consumir en una consulta) se elige "envase" (por defecto) o "unidad". El precio
-- de la unidad se CALCULA (precio del envase / unidades, redondeado al centavo) y se puede
-- modificar en el producto (`unit_price_cents`) y en cada venta.
--
-- Migración ADITIVA (§8.1): columnas con valor por defecto, y se reemplazan cuatro funciones
-- (add_product_items, add_appointment_product, report_top_items) sin cambiar lo que hacían para
-- un producto con `units_per_package = 1`.

-- =============================================================================
-- 1. Presentación del producto
-- =============================================================================
alter table products add column units_per_package integer not null default 1
  check (units_per_package between 1 and 10000);
-- Cómo se llaman, para mostrarlo ("caja de 20 tabletas"). Nulos si el producto no se fracciona.
alter table products add column package_name text
  check (package_name is null or length(btrim(package_name)) > 0);
alter table products add column unit_name text
  check (unit_name is null or length(btrim(unit_name)) > 0);
-- Precio de la unidad suelta, con IVA incluido. Nulo = se calcula del precio del envase.
alter table products add column unit_price_cents integer
  check (unit_price_cents is null or unit_price_cents >= 0);
-- Clave de unidad del SAT de la unidad suelta (p. ej. H87 pieza, MLT mililitro). Nula = la del envase.
alter table products add column unit_sat_code text
  check (unit_sat_code is null or unit_sat_code ~ '^[A-Z0-9]{2,3}$');

-- Si se fracciona, la unidad tiene que tener nombre (si no, el ticket diría "Amoxicilina ()").
alter table products add constraint products_fractional_needs_unit_name
  check (units_per_package = 1 or unit_name is not null);

comment on column products.units_per_package is
  'Unidades base por envase (1 = no se fracciona). La existencia (stock_movements) se guarda en unidades base.';

-- =============================================================================
-- 2. Qué unidad se vendió, en las partidas y en los insumos de consulta
-- =============================================================================
-- `sold_unit`: 'package' (el envase completo) o 'unit' (una unidad suelta). `quantity` queda
-- en ESA unidad; el movimiento de existencia siempre va en unidades base.
alter table sale_items add column sold_unit text not null default 'package'
  check (sold_unit in ('package', 'unit'));
alter table sale_items add column units_per_package_snapshot integer not null default 1
  check (units_per_package_snapshot >= 1);
-- Clave de unidad del SAT de la partida cuando es una unidad suelta (la factura la usa en
-- lugar de la del producto). Nula = la del producto.
alter table sale_items add column sat_unit_code_snapshot text
  check (sat_unit_code_snapshot is null or sat_unit_code_snapshot ~ '^[A-Z0-9]{2,3}$');

alter table appointment_products add column sold_unit text not null default 'package'
  check (sold_unit in ('package', 'unit'));
alter table appointment_products add column units_per_package_snapshot integer not null default 1
  check (units_per_package_snapshot >= 1);

-- Un insumo cobrable pasa al ticket con su unidad: se copia al insertar la partida, sin tener
-- que reescribir checkout_appointment().
create function app.sale_item_copy_supply_unit()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_line appointment_products;
begin
  select * into v_line from appointment_products where id = new.appointment_product_id;
  if found then
    new.sold_unit := v_line.sold_unit;
    new.units_per_package_snapshot := v_line.units_per_package_snapshot;
    if v_line.sold_unit = 'unit' then
      new.sat_unit_code_snapshot := (select unit_sat_code from products where id = v_line.product_id);
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function app.sale_item_copy_supply_unit() from public, anon, authenticated;

create trigger sale_items_copy_supply_unit
  before insert on sale_items
  for each row
  when (new.appointment_product_id is not null)
  execute function app.sale_item_copy_supply_unit();

-- =============================================================================
-- 3. Precio de la unidad suelta (misma regla que lib/fractionalPricing.ts)
-- =============================================================================
create function app.product_unit_price_cents(p_product products)
returns integer
language sql
immutable
as $$
  select coalesce(
    p_product.unit_price_cents,
    round(p_product.price_cents::numeric / p_product.units_per_package)::integer
  );
$$;

-- =============================================================================
-- 4. Cambiar la presentación de un producto (y reescalar su existencia)
-- =============================================================================
-- Si el producto ya tenía existencia contada en la presentación anterior, hay que expresarla
-- en las nuevas unidades base: de 3 cajas (factor 1) a cajas de 20 tabletas son 60 tabletas.
-- La bitácora de inventario es inmutable (§6.5), así que se hace con un movimiento de ajuste
-- por sucursal y todo en una transacción.
--
-- Se rechaza si el reescalado no da un entero (pasar de 20 a 3 tabletas por caja con 5
-- tabletas sueltas daría 0.75 de otra unidad): primero hay que ajustar el inventario.
create function set_product_presentation(
  p_product_id uuid,
  p_units_per_package integer,
  p_package_name text default null,
  p_unit_name text default null,
  p_unit_price_cents integer default null,
  p_unit_sat_code text default null
)
returns products
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_product products;
  v_branch record;
  v_scaled numeric;
  v_new_stock integer;
  v_new_min integer;
begin
  select * into v_product from products where id = p_product_id and deleted_at is null;
  if not found then
    raise exception 'El producto no existe.' using errcode = 'no_data_found';
  end if;

  -- Revalidación primero (§7.3.4): permiso de edición del inventario.
  if not app.is_member_of(v_product.tenant_id)
     or not app.has_permission(v_product.tenant_id, 'inventory', 'edit') then
    raise exception 'No tienes permiso para editar el inventario.' using errcode = 'insufficient_privilege';
  end if;

  if p_units_per_package is null or p_units_per_package < 1 or p_units_per_package > 10000 then
    raise exception 'Las unidades por envase deben estar entre 1 y 10,000.' using errcode = 'check_violation';
  end if;
  if p_units_per_package > 1 and nullif(btrim(coalesce(p_unit_name, '')), '') is null then
    raise exception 'Indica cómo se llama la unidad suelta (tableta, ml...).' using errcode = 'check_violation';
  end if;
  if p_unit_price_cents is not null and p_unit_price_cents < 0 then
    raise exception 'El precio de la unidad no puede ser negativo.' using errcode = 'check_violation';
  end if;

  -- Reescalado de la existencia, por sucursal (solo si cambia el factor).
  if p_units_per_package <> v_product.units_per_package then
    for v_branch in
      select branch_id, sum(quantity)::integer as stock
        from stock_movements
       where tenant_id = v_product.tenant_id and product_id = v_product.id
       group by branch_id
      having sum(quantity) <> 0
    loop
      v_scaled := v_branch.stock::numeric * p_units_per_package / v_product.units_per_package;
      if v_scaled <> trunc(v_scaled) then
        raise exception
          'No se puede cambiar la presentación: hay % unidades en una sucursal y no caben exactas en envases de %. Ajusta el inventario primero.',
          v_branch.stock, p_units_per_package
          using errcode = 'check_violation';
      end if;
      v_new_stock := v_scaled::integer;
      if v_new_stock <> v_branch.stock then
        insert into stock_movements (
          tenant_id, branch_id, product_id, movement_type, quantity, reason, created_by
        )
        values (
          v_product.tenant_id, v_branch.branch_id, v_product.id, 'adjustment',
          v_new_stock - v_branch.stock,
          format('Cambio de presentación: de %s a %s unidades por envase',
                 v_product.units_per_package, p_units_per_package),
          auth.uid()
        );
      end if;
    end loop;
    -- El aviso de "stock bajo" va en las mismas unidades: se redondea hacia arriba.
    v_new_min := ceil(v_product.min_stock::numeric * p_units_per_package / v_product.units_per_package)::integer;
  else
    v_new_min := v_product.min_stock;
  end if;

  update products
     set units_per_package = p_units_per_package,
         package_name = case when p_units_per_package > 1 then nullif(btrim(coalesce(p_package_name, '')), '') end,
         unit_name = case when p_units_per_package > 1 then nullif(btrim(p_unit_name), '') end,
         unit_price_cents = case when p_units_per_package > 1 then p_unit_price_cents end,
         unit_sat_code = case when p_units_per_package > 1 then nullif(btrim(coalesce(p_unit_sat_code, '')), '') end,
         min_stock = v_new_min
   where id = v_product.id
   returning * into v_product;

  return v_product;
end;
$$;

comment on function set_product_presentation(uuid, integer, text, text, integer, text) is
  'Cambia la presentación fraccionada de un producto y reescala su existencia (movimiento de ajuste por sucursal). Requiere inventory:edit.';

revoke execute on function set_product_presentation(uuid, integer, text, text, integer, text) from public, anon;
grant execute on function set_product_presentation(uuid, integer, text, text, integer, text) to authenticated;

-- =============================================================================
-- 5. Vender por unidad o por envase (cobro de cita y venta de mostrador)
-- =============================================================================
-- Cada elemento de p_products: { product_id, quantity, unit?: 'package'|'unit',
-- unit_price_cents?: precio por la unidad vendida, para corregirlo en esa venta }.
create or replace function app.add_product_items(
  p_sale_id uuid,
  p_tenant_id uuid,
  p_branch_id uuid,
  p_products jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_elem jsonb;
  v_product products;
  v_quantity integer;
  v_unit text;
  v_factor integer;
  v_units integer;
  v_stock integer;
  v_price integer;
  v_override integer;
  v_line_total integer;
  v_description text;
begin
  for v_elem in select * from jsonb_array_elements(coalesce(p_products, '[]'::jsonb)) loop
    v_quantity := (v_elem->>'quantity')::integer;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'La cantidad de cada producto debe ser mayor a cero.' using errcode = 'check_violation';
    end if;

    v_unit := coalesce(nullif(v_elem->>'unit', ''), 'package');
    if v_unit not in ('package', 'unit') then
      raise exception 'La unidad de venta no es válida.' using errcode = 'check_violation';
    end if;

    v_override := nullif(v_elem->>'unit_price_cents', '')::integer;
    if v_override is not null and v_override < 0 then
      raise exception 'El precio no puede ser negativo.' using errcode = 'check_violation';
    end if;

    -- Del mismo negocio, activo y no borrado. Esta función salta RLS, así que el filtro por
    -- tenant es lo que impide vender el producto de otro negocio.
    select * into v_product
      from products
     where id = (v_elem->>'product_id')::uuid
       and tenant_id = p_tenant_id
       and deleted_at is null
       and is_active;
    if not found then
      raise exception 'El producto no existe o no está disponible.' using errcode = 'no_data_found';
    end if;

    if v_unit = 'unit' and v_product.units_per_package = 1 then
      raise exception 'El producto "%" no se vende por unidad.', v_product.name using errcode = 'check_violation';
    end if;

    -- La existencia está en unidades base: un envase son `units_per_package` de ellas.
    v_factor := case when v_unit = 'unit' then 1 else v_product.units_per_package end;
    v_units := v_quantity * v_factor;

    select coalesce(sum(quantity), 0)::integer into v_stock
      from stock_movements
     where tenant_id = p_tenant_id and branch_id = p_branch_id and product_id = v_product.id;
    if v_stock <= 0 then
      raise exception 'El producto "%" no tiene existencia.', v_product.name using errcode = 'check_violation';
    end if;
    -- Si no alcanza para lo pedido, el trigger de stock_movements lo rechaza con su mensaje
    -- ("No hay existencia suficiente: hay X y se intentan sacar Y"), ya en unidades base.

    v_price := coalesce(
      v_override,
      case when v_unit = 'unit' then app.product_unit_price_cents(v_product) else v_product.price_cents end
    );
    v_line_total := v_price * v_quantity;
    v_description := v_product.name
      || case when v_unit = 'unit' then ' (' || v_product.unit_name || ')' else '' end;

    -- Mismo desglose por partida que lib/money.ts#splitTaxIncluded (§8.2).
    insert into sale_items (
      tenant_id, sale_id, item_type, product_id, description,
      quantity, unit_price_cents, tax_rate_bp, tax_cents, line_total_cents,
      sold_unit, units_per_package_snapshot, sat_unit_code_snapshot
    )
    values (
      p_tenant_id, p_sale_id, 'product', v_product.id, v_description,
      v_quantity, v_price, v_product.tax_rate_bp,
      v_line_total - round((v_line_total::numeric * 10000) / (10000 + v_product.tax_rate_bp))::integer,
      v_line_total,
      v_unit, v_product.units_per_package,
      case when v_unit = 'unit' then v_product.unit_sat_code end
    );

    insert into stock_movements (tenant_id, branch_id, product_id, movement_type, quantity, sale_id, created_by)
    values (p_tenant_id, p_branch_id, v_product.id, 'sale', -v_units, p_sale_id, auth.uid());
  end loop;
end;
$$;

-- =============================================================================
-- 6. Consumo en consulta por unidad o por envase
-- =============================================================================
-- Gana el parámetro p_unit (por defecto 'package': quien llama como antes obtiene lo mismo).
-- Cambia la firma, así que se reemplaza (drop + create) y se vuelven a dar los permisos.
drop function add_appointment_product(uuid, uuid, integer, boolean);

create function add_appointment_product(
  p_appointment_id uuid,
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
  v_appointment appointments;
  v_product products;
  v_unit text := coalesce(nullif(p_unit, ''), 'package');
  v_units integer;
  v_stock integer;
  v_price integer;
  v_line_id uuid;
begin
  v_appointment := app.appointment_for_consumption(p_appointment_id);

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La cantidad debe ser mayor a cero.' using errcode = 'check_violation';
  end if;
  if v_unit not in ('package', 'unit') then
    raise exception 'La unidad de venta no es válida.' using errcode = 'check_violation';
  end if;

  -- Del mismo negocio, activo y no borrado (esta función salta RLS).
  select * into v_product
    from products
   where id = p_product_id
     and tenant_id = v_appointment.tenant_id
     and deleted_at is null
     and is_active;
  if not found then
    raise exception 'El producto no existe o no está disponible.' using errcode = 'no_data_found';
  end if;

  if v_unit = 'unit' and v_product.units_per_package = 1 then
    raise exception 'El producto "%" no se usa por unidad.', v_product.name using errcode = 'check_violation';
  end if;

  v_units := p_quantity * case when v_unit = 'unit' then 1 else v_product.units_per_package end;

  select coalesce(sum(quantity), 0)::integer into v_stock
    from stock_movements
   where tenant_id = v_appointment.tenant_id
     and branch_id = v_appointment.branch_id
     and product_id = v_product.id;
  if v_stock <= 0 then
    raise exception 'El producto "%" no tiene existencia.', v_product.name using errcode = 'check_violation';
  end if;

  v_price := case when v_unit = 'unit' then app.product_unit_price_cents(v_product) else v_product.price_cents end;

  insert into appointment_products (
    tenant_id, appointment_id, product_id, name_snapshot, unit_price_cents, tax_rate_bp,
    quantity, is_billable, created_by, sold_unit, units_per_package_snapshot
  )
  values (
    v_appointment.tenant_id, p_appointment_id, v_product.id,
    v_product.name || case when v_unit = 'unit' then ' (' || v_product.unit_name || ')' else '' end,
    v_price, v_product.tax_rate_bp, p_quantity, coalesce(p_is_billable, true), auth.uid(),
    v_unit, v_product.units_per_package
  )
  returning id into v_line_id;

  -- Si no alcanza, el trigger de stock_movements lanza y se deshace TODO (la línea
  -- incluida): nunca queda una línea sin su descuento.
  insert into stock_movements (
    tenant_id, branch_id, product_id, movement_type, quantity, appointment_product_id, created_by
  )
  values (
    v_appointment.tenant_id, v_appointment.branch_id, v_product.id, 'consumption', -v_units,
    v_line_id, auth.uid()
  );

  return v_line_id;
end;
$$;

comment on function add_appointment_product(uuid, uuid, integer, boolean, text) is
  'Registra un insumo usado en una consulta (por envase o por unidad suelta) y baja la existencia en la misma transacción. Solo dueño y veterinario.';

revoke execute on function add_appointment_product(uuid, uuid, integer, boolean, text) from public, anon;
grant execute on function add_appointment_product(uuid, uuid, integer, boolean, text) to authenticated;

-- =============================================================================
-- 7. Reporte de lo más vendido: no mezclar envases con unidades sueltas
-- =============================================================================
-- Sumar "3 tabletas" y "1 caja" como 4 no dice nada. Se agrupa también por la unidad vendida:
-- la descripción ya trae "(tableta)", así que salen dos renglones del mismo producto.
create or replace function report_top_items(
  p_tenant_id uuid,
  p_from date,
  p_to date,
  p_branch_id uuid default null,
  p_limit integer default 20
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform app.assert_report_access(p_tenant_id, p_from, p_to, p_branch_id);
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'El límite debe estar entre 1 y 100.' using errcode = '22023';
  end if;

  with scope as (
    select b.id, b.timezone
    from branches b
    where b.tenant_id = p_tenant_id
      and b.deleted_at is null
      and app.can_access_branch(b.id)
      and (p_branch_id is null or b.id = p_branch_id)
  ),
  items as (
    select
      si.item_type,
      coalesce(si.service_id, si.product_id) as item_id,
      si.sold_unit,
      si.description, si.quantity, si.line_total_cents, si.tax_cents, si.sale_id, si.created_at
    from sale_items si
    join sales sa on sa.id = si.sale_id
    join scope sc on sc.id = sa.branch_id
    where si.tenant_id = p_tenant_id
      and si.deleted_at is null
      and sa.deleted_at is null
      and sa.status = 'paid'
      and sa.paid_at is not null
      and (sa.paid_at at time zone sc.timezone)::date between p_from and p_to
  ),
  agg as (
    select
      item_type, item_id, sold_unit,
      (array_agg(description order by created_at desc))[1] as name,
      sum(quantity)::bigint as quantity,
      sum(line_total_cents)::bigint as revenue_cents,
      sum(tax_cents)::bigint as iva_cents,
      count(distinct sale_id) as sales_count
    from items
    group by item_type, item_id, sold_unit
  )
  select jsonb_build_object(
    'services', (
      select coalesce(jsonb_agg(row), '[]'::jsonb) from (
        select jsonb_build_object(
          'item_id', item_id, 'sold_unit', sold_unit, 'name', name, 'quantity', quantity,
          'revenue_cents', revenue_cents, 'iva_cents', iva_cents, 'sales_count', sales_count
        ) as row
        from agg where item_type = 'service'
        order by quantity desc, revenue_cents desc, name
        limit p_limit
      ) x
    ),
    'products', (
      select coalesce(jsonb_agg(row), '[]'::jsonb) from (
        select jsonb_build_object(
          'item_id', item_id, 'sold_unit', sold_unit, 'name', name, 'quantity', quantity,
          'revenue_cents', revenue_cents, 'iva_cents', iva_cents, 'sales_count', sales_count
        ) as row
        from agg where item_type = 'product'
        order by quantity desc, revenue_cents desc, name
        limit p_limit
      ) x
    )
  ) into v_result;

  return v_result;
end;
$$;;
