-- Activa Row Level Security en las cinco tablas de tenencia y define sus
-- políticas de lectura. Ver CLAUDE.md §7.1–§7.3.
--
-- =============================================================================
-- Qué es una política, en concreto
-- =============================================================================
--
-- `alter table X enable row level security` por sí solo NO abre ni cierra
-- nada — vuelve la tabla invisible para todo el mundo excepto el dueño de
-- la tabla. Una política es la regla que reabre el acceso, condicionado.
-- Cuando alguien hace `select * from branches`, Postgres reescribe la
-- consulta por debajo como si fuera
-- `select * from branches where <condición de la política>`,
-- sin que el código que hizo la consulta lo sepa ni pueda evitarlo.
-- Con varias políticas de SELECT sobre la misma tabla, basta con que UNA
-- se cumpla (se combinan con OR); con políticas de distintos comandos
-- (SELECT, INSERT, UPDATE) cada una aplica solo a su comando.
--
-- =============================================================================
-- Por qué estas cinco tablas son de solo lectura por ahora
-- =============================================================================
--
-- El alcance de v1 (CLAUDE.md §1) no incluye una pantalla para que el
-- dueño cree sucursales o invite empleados — eso se siembra directo en la
-- base (seed.sql) como lo haría un administrador. Por eso estas tablas
-- solo tienen política de SELECT: nadie autenticado por la app puede
-- escribir en ellas, solo leerlas si pertenece al tenant. La escritura
-- queda reservada a migraciones y semillas (que corren con más
-- privilegios). Si más adelante se agrega una pantalla de administración,
-- esa tarea trae su propia política de INSERT/UPDATE y su propio test —
-- no se adelanta aquí sin una pantalla real que la use.
--
-- =============================================================================
-- Regla dura: ninguna política de DELETE
-- =============================================================================
--
-- Sin política de DELETE, Postgres rechaza cualquier intento de borrado
-- directo — el borrado suave se hace con
-- `update ... set deleted_at = now()`, que sí está permitido porque es un
-- UPDATE. Esto es intencional en las cinco tablas.

-- =============================================================================
-- tenants
-- =============================================================================
alter table tenants enable row level security;
alter table tenants force row level security; -- aplica incluso a quien creó la tabla

create policy tenants_select on tenants for select
  to authenticated
  using (app.is_member_of(id) and deleted_at is null);

-- =============================================================================
-- branches
-- =============================================================================
alter table branches enable row level security;
alter table branches force row level security;

create policy branches_select on branches for select
  to authenticated
  using (app.is_member_of(tenant_id) and deleted_at is null);

-- =============================================================================
-- profiles
-- =============================================================================
alter table profiles enable row level security;
alter table profiles force row level security;

-- Un caso interesante de COMPOSICIÓN de políticas: para saber "¿profiles.id
-- comparte un tenant conmigo?", esta política consulta la tabla
-- "memberships" — que tiene SU PROPIA política de RLS (la de abajo). Esa
-- política ya filtra "memberships" a solo las filas de tenants donde YO
-- (el usuario que está consultando) tengo membresía activa. Entonces,
-- cuando esta subconsulta pregunta "¿existe una membresía de profiles.id?",
-- Postgres solo puede encontrar esa fila si además es un tenant donde yo
-- también pertenezco — exactamente la regla que se necesita ("puedo ver
-- el nombre de un colega si compartimos tenant"), sin repetir la lógica de
-- membresía en una función aparte. Las políticas se combinan solas.
create policy profiles_select on profiles for select
  to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from memberships m
      where m.user_id = profiles.id
        and m.is_active
        and m.deleted_at is null
    )
  );

-- =============================================================================
-- memberships
-- =============================================================================
alter table memberships enable row level security;
alter table memberships force row level security;

create policy memberships_select on memberships for select
  to authenticated
  using (app.is_member_of(tenant_id) and deleted_at is null);

-- =============================================================================
-- membership_branches
-- =============================================================================
alter table membership_branches enable row level security;
alter table membership_branches force row level security;

create policy membership_branches_select on membership_branches for select
  to authenticated
  using (app.is_member_of(tenant_id) and deleted_at is null);
