-- La lista de negocios del panel de superadmin muestra cuáles son "de
-- demostración" (HMH Four #1908).
--
-- `tenant_platform_info.is_demo` ya existía (20260925120000_tenant_is_demo.sql):
-- `demo:reset` oculta las empresas con la marca que no sean las 3 de la semilla.
-- Pero la lista no la devolvía, así que quien administra no podía saber cuáles
-- se ocultarían al restablecer. Esta migración solo agrega la columna al final
-- del resultado; el resto de la función es idéntico al de plans_catalog.sql.
drop function platform_list_tenants();

create function platform_list_tenants()
returns table (
  tenant_id uuid,
  name text,
  created_at timestamptz,
  plan_id uuid,
  plan text,
  plan_expires_at timestamptz,
  billing_period plan_billing_period,
  status tenant_status,
  status_reason text,
  public_reason text,
  internal_notes text,
  owner_user_id uuid,
  owner_name text,
  owner_email text,
  owner_phone text,
  is_demo boolean
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if not app.is_platform_admin() then
    raise exception 'No tienes permiso para administrar la plataforma.' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    t.id,
    t.name,
    t.created_at,
    i.plan_id,
    i.plan_name_snapshot,
    i.plan_expires_at,
    i.billing_period,
    i.status,
    i.status_reason,
    i.public_reason,
    i.internal_notes,
    o.user_id,
    p.full_name,
    u.email::text,
    p.phone,
    i.is_demo
  from tenants t
  join tenant_platform_info i on i.tenant_id = t.id
  left join lateral (
    select m.user_id
    from memberships m
    where m.tenant_id = t.id
      and m.role = 'owner'
      and m.is_active
      and m.deleted_at is null
    order by m.created_at
    limit 1
  ) o on true
  left join profiles p on p.id = o.user_id
  left join auth.users u on u.id = o.user_id
  where t.deleted_at is null
  order by t.created_at desc;
end;
$$;

comment on function platform_list_tenants() is
  'Superadmin: lista de negocios con plan (id + nombre), estado, notas, datos del dueño (nombre, correo, teléfono) y si es de demostración (is_demo). Revalida is_platform_admin().';

revoke execute on function platform_list_tenants() from public, anon;
grant execute on function platform_list_tenants() to authenticated;
