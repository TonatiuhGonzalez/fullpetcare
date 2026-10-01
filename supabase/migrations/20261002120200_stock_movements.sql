-- Existencias por sucursal (fase 11, tareas 11.5 y 11.6 / HMH Four #2039).
--
-- IDEA CENTRAL: la existencia NO es una columna que se suma y se resta. Es la
-- SUMA de una bitácora de movimientos. Si guardáramos "stock = 7" en el producto,
-- cualquier error (dos ventas a la vez, un reintento, un UPDATE a mano) lo
-- desfasaría de la realidad y no habría forma de saber por qué. Con la
-- bitácora, el 7 siempre se explica: +10 de compra, -2 de ventas, -1 de merma.
--
-- La bitácora es INMUTABLE: nadie edita ni borra un movimiento (ni el dueño, ni
-- service_role). Un error se corrige con OTRO movimiento. Es el mismo criterio
-- del expediente clínico (CLAUDE.md §8.5), por eso esta tabla NO lleva
-- updated_at ni deleted_at: no hay nada que actualizar ni que ocultar.
create type stock_movement_type as enum (
  'purchase',              -- entrada por compra (+)
  'sale',                  -- salida por venta (-)            [lo genera el cobro, 11.10]
  'sale_reversal',         -- regreso por venta cancelada (+) [lo genera el cobro, 11.10]
  'consumption',           -- uso en una consulta (-)         [lo genera la atención, 11.12]
  'consumption_reversal',  -- regreso por quitar la línea (+) [lo genera la atención, 11.12]
  'adjustment',            -- corrección de conteo (+ o -), con motivo
  'loss'                   -- merma: dañado, caducado o perdido (-), con motivo
);

create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  branch_id uuid not null references branches(id),
  product_id uuid not null references products(id),
  movement_type stock_movement_type not null,
  -- Entero con signo (decisión #6 de la fase: nada de fracciones). Positivo
  -- entra, negativo sale. Cero no es un movimiento.
  quantity integer not null check (quantity <> 0),
  -- Obligatorio en 'adjustment' y 'loss' (abajo): son los dos movimientos que
  -- cambian la existencia "porque sí", y alguien tiene que poder preguntar por qué.
  reason text,
  -- Venta que originó el movimiento (sale / sale_reversal). Sin FK a una tabla
  -- de consumos todavía: la referencia de consumo llega con la tarea 11.12.
  sale_id uuid references sales(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),

  -- El signo debe corresponder al tipo: una "compra" negativa o una "venta"
  -- positiva es siempre un error de captura (o un intento de maquillar la
  -- existencia). 'adjustment' puede ir en cualquier sentido.
  constraint stock_movements_sign_matches_type check (
    case movement_type
      when 'purchase' then quantity > 0
      when 'sale_reversal' then quantity > 0
      when 'consumption_reversal' then quantity > 0
      when 'sale' then quantity < 0
      when 'consumption' then quantity < 0
      when 'loss' then quantity < 0
      else true
    end
  ),
  constraint stock_movements_reason_required check (
    movement_type not in ('adjustment', 'loss')
    or (reason is not null and length(btrim(reason)) > 0)
  )
);

-- Es exactamente el filtro de la pantalla: "movimientos de este producto en
-- esta sucursal". Empieza por tenant_id como toda tabla de negocio (§6).
create index stock_movements_tenant_branch_product_idx
  on stock_movements (tenant_id, branch_id, product_id, created_at);

create trigger enforce_tenant_writable
  before insert or update on stock_movements
  for each row execute function app.enforce_tenant_writable();

-- Bitácora general (quién, cuándo). Solo INSERT: es lo único que puede pasar.
create trigger stock_movements_audit
  after insert on stock_movements
  for each row execute function app.log_change();

-- ===========================================================================
-- Inmutabilidad
-- ===========================================================================
-- Tres capas, de afuera hacia adentro:
--   1. Sin política de UPDATE ni DELETE: para un usuario normal, RLS ya lo niega.
--   2. Este trigger BEFORE UPDATE: rechaza el cambio incluso de service_role,
--      que se salta RLS pero NO los triggers.
--   3. prevent_hard_delete() para el DELETE, el mismo del expediente clínico.
create function app.reject_stock_movement_update()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'Un movimiento de inventario no se modifica: se corrige con otro movimiento (CLAUDE.md §8.5).'
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger stock_movements_no_update
  before update on stock_movements
  for each row execute function app.reject_stock_movement_update();

create trigger stock_movements_no_delete
  before delete on stock_movements
  for each row execute function app.prevent_hard_delete();

-- ===========================================================================
-- La existencia nunca queda negativa
-- ===========================================================================
-- Decisión #2 de la fase: con existencia 0 no se puede vender, y se valida EN LA
-- BASE, no solo en la pantalla. Se hace aquí, sobre el INSERT de cualquier
-- movimiento, y no en cada RPC: así la venta (11.10), el consumo (11.12), una
-- merma o un ajuste pasan por la misma regla y ninguno puede olvidarla.
--
-- El bloqueo (advisory lock) evita la carrera clásica: dos ventas a la vez de la
-- última pieza leen "existencia = 1", las dos pasan, y quedan en -1. Con el
-- candado, la segunda espera a que la primera termine y entonces lee 0.
-- El candado es por (sucursal, producto) y se suelta solo al terminar la
-- transacción.
--
-- SECURITY DEFINER: la suma debe ver TODOS los movimientos del producto aunque
-- RLS le ocultara algunos al que inserta. No expone datos: solo devuelve un error
-- o deja pasar, y revalida el tenant adentro (CLAUDE.md §7.3.4).
create function app.check_stock_not_negative()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_current integer;
begin
  if new.quantity > 0 then
    return new; -- entrar piezas nunca deja la existencia en negativo
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.branch_id::text || new.product_id::text, 0));

  select coalesce(sum(quantity), 0)::integer into v_current
    from stock_movements
   where tenant_id = new.tenant_id
     and branch_id = new.branch_id
     and product_id = new.product_id;

  if v_current + new.quantity < 0 then
    raise exception 'No hay existencia suficiente: hay % y se intentan sacar %.', v_current, -new.quantity
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger stock_movements_not_negative
  before insert on stock_movements
  for each row execute function app.check_stock_not_negative();

