-- RPCs de plataforma (fase 10, tarea 10.3): todo lo que el panel de
-- superadmin lee y escribe sobre los negocios. Cinco funciones:
--
--   platform_list_tenants()          lista de negocios con dueño, plan y estado
--   platform_tenant_metrics(tenant)  conteos de uso de UN negocio (solo números)
--   platform_set_tenant_status(...)  suspender / dar de baja / reactivar
--   platform_update_notes(...)       notas internas
--   platform_create_tenant(...)      alta: negocio + sucursal + dueño
--
-- =============================================================================
-- Por qué RPCs y no leer/escribir las tablas directo desde el frontend
-- =============================================================================
-- 1. Las tablas de plataforma no tienen política de escritura a propósito
--    (platform_admins.sql, tenant_platform_info.sql): la única puerta son
--    estas funciones, que revalidan quién llama.
-- 2. El panel necesita datos que ninguna tabla tiene completos: el correo
--    del dueño vive en auth.users, que el frontend NUNCA puede leer, y el
--    nombre en profiles, cuyo SELECT solo abre a colegas del mismo
--    negocio. Un superadmin no es colega de nadie, así que solo una
--    función SECURITY DEFINER puede juntar esas piezas.
-- 3. Las métricas son CONTEOS. Que la función devuelva solo números (y no
--    filas de customers, pets...) es lo que hace cumplir la decisión de
--    que el superadmin ve datos de la empresa, nunca datos de negocio: no
--    hay ningún camino, ni por error, a un nombre de cliente o un
--    expediente.
--
-- =============================================================================
-- La regla dura de esta migración (CLAUDE.md §7.3.4)
-- =============================================================================
-- SECURITY DEFINER salta RLS. Cada función empieza con la MISMA primera
-- línea: `if not app.is_platform_admin() then raise ...`. Sin ella, estas
-- funciones serían una puerta abierta a cualquier usuario autenticado — el
-- dueño de un negocio podría listar TODOS los demás negocios. Los tests
-- (10.4) prueban justo eso: que un dueño normal recibe el error en las
-- cinco.
--
-- `#variable_conflict use_column` (primera línea de los cuerpos que
-- devuelven tabla): en plpgsql, las columnas de `returns table(...)` son
-- variables, y si una se llama igual que una columna de una tabla
-- consultada (`plan`, `status`), Postgres se queja de ambigüedad.
-- Esta directiva le dice "si hay duda, es la columna".

