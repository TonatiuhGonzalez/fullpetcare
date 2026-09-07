-- Tabla sales y sale_items: el cobro (CLAUDE.md §6.5). Registra qué se le
-- cobró a un cliente y con qué detalle, separado de "cómo se pagó"
-- (payments, siguiente migración) — una venta puede pagarse con más de un
-- método (parte en efectivo, parte con tarjeta), así que son dos tablas.

create type sale_status as enum ('open', 'paid', 'cancelled');

create table sales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  branch_id uuid not null references branches(id),
  customer_id uuid not null references customers(id),
  -- Folio legible para el cliente ("venta #14 de esta sucursal"), no el
  -- uuid interno. Empieza en 1 por sucursal — dos sucursales del mismo
  -- tenant no comparten numeración, cada una lleva la suya como en un
  -- negocio real con dos cajas. Se calcula dentro de checkout_appointment()
  -- (siguiente-siguiente migración) tomando el máximo existente + 1 en la
  -- misma transacción; el índice único de abajo es la red de seguridad si
  -- dos cobros de la misma sucursal cayeran en el mismo instante exacto
  -- (mismo criterio ya aceptado para el traslape de citas en
  -- appointment_booking_rpc.sql: raro a escala de demo, y si pasa, la
  -- segunda transacción falla en vez de guardar un folio duplicado).
  folio integer not null,
  status sale_status not null default 'open',
  subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  tax_cents integer not null default 0 check (tax_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  total_cents integer not null default 0 check (total_cents >= 0),
  paid_at timestamptz,
  closed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger sales_set_updated_at
  before update on sales
  for each row execute function app.set_updated_at();

create trigger sales_audit
  after insert or update or delete on sales
  for each row execute function app.log_change();

-- Un folio no se repite dentro de la misma sucursal (ver comentario de la
-- columna arriba).
create unique index sales_tenant_branch_folio_idx
  on sales (tenant_id, branch_id, folio);

-- Para "el historial de compras de este cliente" (fase 6, timeline de
-- mascota) y para "la caja de hoy de esta sucursal".
create index sales_tenant_customer_idx on sales (tenant_id, customer_id);
create index sales_tenant_branch_created_idx on sales (tenant_id, branch_id, created_at);

alter table sales enable row level security;
alter table sales force row level security;

-- Sin "and deleted_at is null" (misma trampa de siempre, CLAUDE.md §7.2):
-- esta tabla tiene UPDATE para un rol autenticado (abajo).
--
-- Lectura por SUCURSAL (can_access_branch), igual que appointments: un
-- groomer no cobra, pero si algún día se le da acceso de lectura al
-- historial de ventas de su sucursal para consultar un ticket, la política
-- ya está en el lugar correcto. Hoy, en la práctica, solo owner/receptionist
-- llegan a esta pantalla desde la UI.
create policy sales_select on sales for select
  to authenticated
  using (app.is_member_of(tenant_id) and app.can_access_branch(branch_id));

-- Cobrar es tarea de recepción/dueño (CLAUDE.md §6.1: receptionist "Clientes,
-- mascotas, agenda, cobro"; groomer/vet no aparecen con este permiso). En la
-- práctica las filas de sales/sale_items las crea checkout_appointment()
-- (SECURITY DEFINER, siguiente-siguiente migración), pero la política sigue
-- siendo necesaria: es la que protege contra un INSERT directo a la tabla
-- que se salte la RPC y su validación de traslapes/permisos.
create policy sales_insert on sales for insert
  to authenticated
  with check (
    app.is_member_of(tenant_id)
    and app.can_access_branch(branch_id)
    and app.role_in(tenant_id) in ('owner', 'receptionist')
  );

create policy sales_update on sales for update
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and app.can_access_branch(branch_id)
    and app.role_in(tenant_id) in ('owner', 'receptionist')
  )
  with check (
    app.is_member_of(tenant_id)
    and app.can_access_branch(branch_id)
    and app.role_in(tenant_id) in ('owner', 'receptionist')
  );

-- =============================================================================
-- sale_items
-- =============================================================================
-- item_type es un enum con un solo valor hoy a propósito (CLAUDE.md §6.5):
-- v1 es solo servicios (ver CLAUDE.md §1, "Fuera de alcance"). Cuando entren
-- productos, se agrega el valor 'product' al enum y una columna product_id
-- nullable — ambos cambios son ADITIVOS (un ALTER TYPE ... ADD VALUE y un
-- ALTER TABLE ... ADD COLUMN), no tocan ni una fila de las ventas ya
-- guardadas.
create type sale_item_type as enum ('service');

create table sale_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  sale_id uuid not null references sales(id),
  item_type sale_item_type not null default 'service',
  service_id uuid references services(id),
  -- Qué cita generó esta partida — permite ir del ticket de vuelta a la
  -- ficha de atención, y es lo que checkout_appointment() usa para marcar
  -- la cita como cobrada sin ambigüedad si una venta llegara a tener
  -- partidas de más de una cita (mismo cliente, dos citas, un ticket).
  appointment_id uuid references appointments(id),
  -- Copiado del name_snapshot de appointment_services al momento de
  -- cobrar, no una referencia viva a "services" — mismo principio de
  -- snapshot que ya usa appointment_services (CLAUDE.md §6.3): si el
  -- catálogo cambia después, este ticket ya emitido no debe cambiar.
  description text not null,
  quantity integer not null default 1 check (quantity > 0),
  -- Precio unitario CON IVA incluido (igual que appointment_services y
  -- que services.price_cents — CLAUDE.md §8.2, "IVA incluido en el
  -- precio"). tax_cents y line_total_cents son el desglose de ESTA
  -- partida ya calculado (lib/money.ts#splitTaxIncluded), guardado y no
  -- recalculado cada vez que se muestra el ticket.
  unit_price_cents integer not null check (unit_price_cents >= 0),
  tax_rate_bp integer not null check (tax_rate_bp >= 0),
  tax_cents integer not null check (tax_cents >= 0),
  line_total_cents integer not null check (line_total_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger sale_items_set_updated_at
  before update on sale_items
  for each row execute function app.set_updated_at();

create trigger sale_items_audit
  after insert or update or delete on sale_items
  for each row execute function app.log_change();

create index sale_items_tenant_sale_idx on sale_items (tenant_id, sale_id);

alter table sale_items enable row level security;
alter table sale_items force row level security;

-- El acceso de sale_items sigue al de su venta (mismo patrón que
-- appointment_services siguiendo a appointments): un EXISTS contra sales,
-- cuya política de SELECT ya filtra por sucursal.
create policy sale_items_select on sale_items for select
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and exists (
      select 1 from sales s
      where s.id = sale_items.sale_id
        and app.can_access_branch(s.branch_id)
    )
  );

create policy sale_items_insert on sale_items for insert
  to authenticated
  with check (
    app.is_member_of(tenant_id) and app.role_in(tenant_id) in ('owner', 'receptionist')
  );

-- Sin política de UPDATE ni DELETE para sale_items: una partida de un
-- ticket ya cobrado no se edita (CLAUDE.md §11, "simple sobre elegante" —
-- v1 no tiene flujo de "corregir una venta", si algo salió mal se cancela
-- la venta completa vía sales.status = 'cancelled', que sí tiene UPDATE
-- arriba). Sin política de DELETE, ningún rol autenticado normal puede
-- borrar una partida (CLAUDE.md §7.3 regla 2).
