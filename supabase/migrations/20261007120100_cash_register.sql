-- Caja: turnos, movimientos y cierre (fase 12, tareas 12.4 a 12.6 / HMH Four
-- #2073 y #2074, PLAN.md D17).
--
-- Un TURNO de caja (`cash_sessions`) se abre en una sucursal con un fondo inicial
-- y se cierra contando el efectivo. Durante el turno se registran retiros,
-- gastos e ingresos (`cash_movements`, inmutables). Al cerrar, la base calcula el
-- efectivo ESPERADO con la misma regla que `lib/cashCount.ts` y congela esperado,
-- contado y diferencia.
--
-- Tres decisiones de D17 que se ven aquí:
--   * Cobrar NO exige caja abierta y la venta no apunta al turno: pertenece al
--     turno de su sucursal cuyo rango [apertura, cierre) contiene `paid_at`. No se
--     toca la RPC de cobro.
--   * Un corte cerrado es un documento contable: no se edita ni se borra, ni con
--     service_role.
--   * Los usuarios no escriben `cash_sessions` directo: abrir y cerrar pasan por
--     RPC que revalidan membresía, permiso y sucursal (§7.3.4).
--
-- Migración aditiva (CLAUDE.md §8.1).

-- =============================================================================
-- 1. cash_sessions
-- =============================================================================
create table cash_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  branch_id uuid not null references branches(id),
  opened_by uuid not null references auth.users(id),
  opened_at timestamptz not null default clock_timestamp(),
  -- Efectivo con el que arranca el turno. Entero en centavos (§8.2).
  opening_float_cents integer not null check (opening_float_cents >= 0),
  opening_note text,
  -- Todo lo siguiente se llena de golpe al cerrar (check de abajo).
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  expected_cents integer,
  counted_cents integer check (counted_cents is null or counted_cents >= 0),
  difference_cents integer,
  closing_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  -- Abierta = sin ningún dato de cierre; cerrada = con todos. Nunca a medias.
  constraint cash_sessions_closing_fields_check check (
    (closed_at is null and closed_by is null and expected_cents is null
       and counted_cents is null and difference_cents is null)
    or
    (closed_at is not null and closed_by is not null and expected_cents is not null
       and counted_cents is not null and difference_cents is not null)
  ),
  constraint cash_sessions_closed_after_opened_check check (closed_at is null or closed_at >= opened_at),
  -- La diferencia es contado − esperado: la base lo garantiza, no solo la RPC.
  constraint cash_sessions_difference_check check (
    difference_cents is null or difference_cents = counted_cents - expected_cents
  )
);

-- UNA sola caja abierta por sucursal, garantizado por la base y no por la pantalla.
create unique index cash_sessions_one_open_per_branch_idx
  on cash_sessions (branch_id)
  where closed_at is null and deleted_at is null;

create index cash_sessions_tenant_branch_opened_idx
  on cash_sessions (tenant_id, branch_id, opened_at);

create trigger cash_sessions_set_updated_at
  before update on cash_sessions
  for each row execute function app.set_updated_at();

create trigger enforce_tenant_writable
  before insert or update on cash_sessions
  for each row execute function app.enforce_tenant_writable();

create trigger cash_sessions_audit
  after insert or update on cash_sessions
  for each row execute function app.log_change();

-- Un corte cerrado no se modifica, ni siquiera con service_role (cinturón
-- además del tirante, igual que el expediente §8.5). Cerrar es UPDATE de una fila
-- abierta, así que sigue permitido.
create function app.protect_closed_cash_session() returns trigger
language plpgsql
as $$
begin
  if old.closed_at is not null then
    raise exception 'Un corte de caja cerrado no se puede modificar.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function app.protect_closed_cash_session() from public, anon, authenticated;

create trigger cash_sessions_protect_closed
  before update on cash_sessions
  for each row execute function app.protect_closed_cash_session();

