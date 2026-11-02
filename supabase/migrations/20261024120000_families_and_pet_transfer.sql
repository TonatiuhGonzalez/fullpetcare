-- Fase 31 (PLAN.md D30, puntos 7 y 8): familias y transferencia de mascota.
--
-- =============================================================================
-- Qué se agrega
-- =============================================================================
--   families / family_members   Un grupo de clientes (un hogar). Tiene nombre propio
--                               ("Familia Pérez") y UN titular; los demás miembros son
--                               de acceso básico. Un cliente pertenece a UNA sola familia.
--   pet_ownerships              Historial de quién fue dueño de cada mascota y en qué
--                               periodo. Es lo que permite que el dueño anterior vea solo
--                               lo ocurrido mientras lo fue.
--   transfer_pet()              Pasa la mascota a otro cliente: sus citas programadas se
--                               van con ella, las ventas se quedan donde estaban y los links
--                               compartidos se revocan.
--   save_family() / delete_family()
--   app.customer_can_view_pet() y app.customer_can_view_pet_money()
--                               Las reglas de visibilidad por periodo. Las usará la cuenta
--                               del cliente (fase 16B); hoy no hay un cliente con sesión que
--                               las consulte, así que no están expuestas a la API.
--
-- Migración ADITIVA (§8.1): tablas nuevas y un índice único auxiliar sobre customers.

-- =============================================================================
-- families
-- =============================================================================
create table families (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger families_set_updated_at before update on families
  for each row execute function app.set_updated_at();
create trigger families_audit after insert or update or delete on families
  for each row execute function app.log_change();
create trigger enforce_tenant_writable before insert or update on families
  for each row execute function app.enforce_tenant_writable();

create index families_tenant_id_idx on families (tenant_id);
create unique index families_tenant_name_key
  on families (tenant_id, lower(btrim(name))) where deleted_at is null;
create unique index families_tenant_id_id_key on families (tenant_id, id);

-- Llave auxiliar para la llave foránea compuesta de family_members: la base garantiza que un
-- miembro sea un cliente del MISMO negocio que la familia. Es un índice, no cambia la tabla.
create unique index customers_tenant_id_id_key on customers (tenant_id, id);

-- =============================================================================
-- family_members
-- =============================================================================
create table family_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  family_id uuid not null,
  customer_id uuid not null,
  -- El titular de la familia: el único que ve montos (D30 punto 7).
  is_holder boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint family_members_family_fkey
    foreign key (tenant_id, family_id) references families (tenant_id, id),
  constraint family_members_customer_fkey
    foreign key (tenant_id, customer_id) references customers (tenant_id, id)
);

create trigger family_members_set_updated_at before update on family_members
  for each row execute function app.set_updated_at();
create trigger family_members_audit after insert or update or delete on family_members
  for each row execute function app.log_change();
create trigger enforce_tenant_writable before insert or update on family_members
  for each row execute function app.enforce_tenant_writable();

create index family_members_tenant_family_idx on family_members (tenant_id, family_id);
-- Un cliente pertenece a UNA sola familia (parcial: salir de una permite entrar a otra).
create unique index family_members_customer_key
  on family_members (customer_id) where deleted_at is null;
-- Una familia tiene UN titular.
create unique index family_members_holder_key
  on family_members (family_id) where is_holder and deleted_at is null;

-- =============================================================================
-- pet_ownerships
-- =============================================================================
create table pet_ownerships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  -- `on delete cascade`: es historial DERIVADO de la mascota (no expediente clínico). Una mascota
  -- no se borra físicamente en producción (no hay política de DELETE); solo la limpieza de los
  -- tests, con service_role, lo hace, y arrastra su historial de dueños.
  pet_id uuid not null references pets(id) on delete cascade,
  customer_id uuid not null references customers(id),
  started_at timestamptz not null default now(),
  -- Nulo = es el dueño actual.
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  constraint pet_ownerships_period_check check (ended_at is null or ended_at >= started_at)
);

create index pet_ownerships_tenant_pet_idx on pet_ownerships (tenant_id, pet_id, started_at);
create index pet_ownerships_tenant_customer_idx on pet_ownerships (tenant_id, customer_id);
-- Un solo dueño actual por mascota.
create unique index pet_ownerships_current_key on pet_ownerships (pet_id) where ended_at is null;

create trigger pet_ownerships_audit after insert or update or delete on pet_ownerships
  for each row execute function app.log_change();