-- Es función de trigger: nadie la llama a mano.
revoke execute on function app.check_stock_not_negative() from public, anon, authenticated;

-- ===========================================================================
-- RLS
-- ===========================================================================
alter table stock_movements enable row level security;
alter table stock_movements force row level security;

-- LECTURA: permiso 'inventory'/'view' y sucursal propia. Es por sucursal porque
-- la existencia es por sucursal (CLAUDE.md §6.1: recepción ve "sus sucursales").
create policy stock_movements_select on stock_movements for select
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and app.has_permission(tenant_id, 'inventory', 'view')
    and app.can_access_branch(branch_id)
  );

-- ESCRITURA directa: solo compras, ajustes y mermas, y a nombre propio.
-- Los movimientos de venta y de consumo NO se pueden insertar a mano: si se
-- pudiera, cualquiera con permiso de editar inventario fabricaría ventas
-- falsas. Los generarán las RPC de cobro y de atención (SECURITY DEFINER).
-- Además el producto y la sucursal deben ser del mismo negocio que la fila:
-- sin esto, se podría colgar un movimiento de un producto ajeno.
create policy stock_movements_insert on stock_movements for insert
  to authenticated
  with check (
    app.is_member_of(tenant_id)
    and app.has_permission(tenant_id, 'inventory', 'edit')
    and app.can_access_branch(branch_id)
    and movement_type in ('purchase', 'adjustment', 'loss')
    and created_by = auth.uid()
    and exists (select 1 from branches b where b.id = branch_id and b.tenant_id = stock_movements.tenant_id)
    and exists (select 1 from products p where p.id = product_id and p.tenant_id = stock_movements.tenant_id)
  );

-- Sin política de UPDATE ni de DELETE (CLAUDE.md §7.3.2).

comment on table stock_movements is
  'Bitácora INMUTABLE de movimientos de inventario por sucursal. La existencia es la suma de quantity (vista product_stock). Se corrige con otro movimiento.';

-- ===========================================================================
-- product_stock: la existencia actual
-- ===========================================================================
-- Una fila por cada producto activo (no borrado) y cada sucursal activa del
-- negocio, AUNQUE no tenga movimientos: ahí la existencia es 0, no NULL (si
-- fuera NULL la pantalla mostraría "NaN"). Por eso es producto x sucursal con
-- left join, y coalesce sobre la suma.
--
-- security_invoker = true: la vista se ejecuta con los permisos de QUIEN
-- CONSULTA, así que RLS de products, branches y stock_movements aplica como si
-- consultara las tablas directo. Sin esto, una vista corre con los permisos de
-- su dueño (que se salta RLS) y cualquiera vería las existencias de todos los
-- negocios.
create view product_stock
  with (security_invoker = true) as
select
  p.tenant_id,
  b.id as branch_id,
  p.id as product_id,
  coalesce(sum(m.quantity), 0)::integer as stock
from products p
join branches b
  on b.tenant_id = p.tenant_id
 and b.deleted_at is null
 and b.is_active
 -- branches_select deja ver todas las sucursales del negocio, pero la existencia
 -- es de "mis sucursales": sin esto, recepción vería un 0 falso en las ajenas.
 and app.can_access_branch(b.id)
left join stock_movements m
  on m.tenant_id = p.tenant_id
 and m.branch_id = b.id
 and m.product_id = p.id
where p.deleted_at is null
group by p.tenant_id, b.id, p.id;

revoke all on product_stock from public, anon;
grant select on product_stock to authenticated, service_role;

comment on view product_stock is
  'Existencia actual por producto y sucursal (suma de stock_movements; 0 si no hay movimientos). security_invoker: respeta RLS de quien consulta.';