-- =============================================================================
-- platform_list_tenants()
-- =============================================================================
-- Un solo dueño por negocio (decisión de la fase): el "dueño" es la
-- membresía activa con role = 'owner'; si un día hubiera dos, se toma la
-- más antigua. LEFT JOIN a propósito: un negocio sin dueño (dato
-- corrupto, o alta a medias) debe VERSE en la lista con el dueño vacío, no
-- desaparecer de ella.
create function platform_list_tenants()
returns table (
  tenant_id uuid,
  name text,
  created_at timestamptz,
  plan text,
  plan_expires_at timestamptz,
  status tenant_status,
  status_reason text,
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
    t.created_at, -- "fecha de alta de la empresa" (decisión de la fase 10)
    i.plan,
    i.plan_expires_at,
    i.status,
    i.status_reason,
    i.internal_notes,
    o.user_id,
    p.full_name,
    u.email::text, -- auth.users.email es varchar; se unifica a text
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
  'Superadmin: lista de negocios con plan, estado, notas y datos del dueño (nombre, correo, teléfono). Revalida is_platform_admin().';

-- =============================================================================
-- platform_tenant_metrics(tenant)
-- =============================================================================
-- Definiciones (para que nadie las adivine después):
--   - branches_count / customers_count / pets_count: filas sin borrado suave.
--   - active_employees_count: membresías activas, INCLUYENDO al dueño.
--   - appointments_this_month_count: citas (cualquier estado, sin borrado
--     suave) cuyo inicio cae en el mes en curso EN LA ZONA HORARIA DEL
--     NEGOCIO, no en UTC (CLAUDE.md §8.3): una cita del día 1 a las 00:30
--     hora de Tijuana ya es día 1 aunque en UTC sea día 1 a las 07:30, y
--     una del último día a las 23:00 no debe contarse en el mes siguiente.
--   - last_access_at: el último inicio de sesión (auth.users.last_sign_in_at)
--     de cualquier miembro activo del negocio. NULL si nadie ha entrado.
create function platform_tenant_metrics(p_tenant_id uuid)
returns table (
  branches_count bigint,
  active_employees_count bigint,
  customers_count bigint,
  pets_count bigint,
  appointments_this_month_count bigint,
  last_access_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_timezone text;
  v_month_start timestamptz;
begin
  if not app.is_platform_admin() then
    raise exception 'No tienes permiso para administrar la plataforma.' using errcode = 'insufficient_privilege';
  end if;

  select t.timezone into v_timezone
  from tenants t
  where t.id = p_tenant_id and t.deleted_at is null;

  if not found then
    raise exception 'La empresa no existe.' using errcode = 'no_data_found';
  end if;

  -- "now() at time zone tz" da la hora de pared local (sin zona); se
  -- recorta al inicio del mes y "at time zone tz" la vuelve a convertir en
  -- un instante real (timestamptz) para comparar contra starts_at.
  v_month_start := date_trunc('month', now() at time zone v_timezone) at time zone v_timezone;

  return query
  select
    (select count(*) from branches b where b.tenant_id = p_tenant_id and b.deleted_at is null),
    (select count(*) from memberships m where m.tenant_id = p_tenant_id and m.is_active and m.deleted_at is null),
    (select count(*) from customers c where c.tenant_id = p_tenant_id and c.deleted_at is null),
    (select count(*) from pets pt where pt.tenant_id = p_tenant_id and pt.deleted_at is null),
    (select count(*) from appointments a
       where a.tenant_id = p_tenant_id and a.deleted_at is null and a.starts_at >= v_month_start),
    (select max(u.last_sign_in_at)
       from memberships m
       join auth.users u on u.id = m.user_id
       where m.tenant_id = p_tenant_id and m.is_active and m.deleted_at is null);
end;
$$;

comment on function platform_tenant_metrics(uuid) is
  'Superadmin: SOLO conteos de uso de un negocio (sucursales, empleados activos, clientes, mascotas, citas del mes, último acceso). Nunca devuelve filas de negocio.';

-- =============================================================================
-- platform_set_tenant_status(tenant, status, reason)
-- =============================================================================
-- El estado es una ETIQUETA informativa: no bloquea el acceso de los
-- usuarios del negocio (decisión de la fase 10, ver tenant_platform_info).
-- Se permite cualquier transición (activo ↔ suspendido ↔ de baja): las
-- bajas son reversibles y no tienen fecha (decisión del usuario).
--
-- El motivo es obligatorio al suspender o dar de baja — es lo que hace
-- útil la bitácora ("¿por qué se suspendió?") — y se limpia al reactivar,
-- para que un negocio activo no arrastre un motivo viejo. El motivo
-- anterior no se pierde: queda en platform_audit_log (old_data).
create function platform_set_tenant_status(
  p_tenant_id uuid,
  p_status tenant_status,
  p_reason text
)
returns tenant_platform_info
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_info tenant_platform_info;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not app.is_platform_admin() then
    raise exception 'No tienes permiso para administrar la plataforma.' using errcode = 'insufficient_privilege';
  end if;

  if p_status in ('suspended', 'closed') and v_reason is null then
    raise exception 'Indica el motivo.' using errcode = 'check_violation';
  end if;

  update tenant_platform_info
  set status = p_status,
      status_reason = case when p_status = 'active' then null else v_reason end
  where tenant_id = p_tenant_id
  returning * into v_info;

  if not found then
    raise exception 'La empresa no existe.' using errcode = 'no_data_found';
  end if;

  return v_info;
end;
$$;

comment on function platform_set_tenant_status(uuid, tenant_status, text) is
  'Superadmin: cambia el estado (active/suspended/closed) de un negocio. Motivo obligatorio salvo al reactivar. Solo etiqueta: no bloquea el acceso.';

-- =============================================================================
-- platform_update_notes(tenant, notes)
-- =============================================================================
create function platform_update_notes(p_tenant_id uuid, p_notes text)
returns tenant_platform_info
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_info tenant_platform_info;
begin
  if not app.is_platform_admin() then
    raise exception 'No tienes permiso para administrar la plataforma.' using errcode = 'insufficient_privilege';
  end if;

  -- Texto en blanco se guarda como NULL: "sin notas" tiene una sola forma.
  update tenant_platform_info
  set internal_notes = nullif(btrim(coalesce(p_notes, '')), '')
  where tenant_id = p_tenant_id
  returning * into v_info;

  if not found then
    raise exception 'La empresa no existe.' using errcode = 'no_data_found';
  end if;

  return v_info;
end;
$$;

comment on function platform_update_notes(uuid, text) is
  'Superadmin: guarda las notas internas de un negocio (texto en blanco = sin notas).';

-- =============================================================================
-- platform_create_tenant(...)
-- =============================================================================
-- Todo o nada: si cualquier paso falla (nombre en blanco, sucursal
-- inválida...) la transacción entera se revierte y no queda un negocio sin
-- sucursal o sin dueño. Mismo motivo que create_employee_membership y
-- checkout_appointment.
--
-- Este RPC NO crea el usuario en auth.users — eso exige la llave
-- service_role y vive en la Edge Function `platform-admin` (tarea 10.5),
-- que genera la contraseña temporal y devuelve el user_id. Flujo:
--   1) el frontend llama la Edge Function → crea al dueño en Auth, devuelve user_id;
--   2) el frontend, con la sesión del superadmin, llama este RPC con ese user_id.
-- Si este paso 2 falla, quedaría un usuario huérfano en Auth: la Edge
-- Function / el service se encargan de limpiarlo (10.5, 10.7).
--
-- Qué se crea: el negocio (zona horaria México Centro, el default de la
-- tabla), UNA sucursal con el nombre capturado (misma zona), y la
-- membresía 'owner' del usuario. El dueño no necesita filas en
-- membership_branches: ve todas las sucursales (CLAUDE.md §6.1). El
-- catálogo de servicios queda vacío (decisión de la fase 10). La fila de
-- tenant_platform_info la crea sola el trigger de tenants.
--
-- El nombre y teléfono del dueño se guardan en su `profiles`, que ya
-- existe (lo creó el trigger de auth.users) — aquí solo se ajustan a lo
-- capturado en el formulario de alta. El correo ya quedó en auth.users.
create function platform_create_tenant(
  p_user_id uuid,
  p_tenant_name text,
  p_branch_name text,
  p_owner_full_name text,
  p_owner_phone text
)
returns tenants
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant tenants;
  v_tenant_name text := btrim(coalesce(p_tenant_name, ''));
  v_branch_name text := btrim(coalesce(p_branch_name, ''));
  v_owner_name text := btrim(coalesce(p_owner_full_name, ''));
