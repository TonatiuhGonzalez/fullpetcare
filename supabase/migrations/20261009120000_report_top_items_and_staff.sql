-- Reportes de lo más vendido y de la actividad por empleado (fase 12, tareas 12.8
-- y 12.9 / HMH Four #2076, PLAN.md D17). Mismas reglas que report_sales_summary:
-- agregan en la base, el periodo son fechas LOCALES de cada sucursal (§8.3), solo
-- cuentan ventas `paid`, exigen permiso `reports`/ver y acceso a la sucursal
-- (§7.3.4), y responden igual "sin permiso" ante un negocio o sucursal ajenos.

-- =============================================================================
-- Validación común
-- =============================================================================
-- Interna (sin EXECUTE para usuarios): la usan las dos funciones de abajo para no
-- repetir el bloque de permisos y de periodo. Es SECURITY DEFINER porque
-- `app.has_permission` y `app.is_member_of` consultan tablas protegidas.
create function app.assert_report_access(
  p_tenant_id uuid,
  p_from date,
  p_to date,
  p_branch_id uuid
) returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not app.is_member_of(p_tenant_id)
     or not app.has_permission(p_tenant_id, 'reports', 'view') then
    raise exception 'No tienes permiso para ver los reportes.' using errcode = '42501';
  end if;

  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'El periodo no es válido.' using errcode = '22023';
  end if;
  if p_to - p_from > 366 then
    raise exception 'El periodo no puede ser mayor a un año.' using errcode = '22023';
  end if;

  if p_branch_id is not null and not exists (
    select 1 from branches b
    where b.id = p_branch_id and b.tenant_id = p_tenant_id and b.deleted_at is null
      and app.can_access_branch(b.id)
  ) then
    raise exception 'No tienes permiso para ver los reportes.' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function app.assert_report_access(uuid, date, date, uuid) from public, anon, authenticated;

-- =============================================================================
-- 12.8 report_top_items(): servicios y productos más vendidos
-- =============================================================================
-- Devuelve { services: [...], products: [...] }, cada lista ordenada por cantidad
-- y luego por importe, con las `p_limit` primeras. Qué entra:
--   * Partidas (`sale_items`) de ventas pagadas del periodo; las de una venta
--     cancelada no.
--   * Un insumo de consulta que se cobró (11.14) cuenta como PRODUCTO.
--   * `revenue_cents` es el importe de la partida CON IVA y ANTES del descuento de
--     la venta (el descuento es de toda la venta, no de una partida), así que la
--     suma de la lista puede exceder al total de ventas cuando hubo descuentos.
--   * `iva_cents` es el IVA de la partida, desglosado por partida como siempre (§8.2).
--   * El nombre es el de la partida más reciente (la partida guarda el nombre del
--     día de la venta; si el producto se renombra, se muestra el último).
create function report_top_items(
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
      item_type, item_id,
      (array_agg(description order by created_at desc))[1] as name,
      sum(quantity)::bigint as quantity,
      sum(line_total_cents)::bigint as revenue_cents,
      sum(tax_cents)::bigint as iva_cents,
      count(distinct sale_id) as sales_count
    from items
    group by item_type, item_id
  )
  select jsonb_build_object(
    'services', (
      select coalesce(jsonb_agg(row), '[]'::jsonb) from (
        select jsonb_build_object(
          'item_id', item_id, 'name', name, 'quantity', quantity,
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
          'item_id', item_id, 'name', name, 'quantity', quantity,
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
$$;

revoke execute on function report_top_items(uuid, date, date, uuid, integer) from public, anon;
grant execute on function report_top_items(uuid, date, date, uuid, integer) to authenticated;

comment on function report_top_items(uuid, date, date, uuid, integer) is
  'Servicios y productos más vendidos del periodo (cantidad e importe con IVA antes del descuento), de ventas pagadas. Exige permiso reports/ver.';

-- =============================================================================
-- 12.9 report_staff_activity(): actividad por empleado
-- =============================================================================
-- Una fila por empleado: citas completadas del periodo, importe de servicios y de
-- productos que se le atribuyen. Regla de atribución (decisión 8 de D17), por
-- PARTIDA de una venta pagada:
--   1. Una partida ligada a una cita (servicios, insumos de consulta) va al
--      empleado de ESA cita.
--   2. Un producto sin cita, en una venta que sí lleva citas, va al empleado de la
--      cita más temprana de esa venta (un producto vendido con un servicio se
--      atribuye al empleado del servicio).
--   3. Una venta sin ninguna cita (mostrador) va a quien cobró (`sales.closed_by`).
-- Lo que no tenga empleado (cita sin empleado, venta antigua sin `closed_by`) se
-- agrupa en una fila "Sin asignar" (user_id nulo) en vez de perderse. Las citas
-- completadas se cuentan por su fecha local de inicio, y no dependen de que se
-- haya cobrado. Un empleado dado de baja aparece si tuvo actividad. Los importes
-- son con IVA y antes del descuento de la venta, igual que report_top_items.
create function report_staff_activity(
  p_tenant_id uuid,
  p_from date,
  p_to date,
  p_branch_id uuid default null
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

  with scope as (
    select b.id, b.timezone
    from branches b
    where b.tenant_id = p_tenant_id
      and b.deleted_at is null
      and app.can_access_branch(b.id)
      and (p_branch_id is null or b.id = p_branch_id)
  ),
  paid_sales as (
    select sa.id, sa.closed_by
    from sales sa
    join scope sc on sc.id = sa.branch_id
    where sa.tenant_id = p_tenant_id
      and sa.deleted_at is null
      and sa.status = 'paid'
      and sa.paid_at is not null
      and (sa.paid_at at time zone sc.timezone)::date between p_from and p_to
  ),
  sale_first_appt as (
    -- El empleado de la cita más temprana de cada venta que lleva citas.
    select distinct on (si.sale_id) si.sale_id, a.employee_user_id
    from sale_items si
    join appointments a on a.id = si.appointment_id
    where si.sale_id in (select id from paid_sales) and si.deleted_at is null
    order by si.sale_id, a.starts_at, a.id
  ),
  attributed as (
    select
      si.item_type,
      si.line_total_cents,
      case
        when si.appointment_id is not null then a.employee_user_id
        when sfa.sale_id is not null then sfa.employee_user_id
        else ps.closed_by
      end as employee_id
    from sale_items si
    join paid_sales ps on ps.id = si.sale_id
    left join appointments a on a.id = si.appointment_id
    left join sale_first_appt sfa on sfa.sale_id = si.sale_id
    where si.deleted_at is null
  ),
  -- FULL JOIN solo admite igualdad simple, y `null = null` no es verdadero: el
  -- empleado nulo ("Sin asignar") se representa con un uuid centinela de ceros
  -- solo para unir, y se vuelve a nulo al final.
  money as (
    select
      coalesce(employee_id, '00000000-0000-0000-0000-000000000000'::uuid) as emp_key,
      coalesce(sum(line_total_cents) filter (where item_type = 'service'), 0)::bigint as services_cents,
      coalesce(sum(line_total_cents) filter (where item_type = 'product'), 0)::bigint as products_cents
    from attributed
    group by 1
  ),
  done as (
    select a.employee_user_id as emp_key, count(*)::bigint as appointments_completed
    from appointments a
    join scope sc on sc.id = a.branch_id
    where a.tenant_id = p_tenant_id
      and a.deleted_at is null
      and a.status = 'completed'
      and (a.starts_at at time zone sc.timezone)::date between p_from and p_to
    group by a.employee_user_id
  ),
  merged as (
    select
      nullif(coalesce(m.emp_key, d.emp_key), '00000000-0000-0000-0000-000000000000'::uuid) as employee_id,
      coalesce(d.appointments_completed, 0) as appointments_completed,
      coalesce(m.services_cents, 0) as services_cents,
      coalesce(m.products_cents, 0) as products_cents
    from money m
    full outer join done d on d.emp_key = m.emp_key
  )
  select coalesce(jsonb_agg(row order by (row->>'total_cents')::bigint desc, row->>'full_name'), '[]'::jsonb)
  into v_result
  from (
    select jsonb_build_object(
      'user_id', mg.employee_id,
      'full_name', case when mg.employee_id is null then 'Sin asignar' else coalesce(p.full_name, '(sin nombre)') end,
      'appointments_completed', mg.appointments_completed,
      'services_cents', mg.services_cents,
      'products_cents', mg.products_cents,
      'total_cents', mg.services_cents + mg.products_cents
    ) as row
    from merged mg
    left join profiles p on p.id = mg.employee_id
  ) x;

  return v_result;
end;
$$;

revoke execute on function report_staff_activity(uuid, date, date, uuid) from public, anon;
grant execute on function report_staff_activity(uuid, date, date, uuid) to authenticated;

comment on function report_staff_activity(uuid, date, date, uuid) is
  'Actividad por empleado del periodo: citas completadas e importe de servicios y productos atribuidos (cita > cita de la venta > quien cobró). Lo que no tiene empleado va a "Sin asignar". Exige permiso reports/ver.';
