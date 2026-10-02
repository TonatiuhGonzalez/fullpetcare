-- Facturación (fase 11, tarea 11.17 / HMH Four #2045): `invoice_requests` pasa de
-- "lo que el SAT pediría" a una factura real con ciclo de vida.
--
-- Estados (columna `status`, ya existía como texto):
--   pending   solicitud creada (al cobrar o al pulsar "Facturar"); aún sin timbrar.
--             Si `error_message` trae algo, el último intento falló y se puede reintentar.
--   stamping  la Edge Function está timbrando ahora mismo (candado contra doble clic).
--   stamped   timbrada: tiene `fiscal_uuid`, XML y PDF.
--   cancelled cancelada ante el SAT. Es final.
--
-- Nunca se borra una factura (es un documento fiscal, igual que el expediente,
-- CLAUDE.md §8.5): se cancela. Todo cambio de estado lo hace la Edge Function
-- `invoicing` con service_role; los usuarios solo crean solicitudes 'pending'.
-- Migración aditiva (CLAUDE.md §8.1).

-- =============================================================================
-- 1. Columnas nuevas
-- =============================================================================
alter table invoice_requests
  -- Id de la factura en el PAC (para pedirle el PDF/XML o cancelarla).
  add column pac_invoice_id text,
  add column stamped_at timestamptz,
  -- Archivos guardados en el bucket privado `invoices`: {tenant_id}/{id}.xml|pdf
  add column xml_path text,
  add column pdf_path text,
  add column cancelled_at timestamptz,
  -- Motivo de cancelación del SAT: 01 con relación, 02 sin relación, 03 no se
  -- llevó a cabo, 04 global. Se guarda tal cual lo publica el SAT (§8.4).
  add column cancellation_reason_code text,
  -- Último error del PAC en español y sin datos sensibles; null si no hubo.
  add column error_message text;

alter table invoice_requests
  add constraint invoice_requests_status_check
    check (status in ('pending', 'stamping', 'stamped', 'cancelled')),
  add constraint invoice_requests_cancellation_reason_check
    check (cancellation_reason_code is null or cancellation_reason_code in ('01', '02', '03', '04')),
  -- Coherencia: una factura timbrada o cancelada SIEMPRE tiene su UUID fiscal.
  add constraint invoice_requests_stamped_has_uuid_check
    check (status in ('pending', 'stamping') or fiscal_uuid is not null),
  add constraint invoice_requests_cancelled_has_reason_check
    check (status <> 'cancelled' or (cancelled_at is not null and cancellation_reason_code is not null));

-- UN SOLO timbrado vivo por venta, garantizado por la base y no por la pantalla
-- (riesgo de la fase: timbrar dos veces). 'stamping' cuenta: dos doble-clics
-- simultáneos no pueden ganar los dos. Una factura cancelada libera la venta
-- (se puede volver a facturar: cancelar y sustituir).
create unique index invoice_requests_one_live_per_sale_idx
  on invoice_requests (sale_id)
  where status in ('stamping', 'stamped') and deleted_at is null;

-- =============================================================================
-- 2. Una factura timbrada no se edita ni se borra
-- =============================================================================
create function app.protect_stamped_invoice() returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Una cancelada es final.
  if old.status = 'cancelled' and (to_jsonb(new) - 'updated_at' - 'deleted_at')
       is distinct from (to_jsonb(old) - 'updated_at' - 'deleted_at') then
    raise exception 'Una factura cancelada ya no se puede modificar.' using errcode = 'check_violation';
  end if;

  -- Una timbrada solo puede pasar a 'cancelled' (y llenar los campos de la
  -- cancelación); los datos fiscales con los que se timbró no cambian nunca.
  if old.status = 'stamped' and (
       new.sale_id is distinct from old.sale_id
    or new.tenant_id is distinct from old.tenant_id
    or new.rfc is distinct from old.rfc
    or new.legal_name is distinct from old.legal_name
    or new.tax_regime_code is distinct from old.tax_regime_code
    or new.cfdi_use is distinct from old.cfdi_use
    or new.postal_code is distinct from old.postal_code
    or new.payment_form_code is distinct from old.payment_form_code
    or new.payment_method_code is distinct from old.payment_method_code
    or new.fiscal_uuid is distinct from old.fiscal_uuid
    or new.stamped_at is distinct from old.stamped_at
    or new.pac_invoice_id is distinct from old.pac_invoice_id
    or new.status not in ('stamped', 'cancelled')
  ) then
    raise exception 'Una factura timbrada no se puede modificar; solo cancelar.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function app.protect_stamped_invoice() from public, anon, authenticated;

-- Borrado físico: solo se tolera sobre una solicitud 'pending' (todavía no es un
-- documento fiscal: nunca llegó al SAT; las pruebas y los reintentos la limpian).
-- Cualquier otra —en proceso, timbrada o cancelada— es un documento fiscal y no
-- se borra jamás, ni con service_role (mismo criterio que app.prevent_hard_delete).
create function app.prevent_deleting_fiscal_invoice() returns trigger
language plpgsql
as $$
begin
  if old.status <> 'pending' then
    raise exception 'No se puede borrar una factura: es un documento fiscal, se cancela (CLAUDE.md §8.5).'
      using errcode = 'insufficient_privilege';
  end if;
  return old;
end;
$$;

revoke execute on function app.prevent_deleting_fiscal_invoice() from public, anon, authenticated;

create trigger invoice_requests_prevent_deleting_fiscal
  before delete on invoice_requests
  for each row execute function app.prevent_deleting_fiscal_invoice();

-- Aplica también a service_role: es el cinturón además del tirante (§8.5).
create trigger invoice_requests_protect_stamped
  before update on invoice_requests
  for each row execute function app.protect_stamped_invoice();

-- =============================================================================
-- 3. Los usuarios solo crean solicitudes 'pending', sin UUID ni archivos
-- =============================================================================
-- La política de INSERT original dejaba insertar cualquier `status`: ahora que
-- 'stamped' significa "tiene validez fiscal", alguien podría crear una "factura
-- timbrada" falsa con la API. Se reemplaza para exigir una solicitud limpia.
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
    and error_message is null
  );
