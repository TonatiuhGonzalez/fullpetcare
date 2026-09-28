-- Tarea #1906: catálogo real de planes.
--
-- =============================================================================
-- El problema que resuelve
-- =============================================================================
-- Hasta ahora `tenant_platform_info.plan` era texto libre, fijo en "Básico" —
-- nadie lo podía cambiar: no existía ni una sola RPC que escribiera esa
-- columna. La vigencia (`plan_expires_at`) sí la usa #1905 para calcular
-- solo-lectura/bloqueo, pero tampoco la fija nadie. Esta migración resuelve
-- ambas cosas, con el modelo decidido con el usuario:
--
--   1. Los planes viven en un catálogo (`plans`), administrado por el
--      superadmin — mismo patrón que `cancellation_reasons` (#1905): tabla
--      de PLATAFORMA (sin tenant_id), RLS de solo lectura, se escribe solo
--      por RPC `platform_*`.
--   2. La vigencia YA NO se escribe a mano: se calcula sola a partir de la
--      forma de pago (`billing_period`) que se elige al asignar el plan —
--      `monthly` (mensual) suma 1 mes a partir de HOY, `yearly` (anual) suma
--      1 año, `indefinite` (indeterminado) deja `plan_expires_at` en NULL.
--      En el mundo real la elige el DUEÑO al suscribirse (mensual o anual);
--      `indefinite` es de uso interno del superadmin (negocios de cortesía,
--      internos, etc.) — hoy no hay pantalla de autoservicio para el dueño
--      (fuera de alcance, CLAUDE.md v1), así que quien asigna cualquiera de
--      los tres sigue siendo el superadmin desde `/superadmin`, igual que ya
--      asigna el plan y el estado. Cuando exista esa pantalla, esta misma
--      columna y este mismo cálculo sirven sin tocarlos.
--   3. El plan sigue siendo SOLO INFORMATIVO — igual que hoy. Lo único que
--      ya limita el acceso es el estado + la vigencia (#1905,
--      app.tenant_access_level()), que esta migración no toca. Poner cuotas
--      de uso por plan (sucursales, empleados…) queda fuera de esta tarea.
--
-- =============================================================================
-- Por qué FK + snapshot, y no solo una FK
-- =============================================================================
-- `tenant_platform_info` guarda DOS cosas: `plan_id` (la relación viva, para
-- saber "¿qué plan tiene hoy?") y `plan_name_snapshot` (una COPIA del nombre
-- al momento de asignarlo). Es el mismo patrón que
-- `appointment_services.name_snapshot` (CLAUDE.md §6.3): si mañana el
-- superadmin renombra "Pro" a "Profesional", las empresas que ya tenían
-- "Pro" asignado no deben cambiar de nombre solas en la lista ni en la
-- bitácora — el cambio se ve la próxima vez que alguien les asigne un plan
-- otra vez. `platform_list_tenants()` sigue devolviendo esta columna con el
-- nombre `plan` (no `plan_name`) a propósito: es la misma que ya leen
-- services/platform.ts y sus tests, y renombrarla sin necesidad solo
-- generaría un diff enorme sin aportar nada.

create table plans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  -- Un plan ya asignado no se borra: se desactiva y deja de ofrecerse para
  -- asignaciones nuevas (igual que cancellation_reasons.is_active).
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table plans is
  'Catálogo de planes de la plataforma. Tabla de plataforma (sin tenant_id): solo superadmins la leen y la escriben (vía RPC). Ver tenant_platform_info.plan_id/plan_name_snapshot.';

-- El plan con el que ya nace todo negocio (trigger de tenants, más abajo) y
-- el que tenían todas las empresas existentes hasta hoy.
insert into plans (name) values ('Básico');

create trigger set_updated_at
  before update on plans
  for each row execute function app.set_updated_at();

create trigger plans_audit
  after insert or update or delete on plans
  for each row execute function app.log_platform_change();

alter table plans enable row level security;
alter table plans force row level security;

create policy plans_select on plans for select
  to authenticated
  using (app.is_platform_admin());

-- Sin políticas de escritura: solo las RPC de abajo (platform_create_plan /
-- platform_update_plan).

-- =============================================================================
-- tenant_platform_info: de texto libre a catálogo
-- =============================================================================
alter table tenant_platform_info
  add column plan_id uuid references plans(id),
  add column plan_name_snapshot text;

-- Backfill: todas las filas existentes tenían 'Básico' en el texto libre (no
-- había forma de ponerles otra cosa). Se copia tal cual a la snapshot y se
-- enlazan al plan 'Básico' recién creado.
update tenant_platform_info
set plan_name_snapshot = plan,
    plan_id = (select id from plans where name = 'Básico' order by created_at limit 1);

alter table tenant_platform_info
  alter column plan_id set not null,
  alter column plan_name_snapshot set not null;

alter table tenant_platform_info drop column plan;

comment on column tenant_platform_info.plan_id is
  'Plan asignado hoy (FK a plans). Lo cambia platform_set_tenant_plan.';
comment on column tenant_platform_info.plan_name_snapshot is
  'Copia del nombre del plan al momento de asignarlo — igual que appointment_services.name_snapshot. Renombrar el plan en el catálogo no cambia esto retroactivamente.';

-- =============================================================================
-- Forma de pago: de ella sale la vigencia
-- =============================================================================
-- 'indefinite' es el default: todos los negocios de hoy (y los nuevos, hasta
-- que se asignen de otra forma) nacen sin vencimiento — es justo lo que ya
-- pasaba antes de esta migración (plan_expires_at siempre NULL).
create type plan_billing_period as enum ('monthly', 'yearly', 'indefinite');

alter table tenant_platform_info
  add column billing_period plan_billing_period not null default 'indefinite';

comment on column tenant_platform_info.billing_period is
  'Forma de pago del plan asignado: monthly/yearly calculan plan_expires_at solos (hoy + 1 mes / + 1 año) al asignarse; indefinite lo deja en NULL. La fija platform_set_tenant_plan.';

-- =============================================================================
-- Un negocio nuevo nace con el plan 'Básico'
-- =============================================================================
-- Se reemplaza el cuerpo del trigger de tenants (creado en
-- tenant_platform_info.sql): antes insertaba solo tenant_id y confiaba en el
-- default de la columna `plan`; ahora esa columna no existe y hay que fijar
-- plan_id/plan_name_snapshot a mano. Mismo trigger, mismo nombre — se
-- reemplaza con CREATE OR REPLACE en vez de reescribir la migración vieja
-- (CLAUDE.md §8.1).
create or replace function app.create_tenant_platform_info()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_plan_id uuid;
begin
  select id into v_plan_id from plans where name = 'Básico' order by created_at limit 1;

  insert into tenant_platform_info (tenant_id, plan_id, plan_name_snapshot)
  values (new.id, v_plan_id, 'Básico')
  on conflict (tenant_id) do nothing;

  return null;
end;
$$;

-- =============================================================================
-- platform_list_tenants: agrega plan_id (la columna `plan` sigue siendo el
-- nombre, ahora desde la snapshot)
-- =============================================================================
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
  owner_phone text
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
    p.phone
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
  'Superadmin: lista de negocios con plan (id + nombre), estado, notas y datos del dueño (nombre, correo, teléfono). Revalida is_platform_admin().';

-- =============================================================================
-- platform_set_tenant_plan(tenant, plan, forma de pago)
-- =============================================================================
-- Asigna el plan y, con la forma de pago elegida, CALCULA la vigencia a
-- partir de HOY — ya no se recibe una fecha: `monthly` suma 1 mes, `yearly`
-- suma 1 año, `indefinite` la deja en NULL. Las tres cosas juntas (plan,
-- forma de pago, vigencia) en una sola llamada: separarlas dejaría una
-- ventana donde el plan ya cambió pero la vigencia todavía es la anterior.
--
-- Llamar esta función de nuevo (mismo plan u otro) recalcula la vigencia
-- desde HOY — es, hoy por hoy, la única forma de "renovar": no hay cobro
-- real ni job que lo haga solo (fuera de alcance en v1).
create function platform_set_tenant_plan(
  p_tenant_id uuid,
  p_plan_id uuid,
  p_billing_period plan_billing_period
)
returns tenant_platform_info
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_info tenant_platform_info;
  v_plan_name text;
  v_expires_at timestamptz;
begin
  if not app.is_platform_admin() then
    raise exception 'No tienes permiso para administrar la plataforma.' using errcode = 'insufficient_privilege';
  end if;

  select name into v_plan_name from plans where id = p_plan_id and is_active and deleted_at is null;
  if not found then
    raise exception 'Elige un plan activo.' using errcode = 'check_violation';
  end if;

  v_expires_at := case p_billing_period
    when 'monthly' then now() + interval '1 month'
    when 'yearly' then now() + interval '1 year'
    else null
  end;

  update tenant_platform_info
  set plan_id = p_plan_id,
      plan_name_snapshot = v_plan_name,
      billing_period = p_billing_period,
      plan_expires_at = v_expires_at
  where tenant_id = p_tenant_id
  returning * into v_info;

  if not found then
    raise exception 'La empresa no existe.' using errcode = 'no_data_found';
  end if;

  return v_info;
end;
$$;

comment on function platform_set_tenant_plan(uuid, uuid, plan_billing_period) is
  'Superadmin: asigna un plan del catálogo y su forma de pago; calcula la vigencia sola (mensual = +1 mes, anual = +1 año, indeterminado = NULL) desde HOY. Solo etiqueta + vigencia: no limita nada por sí solo (eso lo hace app.tenant_access_level() con status/plan_expires_at, #1905).';

-- =============================================================================
-- Catálogo: platform_create_plan / platform_update_plan
-- =============================================================================
create function platform_create_plan(p_name text)
returns plans
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row plans;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not app.is_platform_admin() then
    raise exception 'No tienes permiso para administrar la plataforma.' using errcode = 'insufficient_privilege';
  end if;
  if v_name = '' then
    raise exception 'Escribe el nombre del plan.' using errcode = 'check_violation';
  end if;

  insert into plans (name) values (v_name) returning * into v_row;
  return v_row;
end;
$$;

comment on function platform_create_plan(text) is
  'Superadmin: agrega un plan al catálogo, activo por default.';

-- Cambiar el nombre o activar/desactivar. Renombrar NO toca las empresas que
-- ya tienen este plan asignado (plan_name_snapshot es una copia, ver arriba).
create function platform_update_plan(p_id uuid, p_name text, p_is_active boolean)
returns plans
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row plans;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not app.is_platform_admin() then
    raise exception 'No tienes permiso para administrar la plataforma.' using errcode = 'insufficient_privilege';
  end if;
  if v_name = '' then
    raise exception 'Escribe el nombre del plan.' using errcode = 'check_violation';
  end if;

  update plans
  set name = v_name, is_active = p_is_active
  where id = p_id and deleted_at is null
  returning * into v_row;

  if not found then
    raise exception 'El plan no existe.' using errcode = 'no_data_found';
  end if;

  return v_row;
end;
$$;

comment on function platform_update_plan(uuid, text, boolean) is
  'Superadmin: renombra o activa/desactiva un plan del catálogo. No cambia el nombre ya asignado (snapshot) de las empresas que lo usan.';

-- =============================================================================
-- Permisos de ejecución
-- =============================================================================
revoke execute on function platform_list_tenants() from public, anon;
revoke execute on function platform_set_tenant_plan(uuid, uuid, plan_billing_period) from public, anon;
revoke execute on function platform_create_plan(text) from public, anon;
revoke execute on function platform_update_plan(uuid, text, boolean) from public, anon;

grant execute on function platform_list_tenants() to authenticated;
grant execute on function platform_set_tenant_plan(uuid, uuid, plan_billing_period) to authenticated;
grant execute on function platform_create_plan(text) to authenticated;
grant execute on function platform_update_plan(uuid, text, boolean) to authenticated;
