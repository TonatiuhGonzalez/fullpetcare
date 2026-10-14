-- Fase 30 (PLAN.md D30, punto 6): cobro rápido — un servicio y/o productos sin cita y sin
-- registrar al cliente.
--
-- El veterinario lo pidió así: muchos clientes llegan a algo sencillo y no quieren dar de
-- alta sus datos, porque hacerlo tarda más que el asunto. La venta lleva:
--   * quién atendió (`attended_by_user_id`), para el reporte por empleado;
--   * el grupo de especie de la mascota (`species_group_id`: perro, gato, ave, reptil…), solo
--     como dato de estadística; sin mascota ni cliente registrados.
-- Sin cliente (`customer_id` nulo, ya permitido desde la fase 13) y sin cita.
--
-- Entra a Caja y a Reportes como cualquier venta pagada: es una fila de `sales` con sus
-- `sale_items` y `payments`, y la existencia baja por el mismo camino que la venta de mostrador.
--
-- Migración ADITIVA (§8.1): dos columnas nulas, una RPC nueva y dos funciones de reporte.

alter table sales add column attended_by_user_id uuid references auth.users(id);
alter table sales add column species_group_id uuid;
alter table sales
  add constraint sales_species_group_fkey
  foreign key (tenant_id, species_group_id) references species_groups (tenant_id, id);

comment on column sales.attended_by_user_id is
  'Quién atendió, en un cobro rápido (fase 30). Nulo en el resto de las ventas: se atribuye a la cita o a quien cobró.';
comment on column sales.species_group_id is
  'Grupo de especie de la mascota atendida en un cobro rápido (dato de estadística). Nulo si no se indicó.';

-- Los servicios del cobro rápido no tienen cita: la partida es de tipo servicio con su servicio.
-- (sale_items_one_source ya admite item_type = 'service' con service_id y sin product_id.)