-- Sin política de UPDATE ni DELETE para usuarios: los cambios de estado los
-- hace la Edge Function con service_role.

-- =============================================================================
-- 4. Permisos por defecto del módulo 'invoicing' (mismo criterio que 'inventory')
-- =============================================================================
-- Dueño todo, recepción ver y editar (quien cobra es quien factura), el resto nada.
insert into role_permissions (tenant_id, role, module, can_view, can_edit)
select t.id, r.role, 'invoicing', r.can_view, r.can_edit
from tenants t
cross join (values
  ('owner'::member_role, true, true),
  ('receptionist'::member_role, true, true),
  ('groomer'::member_role, false, false),
  ('vet'::member_role, false, false)
) as r(role, can_view, can_edit)
on conflict (tenant_id, role, module) do nothing;

-- =============================================================================
-- 5. Bucket privado `invoices` para el XML y el PDF
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoices', 'invoices', false, 5242880, array['application/xml', 'text/xml', 'application/pdf']);

-- Ruta: {tenant_id}/{invoice_request_id}.{xml|pdf}. El primer segmento es el
-- tenant (misma convención que pet-photos y employee-documents). Solo LECTURA
-- para usuarios con permiso 'invoicing'/'view'; los archivos los sube la Edge
-- Function con service_role, así que no hay política de INSERT/UPDATE/DELETE.
create policy invoices_storage_select on storage.objects for select
  to authenticated
  using (
    bucket_id = 'invoices'
    and app.has_permission((storage.foldername(name))[1]::uuid, 'invoicing', 'view')
  );

-- =============================================================================
-- 6. can_invoice(): ¿quien llama puede emitir o cancelar facturas?
-- =============================================================================
-- La usa la Edge Function `invoicing`, que escribe con service_role y por eso se
-- salta el bloqueo de "solo lectura" (§6.8): esta pregunta lo repite a mano.
-- Permiso 'invoicing'/'edit' (el dueño siempre) Y negocio no suspendido ni dado
-- de baja. Devuelve false, nunca error, si no es miembro (§7.3.4).
create function can_invoice(p_tenant_id uuid) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app.is_member_of(p_tenant_id)
     and app.has_permission(p_tenant_id, 'invoicing', 'edit')
     and app.tenant_access_level(p_tenant_id) in ('full', 'grace');
$$;

revoke execute on function can_invoice(uuid) from public, anon;
grant execute on function can_invoice(uuid) to authenticated;
