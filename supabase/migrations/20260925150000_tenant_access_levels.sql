-- Tarea #1905: niveles de acceso de un negocio según su estado y vigencia.
--
--   full       todo normal.
--   grace      la vigencia venció hace menos de 2 días: todo normal + aviso.
--   read_only  suspendido, o vigencia vencida y ya pasó la gracia: se ve
--              TODO (nadie pierde acceso a su información) pero no se
--              puede crear ni modificar nada.
--   blocked    dado de baja ('closed'): no se ve nada.
--
-- Sin fila en tenant_platform_info (no debería pasar: un trigger la crea) se
-- trata como 'full', para no bloquear por error.
--
-- STABLE: se evalúa una vez por consulta. SECURITY DEFINER porque
-- tenant_platform_info solo la leen superadmins (RLS) y aquí se necesita un
-- veredicto, no los datos; devuelve solo un texto.
create function app.tenant_access_level(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(
    (
      select case
        when i.status = 'closed' then 'blocked'
        when i.status = 'suspended' then 'read_only'
        when i.plan_expires_at is null or i.plan_expires_at > now() then 'full'
        when i.plan_expires_at + interval '2 days' > now() then 'grace'
        else 'read_only'
      end
      from tenant_platform_info i
      where i.tenant_id = p_tenant_id and i.deleted_at is null
    ),
    'full'
  );
$$;

comment on function app.tenant_access_level(uuid) is
  'full | grace | read_only | blocked, según estado y vigencia del negocio. Gracia = 2 días tras vencer.';

revoke execute on function app.tenant_access_level(uuid) from public, anon;
grant execute on function app.tenant_access_level(uuid) to authenticated, service_role;

-- true solo si el negocio está dado de baja: LEER también se niega.
create function app.is_tenant_blocked(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select app.tenant_access_level(p_tenant_id) = 'blocked';
$$;

revoke execute on function app.is_tenant_blocked(uuid) from public, anon;
grant execute on function app.is_tenant_blocked(uuid) to authenticated, service_role;

-- Las tres funciones auxiliares de RLS se reescriben idénticas a la migración
-- de contraseña temporal, con una condición más. Como toda política de lectura
-- pasa por is_member_of(), un negocio dado de baja desaparece de todas las
-- tablas a la vez. Suspendido y vencido SÍ se leen (solo lectura).
create or replace function app.is_member_of(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = p_tenant_id
      and m.is_active
      and m.deleted_at is null
  )
  and not app.has_pending_password_change()
  and not app.is_tenant_blocked(p_tenant_id);
$$;

create or replace function app.role_in(p_tenant_id uuid)
returns member_role
language sql
stable
security definer
set search_path = public, extensions
as $$
  select m.role
  from memberships m
  where m.user_id = auth.uid()
    and m.tenant_id = p_tenant_id
    and m.is_active
    and m.deleted_at is null
    and not app.has_pending_password_change()
    and not app.is_tenant_blocked(p_tenant_id)
  limit 1;
$$;

create or replace function app.can_access_branch(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from branches b
    join memberships m
      on m.tenant_id = b.tenant_id
     and m.user_id = auth.uid()
     and m.is_active
     and m.deleted_at is null
    where b.id = p_branch_id
      and (
        m.role = 'owner'
        or exists (
          select 1
          from membership_branches mb
          where mb.membership_id = m.id
            and mb.branch_id = b.id
            and mb.deleted_at is null
        )
      )
      and not app.is_tenant_blocked(b.tenant_id)
  )
  and not app.has_pending_password_change();
$$;

-- =============================================================================
-- Solo lectura: un trigger genérico en las tablas de negocio
-- =============================================================================
-- Un TRIGGER es una función que Postgres ejecuta solo, antes o después de
-- escribir una fila. Éste corre ANTES de cada INSERT/UPDATE y, si el negocio
-- dueño de la fila está en solo lectura o dado de baja, lanza un error y la
-- escritura no ocurre. Se eligió trigger y no reescribir decenas de políticas
-- RLS: es una sola regla, en un solo lugar, y el test de abajo (y
-- tenant-blocking.spec.ts) garantiza que ninguna tabla se quede sin ella.
--
-- Solo aplica a peticiones de una PERSONA (auth.uid() no nulo): los scripts,
-- la semilla y las Edge Functions con service_role no tienen auth.uid() y
-- siguen pudiendo escribir (p. ej. registrar un acceso a la vista pública).
create function app.enforce_tenant_writable()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant uuid;
begin
  if auth.uid() is null then
    return new;
  end if;

  -- `tenants` es la única tabla de negocio cuyo id ES el tenant.
  v_tenant := case
    when tg_table_name = 'tenants' then new.id
    else (to_jsonb(new) ->> 'tenant_id')::uuid
  end;

  if app.tenant_access_level(v_tenant) in ('read_only', 'blocked') then
    raise exception 'Tu negocio está en modo solo lectura. Regulariza tu cuenta para hacer cambios.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

comment on function app.enforce_tenant_writable() is
  'Trigger BEFORE INSERT/UPDATE: rechaza escrituras de personas en negocios en solo lectura o dados de baja.';

revoke execute on function app.enforce_tenant_writable() from public, anon;

-- Se engancha a `tenants` y a toda tabla de public con columna tenant_id,
-- salvo las de bitácora (se escriben como efecto de otro cambio) y la de
-- plataforma (la escribe el superadmin por RPC, no el negocio).
do $$
declare
  r record;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'tenant_id'
      and t.table_type = 'BASE TABLE'
      and c.table_name not in ('audit_log', 'platform_audit_log', 'tenant_platform_info')
    union
    select 'tenants'
  loop
    execute format(
      'create trigger enforce_tenant_writable before insert or update on %I
         for each row execute function app.enforce_tenant_writable()',
      r.table_name
    );
  end loop;
end $$;
