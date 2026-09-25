-- Tarea #1905: suspensión automática por vencimiento, y cancelación por el dueño.

-- =============================================================================
-- 1. Suspensión automática por falta de pago
-- =============================================================================
-- El nivel de acceso ya se calcula al vuelo (tenant_access_level): pasada la
-- gracia el negocio queda en solo lectura aunque nadie haga nada. Esta tarea
-- diaria además deja el ESTADO escrito ('suspended' + motivo público "Falta de
-- pago") para que el superadmin lo vea en su lista y quede en la bitácora.
--
-- No es SECURITY DEFINER a lo loco: no recibe argumentos y solo la puede
-- ejecutar postgres/service_role (pg_cron corre como postgres). Sin auth.uid(),
-- la bitácora la registra con actor nulo = "el sistema".
create function app.suspend_expired_tenants()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reason cancellation_reasons;
  v_count integer;
begin
  select * into v_reason
  from cancellation_reasons
  where kind = 'non_payment' and is_active and deleted_at is null
  order by created_at
  limit 1;

  update tenant_platform_info
  set status = 'suspended',
      public_reason_id = v_reason.id,
      -- Si el superadmin desactivó el motivo, la automatización no se detiene.
      public_reason = coalesce(v_reason.label, 'Falta de pago'),
      status_reason = 'Suspensión automática: la vigencia venció y terminó el periodo de gracia.'
  where status = 'active'
    and deleted_at is null
    and plan_expires_at is not null
    and plan_expires_at + interval '2 days' <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function app.suspend_expired_tenants() is
  'Tarea diaria (pg_cron): suspende negocios con la vigencia vencida y la gracia terminada. Devuelve cuántos.';

revoke execute on function app.suspend_expired_tenants() from public, anon, authenticated;
grant execute on function app.suspend_expired_tenants() to service_role;

-- pg_cron es la extensión de Postgres que ejecuta SQL con horario (como cron
-- de Linux, pero dentro de la base).
create extension if not exists pg_cron;

-- Todos los días a las 06:00 UTC (00:00 en Ciudad de México). Se desprograma
-- primero por si la migración se repite en un entorno ya configurado.
select cron.unschedule(jobid) from cron.job where jobname = 'suspend-expired-tenants';
select cron.schedule('suspend-expired-tenants', '0 6 * * *', $$select app.suspend_expired_tenants()$$);

-- =============================================================================
-- 2. El dueño cancela su propia cuenta
-- =============================================================================
-- SECURITY DEFINER porque tenant_platform_info no tiene política de escritura
-- para nadie. Revalida adentro: solo el dueño ACTIVO del negocio, sin
-- contraseña temporal pendiente, y solo si no está ya dado de baja.
create function public.cancel_my_tenant(p_tenant_id uuid, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reason cancellation_reasons;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if auth.uid() is null or app.has_pending_password_change() then
    raise exception 'No tienes permiso para cancelar este negocio.' using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = p_tenant_id
      and m.role = 'owner'
      and m.is_active
      and m.deleted_at is null
  ) then
    raise exception 'No tienes permiso para cancelar este negocio.' using errcode = 'insufficient_privilege';
  end if;

  if app.tenant_access_level(p_tenant_id) = 'blocked' then
    raise exception 'Este negocio ya está dado de baja.' using errcode = 'check_violation';
  end if;

  select * into v_reason
  from cancellation_reasons
  where kind = 'customer_request' and deleted_at is null
  order by is_active desc, created_at
  limit 1;

  update tenant_platform_info
  set status = 'closed',
      public_reason_id = v_reason.id,
      public_reason = coalesce(v_reason.label, 'Cancelación solicitada por el cliente'),
      status_reason = 'Cancelada por el dueño desde su cuenta.'
                      || coalesce(' Comentario: ' || v_comment, '')
  where tenant_id = p_tenant_id and deleted_at is null;
end;
$$;

comment on function public.cancel_my_tenant(uuid, text) is
  'El dueño da de baja su propio negocio. Solo el superadmin puede reactivarlo.';

revoke execute on function public.cancel_my_tenant(uuid, text) from public, anon;
grant execute on function public.cancel_my_tenant(uuid, text) to authenticated;
