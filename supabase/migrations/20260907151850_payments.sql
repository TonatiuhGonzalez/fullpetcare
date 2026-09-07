-- Tabla payments: cómo se pagó una venta (CLAUDE.md §6.5). Separada de
-- sales porque una venta puede cobrarse con más de un método a la vez
-- (parte en efectivo, parte con tarjeta) — cada payments es una de esas
-- partes, y su suma debe alcanzar el total de la venta.

create type payment_method as enum ('cash', 'card', 'transfer_spei', 'openpay');

-- Solo dos estados en v1, a propósito (CLAUDE.md §11, "sin abstracciones
-- especulativas"): 'approved' es un pago real (efectivo, que no necesita
-- pasarela) y 'simulated_approved' es cualquiera de los otros tres métodos,
-- que en v1 no hablan con una pasarela de verdad (CLAUDE.md §1, "Fuera de
-- alcance": "Pasarela de pago real"). No hay 'pending' ni 'failed' porque
-- v1 no tiene ningún camino que los produzca — checkout_appointment()
-- (siguiente migración) o registra el pago completo, o no registra nada
-- (revierte la transacción entera si el monto no alcanza, tarea 5.8). El
-- día que se conecte una pasarela real, esos estados sí hacen falta.
create type payment_status as enum ('approved', 'simulated_approved');

create table payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  sale_id uuid not null references sales(id),
  method payment_method not null,
  amount_cents integer not null check (amount_cents > 0),
  -- Referencia del pago: para efectivo queda vacía (no aplica); para los
  -- métodos simulados, checkout_appointment() genera una referencia falsa
  -- reconocible (empieza con "SIM-") para que nunca se confunda con una
  -- referencia real de una pasarela de verdad si algún día coexisten.
  reference text,
  status payment_status not null,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger payments_set_updated_at
  before update on payments
  for each row execute function app.set_updated_at();

create trigger payments_audit
  after insert or update or delete on payments
  for each row execute function app.log_change();

create index payments_tenant_sale_idx on payments (tenant_id, sale_id);

alter table payments enable row level security;
alter table payments force row level security;

-- Mismo patrón que sale_items: el acceso sigue al de la venta.
create policy payments_select on payments for select
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and exists (
      select 1 from sales s
      where s.id = payments.sale_id
        and app.can_access_branch(s.branch_id)
    )
  );

create policy payments_insert on payments for insert
  to authenticated
  with check (
    app.is_member_of(tenant_id) and app.role_in(tenant_id) in ('owner', 'receptionist')
  );

-- Sin política de UPDATE ni DELETE (mismo criterio que sale_items): un pago
-- ya registrado no se edita ni se borra — es un hecho contable. Corregir un
-- cobro mal hecho es cancelar la venta completa (sales.status = 'cancelled'),
-- no editar un pago suelto.
