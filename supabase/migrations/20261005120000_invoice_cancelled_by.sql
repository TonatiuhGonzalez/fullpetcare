-- Quién canceló una factura (fase 11, HMH Four #2046).
--
-- La cancelación ya existía (invoice_requests_stamping.sql: estado, fecha y
-- motivo del SAT). Faltaba QUIÉN. No basta con la bitácora (`audit_log`): la
-- Edge Function escribe con service_role y ahí `auth.uid()` es nulo, así que la
-- bitácora registraría "nadie". Por eso la función guarda el id de la persona
-- que llamó (ya validada con su JWT) en esta columna.
alter table invoice_requests
  add column cancelled_by uuid references auth.users(id);

-- Una factura cancelada SIEMPRE dice quién la canceló (mismo criterio que la
-- fecha y el motivo): lo garantiza la base y no solo la función.
alter table invoice_requests
  add constraint invoice_requests_cancelled_has_actor_check
    check (status <> 'cancelled' or cancelled_by is not null);

-- Los usuarios no pueden crear solicitudes ya canceladas ni con actor: se
-- reemplaza la política de INSERT para exigir también `cancelled_by is null`.
drop policy invoice_requests_insert on invoice_requests;
create policy invoice_requests_insert on invoice_requests for insert
  to authenticated
  with check (
    app.is_member_of(tenant_id)
    and app.role_in(tenant_id) in ('owner', 'receptionist')
    and status = 'pending'
    and fiscal_uuid is null
    and pac_invoice_id is null
    and stamped_at is null
    and xml_path is null
    and pdf_path is null
    and cancelled_at is null
    and cancellation_reason_code is null
    and cancelled_by is null
    and error_message is null
  );