begin
  if not app.is_platform_admin() then
    raise exception 'No tienes permiso para administrar la plataforma.' using errcode = 'insufficient_privilege';
  end if;

  if v_tenant_name = '' then
    raise exception 'Indica el nombre de la empresa.' using errcode = 'check_violation';
  end if;
  if v_branch_name = '' then
    raise exception 'Indica el nombre de la sucursal.' using errcode = 'check_violation';
  end if;
  if v_owner_name = '' then
    raise exception 'Indica el nombre del dueño.' using errcode = 'check_violation';
  end if;

  if not exists (select 1 from profiles p where p.id = p_user_id) then
    raise exception 'El usuario del dueño no existe.' using errcode = 'foreign_key_violation';
  end if;

  insert into tenants (name)
  values (v_tenant_name)
  returning * into v_tenant;

  insert into branches (tenant_id, name)
  values (v_tenant.id, v_branch_name);

  insert into memberships (tenant_id, user_id, role, is_active)
  values (v_tenant.id, p_user_id, 'owner', true);

  update profiles
  set full_name = v_owner_name,
      phone = nullif(btrim(coalesce(p_owner_phone, '')), '')
  where id = p_user_id;

  return v_tenant;
end;
$$;

comment on function platform_create_tenant(uuid, text, text, text, text) is
  'Superadmin: alta de un negocio (tenant + una sucursal + membresía owner) en una sola transacción. El usuario de auth.users debe existir ya (lo crea la Edge Function platform-admin).';

-- =============================================================================
-- Permisos de ejecución
-- =============================================================================
-- Postgres da EXECUTE a PUBLIC (incluye `anon`) en funciones nuevas. Se
-- quita y se da solo a `authenticated`; el chequeo real de "¿es
-- superadmin?" sigue siendo la primera línea de cada función.
revoke execute on function platform_list_tenants() from public, anon;
revoke execute on function platform_tenant_metrics(uuid) from public, anon;
revoke execute on function platform_set_tenant_status(uuid, tenant_status, text) from public, anon;
revoke execute on function platform_update_notes(uuid, text) from public, anon;
revoke execute on function platform_create_tenant(uuid, text, text, text, text) from public, anon;

grant execute on function platform_list_tenants() to authenticated;
grant execute on function platform_tenant_metrics(uuid) to authenticated;
grant execute on function platform_set_tenant_status(uuid, tenant_status, text) to authenticated;
grant execute on function platform_update_notes(uuid, text) to authenticated;
grant execute on function platform_create_tenant(uuid, text, text, text, text) to authenticated;
