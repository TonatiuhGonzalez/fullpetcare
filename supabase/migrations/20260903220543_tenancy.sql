-- Tablas de tenencia e identidad: el negocio (tenant), sus sucursales, las
-- personas (profiles) y quién pertenece a qué negocio con qué rol
-- (memberships). Ver CLAUDE.md §6.1.
--
-- Todavía NO se activa RLS aquí — eso necesita las funciones auxiliares de
-- la siguiente migración (0003_rls_helpers.sql), que a su vez necesitan que
-- "memberships" ya exista. Activar RLS sin sus políticas dejaría estas
-- tablas invisibles para todos, así que se hace en un tercer paso
-- (0004_rls_tenancy.sql).

-- =============================================================================
-- tenants — el negocio (clínica, estética, o ambos)
-- =============================================================================
create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Campos CFDI del NEGOCIO (el emisor de los tickets/facturas). No se
  -- factura todavía, pero el esquema ya los tiene listos (CLAUDE.md §8.4).
  legal_name text,
  rfc text,
  tax_regime_code text, -- catálogo SAT c_RegimenFiscal, p. ej. '601'
  postal_code text,     -- domicilio fiscal
  default_cfdi_use text, -- catálogo SAT c_UsoCFDI, p. ej. 'G03'
  -- Zona horaria por default para sucursales nuevas de este tenant. Cada
  -- sucursal puede tener la suya propia (ver "branches" abajo) — esto es
  -- solo el valor inicial al dar de alta una sucursal.
  timezone text not null default 'America/Mexico_City',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger set_updated_at
  before update on tenants
  for each row execute function app.set_updated_at();

comment on table tenants is 'Un negocio de cuidado de mascotas. Es la raíz del aislamiento multi-tenant.';

-- =============================================================================
-- branches — sucursales de un tenant
-- =============================================================================
create table branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  address text,
  postal_code text,
  phone text,
  -- Nombre de zona horaria IANA, NO un offset fijo (CLAUDE.md §8.3: México
  -- ya no tiene horario de verano nacional, pero la franja fronteriza
  -- —Tijuana, Mexicali— sí lo sigue aplicando para alinearse con EE. UU.).
  timezone text not null default 'America/Mexico_City',
  -- Horario de apertura por día de la semana. Se define la forma exacta
  -- de este JSON cuando lib/availability.ts lo necesite (fase 3); por
  -- ahora solo se deja el campo listo para no migrar de nuevo entonces.
  opening_hours jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index branches_tenant_id_idx on branches (tenant_id);

create trigger set_updated_at
  before update on branches
  for each row execute function app.set_updated_at();

comment on table branches is 'Una sucursal física de un tenant. Un tenant tiene una o más.';

-- =============================================================================
-- profiles — identidad de una persona (dueño, recepción, groomer, vet)
-- =============================================================================
-- Sin tenant_id a propósito (excepción documentada en CLAUDE.md §6): la
-- misma persona podría trabajar en dos negocios distintos con dos
-- membresías. "profiles" es la identidad; "memberships" es la relación con
-- cada negocio.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger set_updated_at
  before update on profiles
  for each row execute function app.set_updated_at();

comment on table profiles is
  'Identidad de una persona autenticada. id = auth.users.id. Sin tenant_id: una persona puede pertenecer a varios tenants.';

-- =============================================================================
-- memberships — a qué tenant pertenece una persona, con qué rol
-- =============================================================================
create type member_role as enum ('owner', 'receptionist', 'groomer', 'vet');

create table memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references profiles(id),
  role member_role not null,
  -- Desactivar una membresía (en vez de borrarla) revoca el acceso al
  -- instante para las políticas RLS, que filtran por is_active — y deja
  -- el historial de quién trabajó ahí. Ver CLAUDE.md §7.2.
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- Una persona tiene como máximo una membresía (un rol) por tenant.
  unique (tenant_id, user_id)
);

-- Dos índices porque hay dos formas de consultar esta tabla:
-- "¿quién pertenece a ESTE tenant?" (lo usan las políticas RLS de otras
-- tablas, vía app.is_member_of) y "¿a qué tenants pertenece ESTE usuario?"
-- (lo usa la pantalla de selección de negocio, para un usuario que
-- trabaja en más de un tenant).
create index memberships_tenant_id_idx on memberships (tenant_id);
create index memberships_user_id_idx on memberships (user_id);

create trigger set_updated_at
  before update on memberships
  for each row execute function app.set_updated_at();

comment on table memberships is
  'Relación persona↔tenant↔rol. Fuente de verdad de los permisos (CLAUDE.md §7.2).';

-- =============================================================================
-- membership_branches — a qué sucursales entra una membresía
-- =============================================================================
-- Sin filas aquí para una membresía "owner": el rol owner ve todas las
-- sucursales del tenant sin necesidad de listarlas (CLAUDE.md §6.1).
create table membership_branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id), -- denormalizado a propósito: permite filtrar RLS sin JOIN extra
  membership_id uuid not null references memberships(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (membership_id, branch_id)
);

create index membership_branches_tenant_id_idx on membership_branches (tenant_id);
create index membership_branches_membership_id_idx on membership_branches (membership_id);
create index membership_branches_branch_id_idx on membership_branches (branch_id);

create trigger set_updated_at
  before update on membership_branches
  for each row execute function app.set_updated_at();

comment on table membership_branches is
  'A qué sucursales tiene acceso una membresía que no es "owner".';
