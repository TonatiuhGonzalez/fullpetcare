-- Tarea #1905: avisos de acceso para la persona que inicia sesión.
--
-- Le dice a cada persona, para SUS negocios, si algo limita su acceso o está
-- por limitarse, y por qué. La base oculta los negocios dados de baja de todas
-- las consultas normales y el motivo vive en una tabla que solo leen
-- superadmins; esta RPC es el único puente.
--
-- SECURITY DEFINER (salta RLS), así que revalida DENTRO (CLAUDE.md §7.3.4):
-- solo negocios donde auth.uid() tiene membresía activa, y nada si tiene
-- contraseña temporal pendiente. Devuelve el motivo PÚBLICO; nunca los
-- comentarios internos (status_reason) ni las notas (internal_notes).
--
-- notice:
--   expiring   la vigencia vence en 3 días o menos (todo funciona)
--   grace      venció hace menos de 2 días (todo funciona)
--   read_only  solo lectura
--   blocked    dado de baja
create function public.my_tenant_notices()
returns table (
  tenant_id uuid,
  tenant_name text,
  role member_role,
  notice text,
  public_reason text,
  plan_expires_at timestamptz,
  grace_ends_at timestamptz
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    t.id,
    t.name,
    m.role,
    case
      when app.tenant_access_level(t.id) = 'full' then 'expiring'
      else app.tenant_access_level(t.id)
    end,
    i.public_reason,
    i.plan_expires_at,
    i.plan_expires_at + interval '2 days'
  from memberships m
  join tenants t on t.id = m.tenant_id and t.deleted_at is null
  join tenant_platform_info i on i.tenant_id = t.id and i.deleted_at is null
  where m.user_id = auth.uid()
    and m.is_active
    and m.deleted_at is null
    and not app.has_pending_password_change()
    and (
      app.tenant_access_level(t.id) <> 'full'
      or (i.plan_expires_at is not null and i.plan_expires_at <= now() + interval '3 days')
    )
  order by t.name;
$$;

comment on function public.my_tenant_notices() is
  'Avisos de acceso (por vencer, gracia, solo lectura, baja) de los negocios donde el usuario actual es miembro. Solo motivo público.';

revoke execute on function public.my_tenant_notices() from public, anon;
grant execute on function public.my_tenant_notices() to authenticated;
