-- Tabla invoice_requests: lo que el SAT pediría para facturar una venta
-- (CLAUDE.md §6.5, §8.4), aunque v1 no factura de verdad (CLAUDE.md §1,
-- "Fuera de alcance": "CFDI real"). Se crea con los datos fiscales del
-- cliente cuando marca "requiere factura" al cobrar (tarea 5.16); el día
-- que se conecte un PAC (Proveedor Autorizado de Certificación, el
-- intermediario que de verdad timbra un CFDI ante el SAT), ese proceso solo
-- necesita leer estas filas y llenar fiscal_uuid — la tabla ya tiene todo
-- lo demás.
--
-- Los códigos (tax_regime_code, cfdi_use, payment_form_code,
-- payment_method_code) se guardan como texto tal cual los publica el SAT
-- (CLAUDE.md §8.4) — "601", "G03", "01"... — nunca traducidos a un enum ni
-- a una tabla de catálogo propia: son catálogos del SAT, no del negocio, y
-- pueden cambiar sin que este proyecto se entere.
create table invoice_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  sale_id uuid not null references sales(id),
  rfc text not null,
  legal_name text not null,
  tax_regime_code text not null,
  cfdi_use text not null,
  postal_code text not null,
  -- c_FormaPago (01 efectivo, 04 tarjeta de crédito, 28 tarjeta de débito,
  -- 03 transferencia) y PUE/PPD (pago en una sola exhibición vs. en
  -- parcialidades) — campos que un PAC real exige, sin los cuales una
  -- factura ni se podría intentar timbrar el día que exista esa conexión.
  payment_form_code text not null,
  payment_method_code text not null,
  -- Sin enum (CLAUDE.md §11, "no legislar de más"): v1 solo produce el
  -- valor 'pending' (tarea 5.16) y no tiene ningún flujo que lo cambie —
  -- no hay abstracción especulativa de estados que hoy nadie usa.
  status text not null default 'pending',
  -- UUID Fiscal: el identificador que el PAC le asigna a un CFDI ya
  -- timbrado. Null en v1 siempre — se llena el día que exista esa
  -- integración real.
  fiscal_uuid uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger invoice_requests_set_updated_at
  before update on invoice_requests
  for each row execute function app.set_updated_at();

create trigger invoice_requests_audit
  after insert or update or delete on invoice_requests
  for each row execute function app.log_change();

create index invoice_requests_tenant_sale_idx on invoice_requests (tenant_id, sale_id);

alter table invoice_requests enable row level security;
alter table invoice_requests force row level security;

create policy invoice_requests_select on invoice_requests for select
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and exists (
      select 1 from sales s
      where s.id = invoice_requests.sale_id
        and app.can_access_branch(s.branch_id)
    )
  );

create policy invoice_requests_insert on invoice_requests for insert
  to authenticated
  with check (
    app.is_member_of(tenant_id) and app.role_in(tenant_id) in ('owner', 'receptionist')
  );

-- Sin política de UPDATE ni DELETE en v1: nada en el alcance actual
-- modifica una solicitud de factura después de creada (el día que se
-- conecte un PAC y haya que escribir fiscal_uuid, esa integración corre con
-- service_role, que no necesita política — CLAUDE.md §7.3 regla 2 aplica
-- igual: sin política, ni siquiera un rol autenticado normal puede tocarla).