create trigger enforce_tenant_writable before insert or update on pet_ownerships
  for each row execute function app.enforce_tenant_writable();
-- Sin política de DELETE (§7.3): ningún usuario lo borra. Se corrige con otra transferencia.

-- El historial se alimenta solo: al dar de alta una mascota y al cambiarle el dueño por
-- cualquier camino (la RPC de transferencia o un UPDATE directo), así nunca queda un hueco.
create function app.sync_pet_ownership()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if tg_op = 'INSERT' then
    insert into pet_ownerships (tenant_id, pet_id, customer_id, started_at)
    values (new.tenant_id, new.id, new.customer_id, new.created_at);
    return new;
  end if;

  if new.customer_id is distinct from old.customer_id then
    update pet_ownerships
       set ended_at = now()
     where pet_id = new.id and ended_at is null;
    insert into pet_ownerships (tenant_id, pet_id, customer_id, started_at)
    values (new.tenant_id, new.id, new.customer_id, now());
  end if;
  return new;
end;
$$;

revoke execute on function app.sync_pet_ownership() from public, anon, authenticated;

create trigger pets_sync_ownership
  after insert or update of customer_id on pets
  for each row execute function app.sync_pet_ownership();

-- Las mascotas que ya existen: su dueño actual lo es desde que se dieron de alta.
-- (La bitácora se apaga solo durante el relleno: es preparación del historial, no un cambio
-- de nadie; mismo criterio que la migración is_demo.)
alter table pet_ownerships disable trigger pet_ownerships_audit;
insert into pet_ownerships (tenant_id, pet_id, customer_id, started_at)
select p.tenant_id, p.id, p.customer_id, p.created_at from pets p;
alter table pet_ownerships enable trigger pet_ownerships_audit;

-- =============================================================================
-- RLS (§7.3): lectura para el negocio; escritura solo por las funciones de abajo
-- =============================================================================
alter table families enable row level security;
alter table families force row level security;
alter table family_members enable row level security;
alter table family_members force row level security;
alter table pet_ownerships enable row level security;
alter table pet_ownerships force row level security;

-- Sin `deleted_at is null` en SELECT por la trampa de §7.2 (las funciones ocultan con UPDATE).
create policy families_select on families for select
  to authenticated using (app.is_member_of(tenant_id));
create policy family_members_select on family_members for select
  to authenticated using (app.is_member_of(tenant_id));
create policy pet_ownerships_select on pet_ownerships for select
  to authenticated using (app.is_member_of(tenant_id));

comment on table families is
  'Un hogar: grupo de clientes con un titular. Un cliente pertenece a una sola familia. Se escribe con save_family().';
comment on table family_members is
  'Miembros de una familia. is_holder marca al titular (único que ve montos).';
comment on table pet_ownerships is
  'Historial de dueños de cada mascota y sus periodos. Se alimenta solo (trigger sobre pets); no se borra.';