-- =============================================================================
-- checkout_quick_sale()
-- =============================================================================
-- p_services: [{ service_id, quantity }]  (precio e IVA del catálogo del negocio)
-- p_products: [{ product_id, quantity, unit?, unit_price_cents? }]  (igual que la venta de mostrador)
create function checkout_quick_sale(
  p_branch_id uuid,
  p_services jsonb,
  p_products jsonb,
  p_payments jsonb,
  p_discount_cents integer default 0,
  p_attended_by uuid default null,
  p_species_group_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_branch branches;
  v_sale_id uuid;
  v_folio integer;
  v_discount_cents integer := coalesce(p_discount_cents, 0);
  v_elem jsonb;
  v_service services;
  v_quantity integer;
  v_line_total integer;
  v_has_services boolean;
  v_has_products boolean;
begin
  select * into v_branch from branches where id = p_branch_id and deleted_at is null and is_active;
  if not found then
    raise exception 'La sucursal no existe.' using errcode = 'no_data_found';
  end if;

  -- Revalidación primero (§7.3.4): membresía, sucursal y rol.
  if not app.is_member_of(v_branch.tenant_id) then
    raise exception 'No perteneces a este negocio.' using errcode = 'insufficient_privilege';
  end if;
  if not app.can_access_branch(v_branch.id) then
    raise exception 'No tienes acceso a esta sucursal.' using errcode = 'insufficient_privilege';
  end if;
  if app.role_in(v_branch.tenant_id) not in ('owner', 'receptionist') then
    raise exception 'No tienes permiso para cobrar.' using errcode = 'insufficient_privilege';
  end if;

  v_has_services := p_services is not null and jsonb_typeof(p_services) = 'array' and jsonb_array_length(p_services) > 0;
  v_has_products := p_products is not null and jsonb_typeof(p_products) = 'array' and jsonb_array_length(p_products) > 0;
  if not v_has_services and not v_has_products then
    raise exception 'Agrega al menos un servicio o un producto.' using errcode = 'check_violation';
  end if;

  if p_payments is null or jsonb_array_length(p_payments) = 0 then
    raise exception 'Debes registrar al menos un pago.' using errcode = 'check_violation';
  end if;
  if v_discount_cents < 0 then
    raise exception 'El descuento no puede ser negativo.' using errcode = 'check_violation';
  end if;

  -- Quién atendió: una persona activa de este negocio.
  if p_attended_by is not null and not exists (
    select 1 from memberships m
     where m.tenant_id = v_branch.tenant_id and m.user_id = p_attended_by
       and m.is_active and m.deleted_at is null
  ) then
    raise exception 'La persona que atendió no pertenece a este negocio.' using errcode = 'check_violation';
  end if;

  if p_species_group_id is not null and not exists (
    select 1 from species_groups g
     where g.id = p_species_group_id and g.tenant_id = v_branch.tenant_id and g.deleted_at is null
  ) then
    raise exception 'El grupo de especie no existe.' using errcode = 'check_violation';
  end if;

  select coalesce(max(folio), 0) + 1 into v_folio
  from sales
  where tenant_id = v_branch.tenant_id and branch_id = v_branch.id;

  insert into sales (
    tenant_id, branch_id, customer_id, folio, status,
    subtotal_cents, tax_cents, discount_cents, total_cents, paid_at, closed_by,
    attended_by_user_id, species_group_id
  )
  values (
    v_branch.tenant_id, v_branch.id, null, v_folio, 'paid',
    0, 0, v_discount_cents, 0, now(), auth.uid(),
    p_attended_by, p_species_group_id
  )
  returning id into v_sale_id;

  if v_has_services then
    for v_elem in select * from jsonb_array_elements(p_services) loop
      v_quantity := (v_elem->>'quantity')::integer;
      if v_quantity is null or v_quantity <= 0 then
        raise exception 'La cantidad de cada servicio debe ser mayor a cero.' using errcode = 'check_violation';
      end if;

      -- Del mismo negocio, activo y no borrado (esta función salta RLS).
      select * into v_service
        from services
       where id = (v_elem->>'service_id')::uuid
         and tenant_id = v_branch.tenant_id
         and deleted_at is null
         and is_active;
      if not found then
        raise exception 'El servicio no existe o no está disponible.' using errcode = 'no_data_found';
      end if;

      v_line_total := v_service.price_cents * v_quantity;
      -- Mismo desglose por partida que lib/money.ts#splitTaxIncluded (§8.2).
      insert into sale_items (
        tenant_id, sale_id, item_type, service_id, description,
        quantity, unit_price_cents, tax_rate_bp, tax_cents, line_total_cents
      )
      values (
        v_branch.tenant_id, v_sale_id, 'service', v_service.id, v_service.name,
        v_quantity, v_service.price_cents, v_service.tax_rate_bp,
        v_line_total - round((v_line_total::numeric * 10000) / (10000 + v_service.tax_rate_bp))::integer,
        v_line_total
      );
    end loop;
  end if;

  perform app.add_product_items(v_sale_id, v_branch.tenant_id, v_branch.id, coalesce(p_products, '[]'::jsonb));
  perform app.finalize_sale(v_sale_id, v_branch.tenant_id, v_discount_cents, p_payments);

  return v_sale_id;
end;
$$;

comment on function checkout_quick_sale(uuid, jsonb, jsonb, jsonb, integer, uuid, uuid) is
  'Cobro rápido: servicios y/o productos sin cita y sin cliente, con quién atendió y el grupo de especie. Mismo cierre y revalidación que el cobro de mostrador. Solo dueño y recepción.';

revoke execute on function checkout_quick_sale(uuid, jsonb, jsonb, jsonb, integer, uuid, uuid) from public, anon;
grant execute on function checkout_quick_sale(uuid, jsonb, jsonb, jsonb, integer, uuid, uuid) to authenticated;

-- =============================================================================
-- Reportes
-- =============================================================================
-- Actividad por empleado: un servicio de cobro rápido se atribuye a quien atendió.
create or replace function report_staff_activity(
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
    select sa.id, sa.closed_by, sa.attended_by_user_id
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
        -- Cobro rápido (fase 30): lo atendió quien se indicó; si no se indicó, quien cobró.
        else coalesce(ps.attended_by_user_id, ps.closed_by)
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
$$;;

-- Ventas por grupo de especie (estadística): cuántas ventas y cuánto, por perro, gato, ave…
-- Las ventas sin ese dato (casi todas: de cita o de mostrador) salen aparte como "Sin dato".
create function report_sales_by_species_group(
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
  )
  select coalesce(jsonb_agg(row order by (row->>'total_cents')::bigint desc, row->>'name'), '[]'::jsonb)
  into v_result
  from (
    select jsonb_build_object(
      'group_id', g.id,
      'name', coalesce(g.name, 'Sin dato'),
      'sales_count', count(*),
      'total_cents', coalesce(sum(sa.total_cents), 0)::bigint
    ) as row
    from sales sa
    join scope sc on sc.id = sa.branch_id
    left join species_groups g on g.id = sa.species_group_id
    where sa.tenant_id = p_tenant_id
      and sa.deleted_at is null
      and sa.status = 'paid'
      and sa.paid_at is not null
      and (sa.paid_at at time zone sc.timezone)::date between p_from and p_to
    group by g.id, g.name
  ) x;

  return v_result;
end;
$$;

comment on function report_sales_by_species_group(uuid, date, date, uuid) is
  'Ventas pagadas del periodo por grupo de especie (dato de estadística del cobro rápido). Exige permiso reports/ver.';

revoke execute on function report_sales_by_species_group(uuid, date, date, uuid) from public, anon;
grant execute on function report_sales_by_species_group(uuid, date, date, uuid) to authenticated;
