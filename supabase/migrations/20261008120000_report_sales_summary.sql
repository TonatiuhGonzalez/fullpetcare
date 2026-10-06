-- Reporte de ventas (fase 12, tarea 12.7 / HMH Four #2075, PLAN.md D17).
--
-- `report_sales_summary()` AGREGA en la base y devuelve un solo jsonb: totales,
-- ventas por día, por sucursal, cobrado por método de pago y canceladas aparte.
-- Por qué en la base y no sumando en el navegador: el API devuelve máximo 1 000
-- filas por consulta; un mes de ventas las pasaría y los totales saldrían MAL sin
-- ningún error.
--
-- Cómo se interpreta el periodo: `p_from` y `p_to` son FECHAS LOCALES (ambas
-- incluidas) y se evalúan en la zona horaria de cada sucursal (§8.3), no en UTC
-- ni en la del navegador. Una venta a las 11 pm en Tijuana es de ese día aunque
-- en UTC ya sea el siguiente.
--
-- Qué cuenta:
--   * Totales, por día y por sucursal: solo ventas `paid`.
--   * Canceladas: aparte (cuántas y por cuánto), con la fecha en que se pagaron.
--   * Abiertas: no cuentan.
--
-- Dos advertencias de lectura, también documentadas en TASKS.md 12.7:
--   * `subtotal_cents` e `iva_cents` son los guardados en la venta, ANTES del
--     descuento (el cobro no recalcula el IVA al descontar). `total_cents` ya trae
--     el descuento y es el dato exacto: subtotal + IVA − descuento = total.
--   * Por método de pago se reporta lo COBRADO sin el cambio (el cambio sale del
--     efectivo, igual que en el corte de caja). Si un cliente paga con tarjeta de
--     más, esa diferencia sí aparece en el método: el total por métodos puede
--     exceder al total de ventas por ese sobrepago.
--
-- Índice para el filtro por fecha de pago: sin él, cada reporte (y el cierre de
-- caja, que filtra igual) recorrería todas las ventas del negocio.
create index sales_tenant_branch_paid_at_idx
  on sales (tenant_id, branch_id, paid_at)
  where paid_at is not null;

-- SECURITY DEFINER: lee `sales` y `payments` por encima de las políticas de cada
-- tabla, así que revalida adentro membresía, permiso `reports` y sucursal (§7.3.4).
create function report_sales_summary(
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
  if not app.is_member_of(p_tenant_id)
     or not app.has_permission(p_tenant_id, 'reports', 'view') then
    raise exception 'No tienes permiso para ver los reportes.' using errcode = '42501';
  end if;

  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'El periodo no es válido.' using errcode = '22023';
  end if;
  -- Tope de un año: un periodo enorme solo sirve para tumbar la consulta.
  if p_to - p_from > 366 then
    raise exception 'El periodo no puede ser mayor a un año.' using errcode = '22023';
  end if;

  -- Una sucursal pedida a mano debe ser del negocio y accesible; mismo mensaje
  -- que sin permiso, sin revelar si existe.
  if p_branch_id is not null and not exists (
    select 1 from branches b
    where b.id = p_branch_id and b.tenant_id = p_tenant_id and b.deleted_at is null
      and app.can_access_branch(b.id)
  ) then
    raise exception 'No tienes permiso para ver los reportes.' using errcode = '42501';
  end if;

  with scope as (
    -- Las sucursales que esta persona puede ver (el dueño, todas).
    select b.id, b.name, b.timezone
    from branches b
    where b.tenant_id = p_tenant_id
      and b.deleted_at is null
      and app.can_access_branch(b.id)
      and (p_branch_id is null or b.id = p_branch_id)
  ),
  s as (
    select
      sa.id, sa.branch_id, sc.name as branch_name, sa.status,
      sa.subtotal_cents, sa.tax_cents, sa.discount_cents, sa.total_cents,
      (sa.paid_at at time zone sc.timezone)::date as local_day
    from sales sa
    join scope sc on sc.id = sa.branch_id
    where sa.tenant_id = p_tenant_id
      and sa.deleted_at is null
      and sa.paid_at is not null
      and sa.status in ('paid', 'cancelled')
      and (sa.paid_at at time zone sc.timezone)::date between p_from and p_to
  ),
  paid as (select * from s where status = 'paid'),
  per_sale_pay as (
    -- Por venta: lo recibido por método y el cambio (misma regla que lib/cashCount.ts).
    select
      pd.id,
      coalesce(sum(p.amount_cents) filter (where p.method = 'cash'), 0) as cash_in,
      coalesce(sum(p.amount_cents) filter (where p.method = 'card'), 0) as card_in,
      coalesce(sum(p.amount_cents) filter (where p.method = 'transfer_spei'), 0) as transfer_in,
      coalesce(sum(p.amount_cents) filter (where p.method = 'openpay'), 0) as openpay_in,
      coalesce(sum(p.amount_cents), 0) as paid_in,
      pd.total_cents
    from paid pd
    left join payments p on p.sale_id = pd.id and p.deleted_at is null
    group by pd.id, pd.total_cents
  ),
  with_change as (
    select *, least(cash_in, greatest(0, paid_in - total_cents)) as change_given from per_sale_pay
  ),
  days as (
    -- Todos los días del periodo, aunque no tengan ventas (para la gráfica).
    select d::date as day from generate_series(p_from, p_to, interval '1 day') as d
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'totals', (
      select jsonb_build_object(
        'sales_count', count(*),
        'subtotal_cents', coalesce(sum(subtotal_cents), 0),
        'iva_cents', coalesce(sum(tax_cents), 0),
        'discount_cents', coalesce(sum(discount_cents), 0),
        'total_cents', coalesce(sum(total_cents), 0)
      ) from paid
    ),
    'by_day', (
      select coalesce(jsonb_agg(row order by row->>'day'), '[]'::jsonb) from (
        select jsonb_build_object(
          'day', d.day,
          'sales_count', count(pd.id),
          'subtotal_cents', coalesce(sum(pd.subtotal_cents), 0),
          'iva_cents', coalesce(sum(pd.tax_cents), 0),
          'discount_cents', coalesce(sum(pd.discount_cents), 0),
          'total_cents', coalesce(sum(pd.total_cents), 0)
        ) as row
        from days d
        left join paid pd on pd.local_day = d.day
        group by d.day
      ) x
    ),
    'by_branch', (
      select coalesce(jsonb_agg(row order by row->>'branch_name'), '[]'::jsonb) from (
        select jsonb_build_object(
          'branch_id', sc.id,
          'branch_name', sc.name,
          'sales_count', count(pd.id),
          'subtotal_cents', coalesce(sum(pd.subtotal_cents), 0),
          'iva_cents', coalesce(sum(pd.tax_cents), 0),
          'discount_cents', coalesce(sum(pd.discount_cents), 0),
          'total_cents', coalesce(sum(pd.total_cents), 0)
        ) as row
        from scope sc
        left join paid pd on pd.branch_id = sc.id
        group by sc.id, sc.name
      ) x
    ),
    'by_method', (
      select jsonb_build_object(
        'cash_cents', coalesce(sum(cash_in - change_given), 0),
        'card_cents', coalesce(sum(card_in), 0),
        'transfer_cents', coalesce(sum(transfer_in), 0),
        'openpay_cents', coalesce(sum(openpay_in), 0),
        'change_given_cents', coalesce(sum(change_given), 0)
      ) from with_change
    ),
    'cancelled', (
      select jsonb_build_object(
        'sales_count', count(*),
        'total_cents', coalesce(sum(total_cents), 0)
      ) from s where status = 'cancelled'
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function report_sales_summary(uuid, date, date, uuid) from public, anon;
grant execute on function report_sales_summary(uuid, date, date, uuid) to authenticated;

comment on function report_sales_summary(uuid, date, date, uuid) is
  'Reporte de ventas del periodo (fechas locales de cada sucursal, ambas incluidas): totales, por día, por sucursal, cobrado por método y canceladas aparte. Exige permiso reports/view y acceso a la sucursal.';