-- =============================================================================
-- save_family(): crea o corrige una familia con sus miembros y su titular
-- =============================================================================
-- Todo en una transacción: los miembros se reemplazan por el conjunto dado (los que ya no
-- están se ocultan; los nuevos entran) y el titular se reasigna. Rechaza si algún cliente ya
-- pertenece a OTRA familia, diciendo a cuál.
create function save_family(
  p_tenant_id uuid,
  p_family_id uuid,
  p_name text,
  p_holder_customer_id uuid,
  p_member_customer_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_family_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_members uuid[] := (select coalesce(array_agg(distinct m), '{}') from unnest(p_member_customer_ids) as m);
  v_other record;
begin
  if not app.is_member_of(p_tenant_id) or app.role_in(p_tenant_id) not in ('owner', 'receptionist') then
    raise exception 'No tienes permiso para administrar familias.' using errcode = 'insufficient_privilege';
  end if;

  if v_name = '' then
    raise exception 'Escribe el nombre de la familia.' using errcode = 'check_violation';
  end if;
  if coalesce(array_length(v_members, 1), 0) = 0 then
    raise exception 'La familia necesita al menos un miembro.' using errcode = 'check_violation';
  end if;
  if p_holder_customer_id is null or not (p_holder_customer_id = any (v_members)) then
    raise exception 'El titular debe ser uno de los miembros.' using errcode = 'check_violation';
  end if;

  -- Todos los miembros son clientes de este negocio, no eliminados.
  if (select count(*) from customers c
       where c.tenant_id = p_tenant_id and c.deleted_at is null and c.id = any (v_members))
     <> array_length(v_members, 1) then
    raise exception 'Algún miembro no es un cliente de este negocio.' using errcode = 'check_violation';
  end if;

  if p_family_id is not null and not exists (
    select 1 from families f where f.id = p_family_id and f.tenant_id = p_tenant_id and f.deleted_at is null
  ) then
    raise exception 'La familia no existe.' using errcode = 'no_data_found';
  end if;

  -- Un cliente en otra familia: se dice cuál (el índice único lo rechazaría con un error feo).
  select c.first_name || ' ' || c.last_name as customer_name, f.name as family_name
    into v_other
    from family_members fm
    join customers c on c.id = fm.customer_id
    join families f on f.id = fm.family_id
   where fm.deleted_at is null
     and fm.customer_id = any (v_members)
     and fm.family_id is distinct from p_family_id
   limit 1;
  if found then
    raise exception '% ya pertenece a la familia "%".', v_other.customer_name, v_other.family_name
      using errcode = 'check_violation', hint = 'customer_in_other_family';
  end if;

  if p_family_id is null then
    insert into families (tenant_id, name) values (p_tenant_id, v_name) returning id into v_family_id;
  else
    v_family_id := p_family_id;
    update families set name = v_name where id = v_family_id;
  end if;

  -- Quita a los que ya no están y suelta la marca de titular de todos antes de reasignarla
  -- (el índice único de titular no admite dos a la vez ni dentro de la misma sentencia).
  update family_members
     set deleted_at = now(), is_holder = false
   where family_id = v_family_id and deleted_at is null and not (customer_id = any (v_members));
  update family_members
     set is_holder = false
   where family_id = v_family_id and deleted_at is null and is_holder;

  insert into family_members (tenant_id, family_id, customer_id)
  select p_tenant_id, v_family_id, m
    from unnest(v_members) as m
   where not exists (
     select 1 from family_members fm
      where fm.family_id = v_family_id and fm.customer_id = m and fm.deleted_at is null
   );

  update family_members
     set is_holder = true
   where family_id = v_family_id and customer_id = p_holder_customer_id and deleted_at is null;

  return v_family_id;
end;
$$;

comment on function save_family(uuid, uuid, text, uuid, uuid[]) is
  'Crea o corrige una familia con sus miembros y su titular. Solo dueño y recepción. Un cliente pertenece a una sola familia.';

-- Disuelve una familia: la oculta y suelta a sus miembros (los clientes y mascotas no se tocan).
create function delete_family(p_family_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from families where id = p_family_id and deleted_at is null;
  if not found then
    raise exception 'La familia no existe.' using errcode = 'no_data_found';
  end if;
  if not app.is_member_of(v_tenant) or app.role_in(v_tenant) not in ('owner', 'receptionist') then
    raise exception 'No tienes permiso para administrar familias.' using errcode = 'insufficient_privilege';
  end if;

  update family_members set deleted_at = now(), is_holder = false
   where family_id = p_family_id and deleted_at is null;
  update families set deleted_at = now() where id = p_family_id;
end;
$$;

-- =============================================================================
-- transfer_pet(): cambiar de dueño sin perder el historial
-- =============================================================================
create function transfer_pet(p_pet_id uuid, p_new_customer_id uuid)
returns pets
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pet pets;
begin
  select * into v_pet from pets where id = p_pet_id and deleted_at is null;
  if not found then
    raise exception 'La mascota no existe.' using errcode = 'no_data_found';
  end if;

  -- Revalidación primero (§7.3.4): membresía y rol dueño o recepción.
  if not app.is_member_of(v_pet.tenant_id)
     or app.role_in(v_pet.tenant_id) not in ('owner', 'receptionist') then
    raise exception 'No tienes permiso para transferir mascotas.' using errcode = 'insufficient_privilege';
  end if;

  if p_new_customer_id is null or not exists (
    select 1 from customers c
     where c.id = p_new_customer_id and c.tenant_id = v_pet.tenant_id and c.deleted_at is null
  ) then
    raise exception 'El nuevo dueño no existe.' using errcode = 'check_violation';
  end if;
  if p_new_customer_id = v_pet.customer_id then
    raise exception 'La mascota ya es de ese cliente.' using errcode = 'check_violation';
  end if;

  -- El trigger pets_sync_ownership cierra el periodo anterior y abre el nuevo.
  update pets set customer_id = p_new_customer_id where id = p_pet_id returning * into v_pet;

  -- Las citas programadas se van con la mascota. Las ya atendidas, cobradas o canceladas
  -- conservan al cliente que las tenía: son historia (y las ventas no se tocan, §8.5).
  update appointments
     set customer_id = p_new_customer_id
   where pet_id = p_pet_id and status = 'scheduled' and deleted_at is null;

  -- Los links compartidos de la mascota se revocan: eran del dueño anterior.
  update share_links
     set revoked_at = now()
   where pet_id = p_pet_id and scope = 'pet' and revoked_at is null and deleted_at is null;

  return v_pet;
end;
$$;

comment on function transfer_pet(uuid, uuid) is
  'Transfiere una mascota a otro cliente: cierra el periodo del dueño anterior, pasa sus citas programadas y revoca sus links. Las ventas no se tocan. Solo dueño y recepción.';

-- =============================================================================
-- Visibilidad por periodo (para la cuenta del cliente, fase 16B)
-- =============================================================================
-- "Clientes relevantes" de un cliente: él y los miembros de SU familia actual.
create function app.customer_circle(p_customer_id uuid)
returns table (customer_id uuid)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select p_customer_id
  union
  select fm2.customer_id
    from family_members fm1
    join family_members fm2 on fm2.family_id = fm1.family_id and fm2.deleted_at is null
   where fm1.customer_id = p_customer_id and fm1.deleted_at is null;
$$;

-- ¿Puede este cliente ver lo que pasó con la mascota en el instante `p_at`?
--   * Si él o su familia son el dueño ACTUAL: ve todo el historial (también lo anterior a
--     que fuera suyo: cartilla, medicamentos y registros; los montos son otra regla).
--   * Si fue dueño antes: solo lo ocurrido durante su periodo (o el de su familia).
--   * Si nunca lo fue: nada.
create function app.customer_can_view_pet(p_customer_id uuid, p_pet_id uuid, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
      from pet_ownerships o
      join app.customer_circle(p_customer_id) c on c.customer_id = o.customer_id
     where o.pet_id = p_pet_id
       and (
         o.ended_at is null
         or (p_at >= o.started_at and p_at < o.ended_at)
       )
  );
$$;

-- ¿Puede ver los MONTOS de lo ocurrido en `p_at`? Solo el dueño de ese momento o el titular
-- de la familia a la que pertenecía el dueño de ese momento. El nuevo dueño no ve los montos
-- de antes de serlo, y un miembro no titular nunca los ve.
create function app.customer_can_view_pet_money(p_customer_id uuid, p_pet_id uuid, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
      from pet_ownerships o
     where o.pet_id = p_pet_id
       and p_at >= o.started_at
       and (o.ended_at is null or p_at < o.ended_at)
       and (
         o.customer_id = p_customer_id
         or exists (
           select 1
             from family_members owner_fm
             join family_members holder_fm
               on holder_fm.family_id = owner_fm.family_id
              and holder_fm.is_holder
              and holder_fm.deleted_at is null
            where owner_fm.customer_id = o.customer_id
              and owner_fm.deleted_at is null
              and holder_fm.customer_id = p_customer_id
         )
       )
  );
$$;

revoke execute on function app.customer_circle(uuid) from public, anon, authenticated;
revoke execute on function app.customer_can_view_pet(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function app.customer_can_view_pet_money(uuid, uuid, timestamptz) from public, anon, authenticated;
-- La Edge Function de la cuenta del cliente (16B) corre con service_role: es la única que las
-- llama. Ningún rol de la API de usuarios (anon, authenticated) puede consultarlas.
grant execute on function app.customer_can_view_pet(uuid, uuid, timestamptz) to service_role;
grant execute on function app.customer_can_view_pet_money(uuid, uuid, timestamptz) to service_role;

-- Permisos de ejecución de las RPC: nada para anon ni PUBLIC.
revoke execute on function save_family(uuid, uuid, text, uuid, uuid[]) from public, anon;
revoke execute on function delete_family(uuid) from public, anon;
revoke execute on function transfer_pet(uuid, uuid) from public, anon;
grant execute on function save_family(uuid, uuid, text, uuid, uuid[]) to authenticated;
grant execute on function delete_family(uuid) to authenticated;
grant execute on function transfer_pet(uuid, uuid) to authenticated;