create trigger cash_sessions_prevent_hard_delete
  before delete on cash_sessions
  for each row execute function app.prevent_hard_delete();

alter table cash_sessions enable row level security;
alter table cash_sessions force row level security;

-- LECTURA: permiso 'cash_register'/'view' y sucursal propia. Sin
-- `deleted_at is null` por la trampa de CLAUDE.md §7.2.
create policy cash_sessions_select on cash_sessions for select
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and app.has_permission(tenant_id, 'cash_register', 'view')
    and app.can_access_branch(branch_id)
  );
-- SIN política de INSERT/UPDATE/DELETE para usuarios: abrir y cerrar son RPC.

comment on table cash_sessions is
  'Turno de caja de una sucursal: abre con fondo inicial, cierra con conteo. Cerrado es inmutable. Se escribe solo por open_cash_session/close_cash_session.';

-- =============================================================================
-- 2. cash_movements (retiros, gastos e ingresos de efectivo)
-- =============================================================================
create type cash_movement_type as enum ('withdrawal', 'expense', 'income');

-- Bitácora INMUTABLE, igual que stock_movements (D15): sin updated_at ni
-- deleted_at; un error se corrige con otro movimiento.
create table cash_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  branch_id uuid not null references branches(id),
  cash_session_id uuid not null references cash_sessions(id),
  movement_type cash_movement_type not null,
  -- Siempre positivo: el tipo decide si entra o sale de la caja.
  amount_cents integer not null check (amount_cents > 0),
  reason text not null check (length(btrim(reason)) > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index cash_movements_session_idx on cash_movements (tenant_id, cash_session_id);

create trigger enforce_tenant_writable
  before insert or update on cash_movements
  for each row execute function app.enforce_tenant_writable();

create trigger cash_movements_audit
  after insert on cash_movements
  for each row execute function app.log_change();

create function app.reject_cash_movement_update() returns trigger
language plpgsql
as $$
begin
  raise exception 'Un movimiento de caja no se modifica: se corrige con otro movimiento (CLAUDE.md §8.5).'
    using errcode = 'insufficient_privilege';
end;
$$;

revoke execute on function app.reject_cash_movement_update() from public, anon, authenticated;

create trigger cash_movements_no_update
  before update on cash_movements
  for each row execute function app.reject_cash_movement_update();

create trigger cash_movements_no_delete
  before delete on cash_movements
  for each row execute function app.prevent_hard_delete();

-- Solo se registra en una caja ABIERTA de la MISMA sucursal y negocio. Es un
-- trigger (no solo la política) para que valga también para service_role.
create function app.check_cash_movement() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session cash_sessions;
begin
  select * into v_session from cash_sessions where id = new.cash_session_id;
  if not found
     or v_session.tenant_id <> new.tenant_id
     or v_session.branch_id <> new.branch_id then
    raise exception 'La caja indicada no corresponde a esta sucursal.' using errcode = 'check_violation';
  end if;
  if v_session.closed_at is not null then
    raise exception 'La caja ya está cerrada: no se pueden registrar movimientos.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function app.check_cash_movement() from public, anon, authenticated;

create trigger cash_movements_check
  before insert on cash_movements
  for each row execute function app.check_cash_movement();

alter table cash_movements enable row level security;
alter table cash_movements force row level security;

create policy cash_movements_select on cash_movements for select
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and app.has_permission(tenant_id, 'cash_register', 'view')
    and app.can_access_branch(branch_id)
  );

-- Los usuarios insertan directo (como stock_movements): el trigger de arriba
-- exige caja abierta de la misma sucursal.
create policy cash_movements_insert on cash_movements for insert
  to authenticated
  with check (
    app.is_member_of(tenant_id)
    and app.has_permission(tenant_id, 'cash_register', 'edit')
    and app.can_access_branch(branch_id)
    and created_by = auth.uid()
  );
