-- Correcciones 1, tarea C1.4 (PLAN.md D26 punto 4): dar de alta un cliente CON
-- su mascota en una sola transacción.
--
-- =============================================================================
-- Por qué una función de la base y no dos inserts desde el navegador
-- =============================================================================
-- Hoy la pantalla hace `customers.create()` y luego `pets.create()`. Son dos
-- peticiones separadas: si la segunda falla (conexión, dato inválido), el
-- cliente YA quedó guardado sin mascota, justo lo que la regla "toda alta lleva
-- mascota" quiere evitar. Una función de Postgres corre en UNA transacción:
-- si cualquier paso falla, no se guarda NADA (ni el cliente).
--
-- Alcance: es una regla del ALTA, no un invariante de la tabla. Un cliente
-- puede quedarse sin mascotas si luego se eliminan (delete_pet).
--
-- Seguridad (CLAUDE.md §7.3, regla 4):
--   * SECURITY DEFINER, con search_path fijo.
--   * La PRIMERA línea revalida membresía y rol (dueño o recepción), igual que
--     las políticas de INSERT de customers y pets (un groomer o un vet no dan
--     de alta clientes).
--   * EXECUTE solo para authenticated; anon y PUBLIC quedan fuera.
-- Por qué DEFINER y no INVOKER: con INVOKER las políticas RLS ya bastarían, pero
-- el proyecto usa DEFINER + revalidación explícita en toda RPC de escritura
-- (delete_customer, create_appointment...), así la regla queda visible en una
-- sola función y no repartida en dos políticas.
--
-- Lo que sigue funcionando solo, sin repetirlo aquí:
--   * El correo repetido (C1.3) lo rechaza el trigger de customers: la
--     excepción aborta la función completa y no queda ni cliente ni mascota.
--   * Un negocio en solo lectura lo rechaza el trigger enforce_tenant_writable
--     (auth.uid() sigue siendo la persona que llama aunque la función sea
--     DEFINER, porque sale del JWT de la petición).
--   * La bitácora (audit_log) registra a la persona real como actor.
--
-- Devuelve un jsonb { "customer": {...fila...}, "pet": {...fila...} } para que
-- el service tenga ambos registros sin una segunda consulta.
--
-- Migración aditiva (§8.1): solo una función nueva.

create function create_customer_with_pet(
  p_tenant_id uuid,
  -- Cliente
  p_first_name text,
  p_last_name text,
  p_phone text default null,
  p_email text default null,
  p_notes text default null,
  p_rfc text default null,
  p_legal_name text default null,
  p_tax_regime_code text default null,
  p_cfdi_use text default null,
  p_postal_code text default null,
  p_requires_invoice boolean default false,
  -- Mascota
  p_pet_name text default null,
  p_pet_species pet_species default null,
  p_pet_breed text default null,
  p_pet_sex pet_sex default null,
  p_pet_birth_date date default null,
  p_pet_is_sterilized boolean default false,
  p_pet_grooming_notes text default null,
  p_pet_medical_alerts text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_customer customers;
  v_pet pets;
begin
  -- Revalidación primero (§7.3.4): membresía y rol, antes de leer o escribir.
  if not app.is_member_of(p_tenant_id) then
    raise exception 'No perteneces a este negocio.' using errcode = 'insufficient_privilege';
  end if;

  if app.role_in(p_tenant_id) not in ('owner', 'receptionist') then
    raise exception 'No tienes permiso para dar de alta clientes.' using errcode = 'insufficient_privilege';
  end if;

  -- Validaciones de forma. La mascota es OBLIGATORIA en el alta: nombre y
  -- especie como mínimo. Se validan aquí (y no solo con los NOT NULL de la
  -- tabla) para dar mensajes en español que la interfaz pueda mostrar tal cual.
  if p_first_name is null or btrim(p_first_name) = '' then
    raise exception 'El nombre del cliente es obligatorio.' using errcode = 'check_violation';
  end if;

  if p_last_name is null or btrim(p_last_name) = '' then
    raise exception 'El apellido del cliente es obligatorio.' using errcode = 'check_violation';
  end if;

  if p_pet_name is null or btrim(p_pet_name) = '' then
    raise exception 'El nombre de la mascota es obligatorio.' using errcode = 'check_violation';
  end if;

  if p_pet_species is null then
    raise exception 'La especie de la mascota es obligatoria.' using errcode = 'check_violation';
  end if;

  -- Si el correo ya está en uso, el trigger de customers lanza 23505 aquí y la
  -- transacción completa se deshace.
  insert into customers (
    tenant_id, first_name, last_name, phone, email, notes,
    rfc, legal_name, tax_regime_code, cfdi_use, postal_code, requires_invoice
  )
  values (
    p_tenant_id, btrim(p_first_name), btrim(p_last_name), p_phone, p_email, p_notes,
    p_rfc, p_legal_name, p_tax_regime_code, p_cfdi_use, p_postal_code,
    coalesce(p_requires_invoice, false)
  )
  returning * into v_customer;

  insert into pets (
    tenant_id, customer_id, name, species, breed, sex, birth_date,
    is_sterilized, grooming_notes, medical_alerts
  )
  values (
    p_tenant_id, v_customer.id, btrim(p_pet_name), p_pet_species, p_pet_breed, p_pet_sex,
    p_pet_birth_date, coalesce(p_pet_is_sterilized, false), p_pet_grooming_notes,
    p_pet_medical_alerts
  )
  returning * into v_pet;

  return jsonb_build_object('customer', to_jsonb(v_customer), 'pet', to_jsonb(v_pet));
end;
$$;

comment on function create_customer_with_pet(uuid, text, text, text, text, text, text, text, text, text, text, boolean, text, pet_species, text, pet_sex, date, boolean, text, text) is
  'Da de alta un cliente y su mascota (obligatoria) en una sola transacción. Revalida membresía y rol dueño/recepción. Devuelve {customer, pet}. Si la mascota es inválida o el correo ya existe (C1.3), no se guarda nada.';

revoke execute on function create_customer_with_pet(uuid, text, text, text, text, text, text, text, text, text, text, boolean, text, pet_species, text, pet_sex, date, boolean, text, text) from public, anon;
grant execute on function create_customer_with_pet(uuid, text, text, text, text, text, text, text, text, text, text, boolean, text, pet_species, text, pet_sex, date, boolean, text, text) to authenticated;
