-- Tarea #1905: motivos PÚBLICOS de suspensión/baja.
--
-- Hasta ahora un negocio suspendido guardaba un solo texto libre
-- (`status_reason`) que solo leía el superadmin. Ahora el negocio también
-- verá POR QUÉ no puede operar, y eso no puede ser un texto libre que alguien
-- escribió pensando que era interno. Se separan dos cosas:
--
--   - MOTIVO PÚBLICO: se elige de un catálogo que administra el superadmin
--     (`cancellation_reasons`). Es lo único que el negocio ve.
--   - COMENTARIOS INTERNOS: `tenant_platform_info.status_reason` (ya existía).
--     Solo el superadmin. Pasa a ser opcional.
--
-- Del catálogo se COPIA el texto a la fila del negocio (`public_reason`), igual
-- que los `*_snapshot` de las citas (CLAUDE.md §6.3): si mañana se renombra un
-- motivo, lo que ya vio un cliente no cambia, y la bitácora sigue diciendo lo
-- que se dijo en su momento.
--
-- `cancellation_reasons` es una tabla de PLATAFORMA (como platform_admins): no
-- pertenece a ningún negocio, así que no lleva `tenant_id`. Se lee con RLS solo
-- para superadmins y se escribe solo por RPC `platform_*` (CLAUDE.md §7.5).

create type cancellation_reason_kind as enum ('non_payment', 'customer_request', 'other');

create table cancellation_reasons (
  id uuid primary key default gen_random_uuid(),
  -- Texto que verá el cliente.
  label text not null check (btrim(label) <> ''),
  -- `non_payment` y `customer_request` los usan las automatizaciones (vencimiento
  -- sin pago, cancelación por el dueño); los motivos que crea el superadmin son `other`.
  kind cancellation_reason_kind not null default 'other',
  -- Un motivo ya usado no se borra: se desactiva y deja de ofrecerse.
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table cancellation_reasons is
  'Catálogo de motivos públicos de suspensión/baja. Tabla de plataforma (sin tenant_id): solo superadmins la leen y la escriben (vía RPC).';

insert into cancellation_reasons (label, kind) values
  ('Falta de pago', 'non_payment'),
  ('Cancelación solicitada por el cliente', 'customer_request'),
  ('Incumplimiento de los términos del servicio', 'other'),
  ('Suspensión administrativa', 'other');

create trigger set_updated_at
  before update on cancellation_reasons
  for each row execute function app.set_updated_at();

create trigger cancellation_reasons_audit
  after insert or update or delete on cancellation_reasons
  for each row execute function app.log_platform_change();

alter table cancellation_reasons enable row level security;
alter table cancellation_reasons force row level security;

create policy cancellation_reasons_select on cancellation_reasons for select
  to authenticated
  using (app.is_platform_admin());

-- Sin políticas de escritura: solo las RPC de abajo.

-- =============================================================================
-- Columnas nuevas en tenant_platform_info
-- =============================================================================
alter table tenant_platform_info
  add column public_reason_id uuid references cancellation_reasons(id),
  add column public_reason text;

comment on column tenant_platform_info.public_reason is
  'Motivo que VE el negocio (copia del texto del catálogo al momento de suspender/dar de baja). status_reason, en cambio, son comentarios internos.';

-- =============================================================================
-- RPC del catálogo
-- =============================================================================
create function platform_create_reason(p_label text)
returns cancellation_reasons
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row cancellation_reasons;
  v_label text := btrim(coalesce(p_label, ''));
begin
  if not app.is_platform_admin() then
    raise exception 'No tienes permiso para administrar la plataforma.' using errcode = 'insufficient_privilege';
  end if;
  if v_label = '' then
    raise exception 'Escribe el texto del motivo.' using errcode = 'check_violation';
  end if;

  insert into cancellation_reasons (label) values (v_label) returning * into v_row;
  return v_row;
end;
$$;

-- Cambiar el texto o activar/desactivar. El `kind` no se toca: las
-- automatizaciones dependen de él.
create function platform_update_reason(p_id uuid, p_label text, p_is_active boolean)
returns cancellation_reasons
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row cancellation_reasons;
  v_label text := btrim(coalesce(p_label, ''));
begin
  if not app.is_platform_admin() then
    raise exception 'No tienes permiso para administrar la plataforma.' using errcode = 'insufficient_privilege';
  end if;
  if v_label = '' then
    raise exception 'Escribe el texto del motivo.' using errcode = 'check_violation';
  end if;

  update cancellation_reasons
  set label = v_label, is_active = p_is_active
  where id = p_id and deleted_at is null
  returning * into v_row;

  if not found then
    raise exception 'El motivo no existe.' using errcode = 'no_data_found';
  end if;
  return v_row;
end;
$$;

-- =============================================================================
-- platform_set_tenant_status: ahora con motivo público del catálogo
-- =============================================================================
-- Cambia la lista de parámetros, así que `create or replace` crearía una
-- sobrecarga: se elimina la versión anterior a propósito.
drop function platform_set_tenant_status(uuid, tenant_status, text);

create function platform_set_tenant_status(
  p_tenant_id uuid,
  p_status tenant_status,
  p_public_reason_id uuid,
  p_comment text
)
returns tenant_platform_info
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_info tenant_platform_info;
  v_reason cancellation_reasons;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if not app.is_platform_admin() then
    raise exception 'No tienes permiso para administrar la plataforma.' using errcode = 'insufficient_privilege';
  end if;

  if p_status in ('suspended', 'closed') then
    select * into v_reason
    from cancellation_reasons
    where id = p_public_reason_id and is_active and deleted_at is null;
    if not found then
      raise exception 'Elige el motivo.' using errcode = 'check_violation';
    end if;
  end if;

  update tenant_platform_info
  set status = p_status,
      public_reason_id = case when p_status = 'active' then null else v_reason.id end,
      public_reason = case when p_status = 'active' then null else v_reason.label end,
      status_reason = case when p_status = 'active' then null else v_comment end
  where tenant_id = p_tenant_id
  returning * into v_info;

  if not found then
    raise exception 'La empresa no existe.' using errcode = 'no_data_found';
  end if;

  return v_info;
end;
$$;

-- =============================================================================
-- platform_list_tenants: agrega el motivo público
-- =============================================================================
drop function platform_list_tenants();

create function platform_list_tenants()
returns table (
  tenant_id uuid,
  name text,
  created_at timestamptz,
  plan text,
  plan_expires_at timestamptz,
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
    i.plan,
    i.plan_expires_at,
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

-- =============================================================================
-- Permisos de ejecución
-- =============================================================================
revoke execute on function platform_create_reason(text) from public, anon;
revoke execute on function platform_update_reason(uuid, text, boolean) from public, anon;
revoke execute on function platform_set_tenant_status(uuid, tenant_status, uuid, text) from public, anon;
revoke execute on function platform_list_tenants() from public, anon;

grant execute on function platform_create_reason(text) to authenticated;
grant execute on function platform_update_reason(uuid, text, boolean) to authenticated;
grant execute on function platform_set_tenant_status(uuid, tenant_status, uuid, text) to authenticated;
grant execute on function platform_list_tenants() to authenticated;