-- Sin política de UPDATE ni DELETE (CLAUDE.md §7.3.2).

comment on table cash_movements is
  'Retiros, gastos e ingresos de efectivo de un turno de caja. Bitácora inmutable (se corrige con otro movimiento).';

-- =============================================================================
-- 3. open_cash_session()
-- =============================================================================
-- SECURITY DEFINER: escribe `cash_sessions`, que los usuarios no pueden escribir
-- directo, así que revalida adentro permiso y sucursal (§7.3.4).
create function open_cash_session(
  p_branch_id uuid,
  p_opening_float_cents integer,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_id uuid;
begin
  select tenant_id into v_tenant_id from branches where id = p_branch_id and deleted_at is null;
  -- Sucursal inexistente, de otro negocio o sin acceso: el mismo mensaje, sin
  -- revelar cuál (no se confirma que la sucursal existe).
  if v_tenant_id is null
     or not app.is_member_of(v_tenant_id)
     or not app.can_access_branch(p_branch_id)
     or not app.has_permission(v_tenant_id, 'cash_register', 'edit') then
    raise exception 'No tienes permiso para abrir la caja de esta sucursal.' using errcode = '42501';
  end if;

  if p_opening_float_cents is null or p_opening_float_cents < 0 then
    raise exception 'El fondo inicial debe ser un monto de cero o más.' using errcode = '22023';
  end if;

  begin
    insert into cash_sessions (tenant_id, branch_id, opened_by, opening_float_cents, opening_note)
    values (v_tenant_id, p_branch_id, auth.uid(), p_opening_float_cents, nullif(btrim(coalesce(p_note, '')), ''))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ya hay una caja abierta en esta sucursal. Ciérrala antes de abrir otra.' using errcode = '23505';
  end;

  return v_id;
end;
$$;

revoke execute on function open_cash_session(uuid, integer, text) from public, anon;
grant execute on function open_cash_session(uuid, integer, text) to authenticated;

-- =============================================================================
-- 4. Efectivo esperado de un turno (misma regla que lib/cashCount.ts)
-- =============================================================================
-- Interna: la usan close_cash_session() y, más adelante, la pantalla de caja
-- (cobrado en el turno). No revalida permiso porque nadie de los roles de la
-- aplicación puede ejecutarla directo (se revoca abajo); la llaman las RPC que sí.
--
--   * Solo ventas `paid` de la sucursal con paid_at en [apertura, hasta).
--   * Cambio de una venta = pagado − total, limitado al efectivo recibido.
--   * Efectivo que se queda = efectivo recibido − cambio.
--   * esperado = fondo + efectivo que se queda + ingresos − retiros − gastos.
create function app.cash_session_summary(p_session_id uuid, p_until timestamptz)
returns table (
  cash_cents bigint,
  card_cents bigint,
  transfer_cents bigint,
  openpay_cents bigint,
  change_given_cents bigint,
  income_cents bigint,
  outflow_cents bigint,
  expected_cents bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select * from cash_sessions where id = p_session_id
  ),
  per_sale as (
    select
      sa.id,
      sa.total_cents,
      coalesce(sum(p.amount_cents), 0) as paid,
      coalesce(sum(p.amount_cents) filter (where p.method = 'cash'), 0) as cash_in,
      coalesce(sum(p.amount_cents) filter (where p.method = 'card'), 0) as card_in,
      coalesce(sum(p.amount_cents) filter (where p.method = 'transfer_spei'), 0) as transfer_in,
      coalesce(sum(p.amount_cents) filter (where p.method = 'openpay'), 0) as openpay_in
    from s
    join sales sa
      on sa.branch_id = s.branch_id
     and sa.tenant_id = s.tenant_id
     and sa.status = 'paid'
     and sa.deleted_at is null
     and sa.paid_at >= s.opened_at
     and sa.paid_at < p_until
    left join payments p on p.sale_id = sa.id and p.deleted_at is null
    group by sa.id, sa.total_cents
  ),
  with_change as (
    select *, least(cash_in, greatest(0, paid - total_cents)) as change_given from per_sale
  ),
  sales_totals as (
    select
      coalesce(sum(cash_in - change_given), 0) as cash_kept,
      coalesce(sum(card_in), 0) as card,
      coalesce(sum(transfer_in), 0) as transfer,
      coalesce(sum(openpay_in), 0) as openpay,
      coalesce(sum(change_given), 0) as change_total
    from with_change
  ),
  moves as (
    select
      coalesce(sum(amount_cents) filter (where movement_type = 'income'), 0) as income,
      coalesce(sum(amount_cents) filter (where movement_type in ('withdrawal', 'expense')), 0) as outflow
    from cash_movements where cash_session_id = p_session_id
  )
  select
    st.cash_kept, st.card, st.transfer, st.openpay, st.change_total,
    m.income, m.outflow,
    (select opening_float_cents from s) + st.cash_kept + m.income - m.outflow
  from sales_totals st, moves m;
$$;

revoke execute on function app.cash_session_summary(uuid, timestamptz) from public, anon, authenticated;

-- =============================================================================
-- 5. close_cash_session()
-- =============================================================================
create function close_cash_session(
  p_session_id uuid,
  p_counted_cents integer,
  p_note text default null
) returns cash_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session cash_sessions;
  v_until timestamptz := clock_timestamp();
  v_expected integer;
  v_closed cash_sessions;
begin
  -- `for update`: dos cierres simultáneos de la misma caja no pisan al otro.
  select * into v_session from cash_sessions where id = p_session_id and deleted_at is null for update;
  if not found
     or not app.is_member_of(v_session.tenant_id)
     or not app.can_access_branch(v_session.branch_id)
     or not app.has_permission(v_session.tenant_id, 'cash_register', 'edit') then
    raise exception 'No tienes permiso para cerrar esta caja.' using errcode = '42501';
  end if;

  if v_session.closed_at is not null then
    raise exception 'Esta caja ya está cerrada.' using errcode = '23514';
  end if;
  if p_counted_cents is null or p_counted_cents < 0 then
    raise exception 'El efectivo contado debe ser un monto de cero o más.' using errcode = '22023';
  end if;

  select expected_cents::integer into v_expected from app.cash_session_summary(p_session_id, v_until);

  update cash_sessions
     set closed_by = auth.uid(),
         closed_at = v_until,
         expected_cents = v_expected,
         counted_cents = p_counted_cents,
         difference_cents = p_counted_cents - v_expected,
         closing_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_session_id
  returning * into v_closed;

  return v_closed;
end;
$$;

revoke execute on function close_cash_session(uuid, integer, text) from public, anon;
grant execute on function close_cash_session(uuid, integer, text) to authenticated;

-- =============================================================================
-- 6. Permisos por defecto en los negocios que YA existen
-- =============================================================================
-- Caja: dueño y recepción ver/editar. Reportes: solo el dueño (decisión 9 de D17).
insert into role_permissions (tenant_id, role, module, can_view, can_edit)
select t.id, r.role, 'cash_register', r.can_view, r.can_edit
from tenants t
cross join (values
  ('owner'::member_role, true, true),
  ('receptionist'::member_role, true, true),
  ('groomer'::member_role, false, false),
  ('vet'::member_role, false, false)
) as r(role, can_view, can_edit)
on conflict (tenant_id, role, module) do nothing;

insert into role_permissions (tenant_id, role, module, can_view, can_edit)
select t.id, r.role, 'reports', r.can_view, r.can_edit
from tenants t
cross join (values
  ('owner'::member_role, true, true),
  ('receptionist'::member_role, false, false),
  ('groomer'::member_role, false, false),
  ('vet'::member_role, false, false)
) as r(role, can_view, can_edit)
on conflict (tenant_id, role, module) do nothing;
