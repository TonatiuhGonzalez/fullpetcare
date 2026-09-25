-- Tabla role_permissions (CLAUDE.md §6.7, fase 9): qué puede VER y EDITAR
-- cada rol, módulo por módulo, POR NEGOCIO. Hasta ahora todo permiso de
-- este proyecto era un rol fijo comparado en código (`app.role_in(tenant_id)
-- in ('owner', 'receptionist')`, repetido en varias políticas y en
-- lib/roles.ts) — funciona, pero cambiarlo significa editar SQL y
-- desplegar una migración. Esta tabla existe para que, a futuro, un cambio
-- de "quién puede ver la pestaña de empleados" sea una fila distinta en la
-- base, no código distinto. La primera pantalla que la usa es la de
-- empleados (tarea 9.2): "solo el dueño la ve" hoy es una CONSECUENCIA de
-- cómo se siembra esta tabla (seed.sql), no una regla escrita en la
-- política ni en el frontend.
--
-- =============================================================================
-- "module" como enum, no como texto libre
-- =============================================================================
-- Mismo criterio que sale_items.item_type (CLAUDE.md §6.5): un enum con un
-- solo valor hoy ('employees'), pensado para crecer con
-- `alter type permission_module add value '...'` cuando exista un segundo
-- módulo con permisos configurables — aditivo, sin migración destructiva.
-- Un texto libre permitiría escribir 'employes' por error sin que la base
-- se queje; un enum no.
create type permission_module as enum ('employees');

create table role_permissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  role member_role not null,
  module permission_module not null,
  can_view boolean not null default false,
  can_edit boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Como máximo una regla por (negocio, rol, módulo) — dos filas para el
  -- mismo trío serían contradictorias y no hay forma de saber cuál manda.
  unique (tenant_id, role, module)
);

create index role_permissions_tenant_id_idx on role_permissions (tenant_id);

create trigger role_permissions_set_updated_at
  before update on role_permissions
  for each row execute function app.set_updated_at();

create trigger role_permissions_audit
  after insert or update or delete on role_permissions
  for each row execute function app.log_change();

comment on table role_permissions is
  'Qué puede ver/editar cada rol en cada módulo, por negocio. Sin fila para un (tenant, role, module) = sin permiso, salvo owner (siempre puede todo, ver app.has_permission).';

alter table role_permissions enable row level security;
alter table role_permissions force row level security;

-- Cualquier colega del negocio puede LEER las reglas — igual que ya pasa
-- con memberships_select (ves a tus compañeros, no solo tu propia fila):
-- no hay nada sensible en "qué puede hacer cada rol" y la UI necesita
-- poder mostrarlo si algún día hay pantalla de administración.
--
-- Sin política de INSERT/UPDATE/DELETE a propósito, mismo precedente que
-- las tablas de tenencia de la fase 1 (rls_tenancy.sql, tarea 1.16): esta
-- fase no construye una pantalla para EDITAR permisos, solo para
-- CONSULTARLOS al decidir si se muestra la pestaña de empleados. Por eso
-- hoy se siembra a mano (seed.sql) y se edita, si hace falta, desde
-- Studio. El día que exista esa pantalla, esa tarea trae su propia
-- política de INSERT/UPDATE y su propio test — mismo patrón exacto que
-- esta fase le está pagando a memberships/membership_branches (migración
-- employee_access_rls.sql).
create policy role_permissions_select on role_permissions for select
  to authenticated
  using (app.is_member_of(tenant_id));

-- =============================================================================
-- app.has_permission(): la autoridad real detrás de "¿puede este rol
-- ver/editar este módulo?"
-- =============================================================================
-- Mismo molde que app.is_member_of() / app.role_in() (rls_helpers.sql):
-- SQL puro, STABLE (Postgres la evalúa una vez por consulta) y SECURITY
-- DEFINER (necesita leer role_permissions con los permisos de quien creó
-- la función, no del que consulta — igual razón que las otras: si un día
-- role_permissions tuviera una política que llamara a esta función,
-- evaluar con el rol del usuario normal podría encadenar en recursión).
--
-- "owner" siempre regresa true SIN mirar la tabla: CLAUDE.md §6.1 ya dice
-- que el dueño "Puede: Todo", y así una fila faltante o mal sembrada para
-- 'owner' nunca deja al propio dueño fuera de su negocio. Para los demás
-- roles, se busca la fila (tenant_id, ese rol, ese módulo) y se mira la
-- columna que corresponde a la acción pedida.
create function app.has_permission(p_tenant_id uuid, p_module permission_module, p_action text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    app.role_in(p_tenant_id) = 'owner'
    or exists (
      select 1
      from role_permissions rp
      where rp.tenant_id = p_tenant_id
        and rp.role = app.role_in(p_tenant_id)
        and rp.module = p_module
        and (
          (p_action = 'view' and rp.can_view)
          or (p_action = 'edit' and rp.can_edit)
        )
    );
$$;

comment on function app.has_permission(uuid, permission_module, text) is
  'true si el rol del usuario autenticado en este tenant puede "view" o "edit" este módulo. owner siempre true; los demás roles según role_permissions.';

grant execute on function app.has_permission(uuid, permission_module, text) to anon, authenticated, service_role;
