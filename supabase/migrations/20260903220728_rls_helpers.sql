-- Funciones auxiliares que van a usar las políticas RLS de TODAS las
-- tablas de negocio, desde esta fase hasta la última. Ver CLAUDE.md §7.2.
--
-- =============================================================================
-- Por qué esto necesita explicación (para quien nunca escribió RLS)
-- =============================================================================
--
-- Una política RLS es una condición SQL que Postgres agrega automáticamente
-- a cada consulta sobre una tabla. Para escribir "el usuario debe
-- pertenecer al tenant de esta fila", la política necesita poder
-- preguntar "¿el usuario actual pertenece a este tenant?". Esa pregunta se
-- convierte en una función reutilizable — así no se repite la misma
-- subconsulta en las políticas de 15 tablas distintas, y si el criterio
-- cambia algún día, se cambia en un solo lugar.
--
-- El problema es que "memberships" — la tabla que responde esa pregunta —
-- ELLA MISMA va a tener RLS activado en la siguiente migración. Si la
-- función consultara "memberships" como el usuario normal (con los
-- permisos de la sesión, que es el comportamiento por default), su propia
-- política de RLS se activaría al consultarla... y esa política llama a
-- esta misma función para decidir si dejar pasar la consulta. Es una
-- referencia circular: la función necesita leer memberships para poder
-- decidir si se puede leer memberships.
--
-- La solución es `SECURITY DEFINER`: la función corre con los permisos de
-- quien la CREÓ (el rol dueño de la base, que no tiene RLS activado en su
-- contra), no con los permisos de quien la está USANDO. Así puede leer
-- memberships sin activar su propia política, y responder la pregunta sin
-- entrar en bucle.
--
-- Esto es poderoso y por eso hay que ser disciplinados con dos reglas:
--
-- 1. `set search_path = public, extensions` fija en qué esquemas busca la
--    función los nombres sin calificar (tablas, otras funciones). Sin
--    esto, alguien con permiso de crear objetos podría crear una tabla o
--    función falsa en OTRO esquema que quede antes en el search_path del
--    usuario que llama, y la función SECURITY DEFINER — que corre con más
--    privilegios — terminaría usando esa versión falsa. Fijar el
--    search_path explícitamente cierra esa puerta.
-- 2. Cualquier función SECURITY DEFINER que en el futuro ESCRIBA datos
--    (no es el caso de las tres de aquí abajo, que solo leen) debe
--    revalidar permisos ella misma en su primera línea, porque
--    `SECURITY DEFINER` también salta la RLS de las tablas en las que
--    escribe. Ver el ejemplo de checkout_appointment() en PLAN.md §1.2.
--
-- `STABLE` es la otra pieza: le dice al planificador de consultas de
-- Postgres "esta función no cambia de resultado dos veces dentro de la
-- misma consulta, así que puedes ejecutarla una sola vez y reusar el
-- resultado" (en vez de re-evaluarla en cada fila candidata). Sin esto,
-- Postgres asume el peor caso (`VOLATILE`) y la ejecuta de más.

-- =============================================================================
-- app.is_member_of(tenant) — ¿el usuario actual pertenece a este tenant?
-- =============================================================================
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
  );
$$;

comment on function app.is_member_of(uuid) is
  'true si el usuario autenticado tiene una membresía activa en este tenant. Base de casi toda política RLS del proyecto.';

-- =============================================================================
-- app.role_in(tenant) — con qué rol pertenece el usuario actual a este tenant
-- =============================================================================
-- Devuelve NULL si no pertenece — así "app.role_in(x) in ('owner','vet')"
-- da NULL (no true) para alguien sin membresía, que es el comportamiento
-- correcto: ni se cuela ni hace falta un caso especial en cada política.
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
  limit 1; -- unique(tenant_id, user_id) ya garantiza como máximo una fila
$$;

comment on function app.role_in(uuid) is
  'Rol del usuario autenticado en este tenant, o NULL si no pertenece.';

-- =============================================================================
-- app.can_access_branch(branch) — ¿el usuario actual puede operar en esta sucursal?
-- =============================================================================
-- "owner" ve todas las sucursales de su tenant sin fila en
-- membership_branches (CLAUDE.md §6.1); el resto de los roles necesita
-- una fila explícita ahí.
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
  );
$$;

comment on function app.can_access_branch(uuid) is
  'true si el usuario autenticado puede operar en esta sucursal (owner del tenant, o tiene la sucursal asignada).';

grant execute on function app.is_member_of(uuid) to anon, authenticated, service_role;
grant execute on function app.role_in(uuid) to anon, authenticated, service_role;
grant execute on function app.can_access_branch(uuid) to anon, authenticated, service_role;
