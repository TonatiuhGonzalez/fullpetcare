-- Configuración fiscal del negocio (fase 11, tarea 11.15 / HMH Four #2044).
--
-- Para emitir facturas cada negocio factura con SU propio RFC y SU propio
-- certificado, ante el PAC (el proveedor autorizado que timbra: Facturapi,
-- PLAN.md D16). Esta migración deja dos cosas:
--   1. `tenant_invoicing_settings`: lo mínimo que guardamos del lado del PAC
--      (el id de la organización del negocio allá y hasta cuándo vale su
--      certificado). El certificado (.cer/.key/contraseña) NO se guarda aquí
--      ni en Storage: pasa directo al PAC desde la Edge Function `invoicing`.
--   2. `update_tenant_fiscal_data()`: la forma en que el dueño captura RFC,
--      razón social, régimen y código postal en `tenants` (que hoy no tiene
--      política de UPDATE para nadie).
--
-- Migración aditiva (CLAUDE.md §8.1): no cambia ninguna tabla existente.

-- =============================================================================
-- 1. tenant_invoicing_settings (1 a 1 con tenants)
-- =============================================================================
create table tenant_invoicing_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  -- Id de la organización de este negocio en el PAC. Null hasta que la Edge
  -- Function la crea (la primera vez que el dueño guarda sus datos fiscales).
  pac_organization_id text check (pac_organization_id is null or length(btrim(pac_organization_id)) > 0),
  -- Serie de los folios fiscales (opcional; el PAC la maneja por organización).
  series text check (series is null or length(btrim(series)) > 0),
  -- Fin de vigencia del certificado digital. Null = todavía no hay uno
  -- cargado. Con esto se calcula "listo para facturar" (lib/fiscalSetup.ts);
  -- no hay un booleano guardado porque se quedaría desactualizado al vencer.
  csd_valid_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index tenant_invoicing_settings_tenant_key
  on tenant_invoicing_settings (tenant_id);

create trigger tenant_invoicing_settings_set_updated_at
  before update on tenant_invoicing_settings
  for each row execute function app.set_updated_at();

create trigger enforce_tenant_writable
  before insert or update on tenant_invoicing_settings
  for each row execute function app.enforce_tenant_writable();

create trigger tenant_invoicing_settings_audit
  after insert or update on tenant_invoicing_settings
  for each row execute function app.log_change();

alter table tenant_invoicing_settings enable row level security;
alter table tenant_invoicing_settings force row level security;

-- LECTURA: solo el dueño (la pantalla de configuración fiscal es suya).
-- Sin `deleted_at is null` por la trampa de CLAUDE.md §7.2.
create policy tenant_invoicing_settings_select on tenant_invoicing_settings for select
  to authenticated
  using (app.is_member_of(tenant_id) and app.role_in(tenant_id) = 'owner');

-- SIN política de INSERT/UPDATE/DELETE para usuarios: el id del PAC y la
-- vigencia del certificado solo los escribe la Edge Function `invoicing`
-- (service_role) después de que el PAC confirme. Si el dueño pudiera
-- escribirlos desde el navegador, podría marcar "certificado vigente" sin
-- haber subido nada.

comment on table tenant_invoicing_settings is
  'Estado de la facturación de un negocio ante el PAC: id de su organización y vigencia del certificado. El certificado en sí nunca se guarda.';

-- =============================================================================
-- 2. update_tenant_fiscal_data(): el dueño captura sus datos fiscales
-- =============================================================================
-- Por qué una RPC y no una política de UPDATE en `tenants`: RLS filtra filas,
-- no columnas (CLAUDE.md §6.8). Una política de UPDATE le dejaría al dueño
-- cambiar también `timezone` o `name` por la API. La función solo toca las
-- cuatro columnas fiscales y valida su forma.
--
-- SECURITY DEFINER: salta RLS para poder escribir `tenants`, así que revalida
-- adentro que quien llama es el dueño activo (CLAUDE.md §7.3.4).
create function update_tenant_fiscal_data(
  p_tenant_id uuid,
  p_rfc text,
  p_legal_name text,
  p_tax_regime_code text,
  p_postal_code text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rfc text := upper(btrim(p_rfc));
  v_old_rfc text;
begin
  -- app.role_in() ya exige membresía activa y negocio no bloqueado; devuelve
  -- null si no es miembro, y `null = 'owner'` no es verdadero.
  if app.role_in(p_tenant_id) is distinct from 'owner' then
    raise exception 'Solo el dueño puede cambiar los datos fiscales.' using errcode = '42501';
  end if;

  -- Misma forma que lib/validation.ts: 12 (empresa) o 13 (persona) caracteres.
  if v_rfc !~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$' then
    raise exception 'El RFC no tiene un formato válido.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_legal_name, ''))) = 0 then
    raise exception 'Falta la razón social.' using errcode = '22023';
  end if;
  -- Mismo catálogo que TAX_REGIMES en lib/fiscalSetup.ts.
  if p_tax_regime_code not in ('601', '603', '605', '606', '612', '621', '622', '626') then
    raise exception 'El régimen fiscal no es válido.' using errcode = '22023';
  end if;
  if p_postal_code !~ '^[0-9]{5}$' then
    raise exception 'El código postal debe tener 5 dígitos.' using errcode = '22023';
  end if;

  select rfc into v_old_rfc from tenants where id = p_tenant_id;

  update tenants
     set rfc = v_rfc,
         legal_name = btrim(p_legal_name),
         tax_regime_code = p_tax_regime_code,
         postal_code = p_postal_code
   where id = p_tenant_id;

  -- Un certificado digital se emite para UN RFC. Si el RFC cambia, el que ya
  -- estaba cargado deja de servir: se marca como "sin certificado" para que la
  -- pantalla pida subir el nuevo (y nunca quede "listo" con uno ajeno).
  if v_old_rfc is distinct from v_rfc then
    update tenant_invoicing_settings
       set csd_valid_until = null
     where tenant_id = p_tenant_id;
  end if;
end;
$$;

revoke execute on function update_tenant_fiscal_data(uuid, text, text, text, text) from public, anon;
grant execute on function update_tenant_fiscal_data(uuid, text, text, text, text) to authenticated;

-- =============================================================================
-- 3. can_manage_invoicing(): ¿quien llama puede configurar la facturación?
-- =============================================================================
-- La usa la Edge Function `invoicing` (que escribe con service_role, y por eso
-- se salta el trigger de "solo lectura" de §6.8). Esta pregunta repite esa
-- regla a mano: dueño activo Y negocio no suspendido ni dado de baja.
-- Devuelve false (nunca error) si no es miembro: así la función responde igual
-- "no tienes permiso" y no revela si el negocio existe (§7.3.4).
create function can_manage_invoicing(p_tenant_id uuid) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(app.role_in(p_tenant_id) = 'owner', false)
     and app.tenant_access_level(p_tenant_id) in ('full', 'grace');
$$;

revoke execute on function can_manage_invoicing(uuid) from public, anon;
grant execute on function can_manage_invoicing(uuid) to authenticated;
