-- Fase 28 (PLAN.md D30, punto 3): receta médica ligada a la consulta, con la cédula
-- profesional de quien la emite.
--
-- =============================================================================
-- Qué cambia
-- =============================================================================
--   * employee_details.professional_license: la cédula del veterinario (o del dueño que
--     ejerce). Se captura una vez, al dar de alta o editar al empleado.
--   * prescriptions + prescription_items: la receta de una cita de veterinaria. Una por
--     cita; renglones con medicamento, dosis, frecuencia y duración. El medicamento viene
--     del catálogo de productos (`product_id`) o es texto libre (`product_id` nulo).
--   * save_prescription(): única forma de escribirla. Revalida quién es y que tenga cédula.
--   * list_unregistered_medications() / resolve_unregistered_medication(): el aviso al
--     dueño del negocio de los medicamentos de texto libre, para registrarlos o descartarlos.
--
-- =============================================================================
-- Por qué solo por RPC
-- =============================================================================
-- Igual que appointment_products (11.12): la receta lleva una COPIA de la cédula y del
-- nombre de quien la emite al momento de emitirla, y esa copia no debe poder ser escrita
-- desde el navegador. Sin política de INSERT/UPDATE para usuarios, solo la función escribe.
--
-- Es EXPEDIENTE (§8.5): nunca se borra. Al corregir una receta, los renglones anteriores
-- se ocultan (`deleted_at`) y la bitácora guarda cómo estaban; `prevent_hard_delete()`
-- cubre el DELETE aun con service_role.
--
-- Migración ADITIVA (§8.1): una columna nullable y tablas nuevas.

-- =============================================================================
-- Cédula profesional
-- =============================================================================
-- Texto, sin `check` de formato en la base (mismo criterio que curp y rfc): la forma
-- (7 u 8 dígitos) la valida lib/validation.ts.
alter table employee_details add column professional_license text;

-- =============================================================================
-- prescriptions
-- =============================================================================
create table prescriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  branch_id uuid not null references branches(id),
  -- Una receta por cita: se corrige, no se duplica.
  appointment_id uuid not null unique references appointments(id),
  pet_id uuid not null references pets(id),
  -- Folio consecutivo POR NEGOCIO (la receta es del veterinario, no de la caja).
  folio integer not null,
  issued_by_user_id uuid not null references auth.users(id),
  -- COPIA de quién la emitió y con qué cédula: reimprimir una receta vieja no cambia si
  -- después corrigen el nombre o la cédula (mismo criterio que `name_snapshot`, §6.3).
  issuer_name_snapshot text not null,
  issuer_license_snapshot text not null,
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index prescriptions_tenant_folio_key on prescriptions (tenant_id, folio);
create index prescriptions_tenant_pet_idx on prescriptions (tenant_id, pet_id);

-- =============================================================================
-- prescription_items
-- =============================================================================
create table prescription_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  prescription_id uuid not null references prescriptions(id),
  position smallint not null default 0,
  -- Nulo = el veterinario lo escribió a mano (no está en el catálogo).
  product_id uuid references products(id),
  -- El nombre se COPIA aunque haya producto: si luego renombran o ocultan el producto, la
  -- receta ya emitida dice lo mismo.
  medication_name text not null check (length(btrim(medication_name)) > 0),
  dose text,
  frequency text,
  duration text,
  -- El dueño del negocio ya revisó este medicamento no registrado y decidió no darlo de alta.
  review_dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index prescription_items_tenant_rx_idx on prescription_items (tenant_id, prescription_id);
-- Para el aviso de medicamentos sin registrar: solo los renglones pendientes.
create index prescription_items_unregistered_idx on prescription_items (tenant_id)
  where product_id is null and review_dismissed_at is null and deleted_at is null;

-- Triggers: fecha de modificación, bitácora (§8.6), solo-lectura de negocio (§6.8) y sin DELETE.
create trigger prescriptions_set_updated_at before update on prescriptions
  for each row execute function app.set_updated_at();
create trigger prescription_items_set_updated_at before update on prescription_items
  for each row execute function app.set_updated_at();

create trigger prescriptions_audit after insert or update or delete on prescriptions
  for each row execute function app.log_change();
create trigger prescription_items_audit after insert or update or delete on prescription_items
  for each row execute function app.log_change();

create trigger enforce_tenant_writable before insert or update on prescriptions
  for each row execute function app.enforce_tenant_writable();
create trigger enforce_tenant_writable before insert or update on prescription_items
  for each row execute function app.enforce_tenant_writable();

create trigger prescriptions_prevent_hard_delete before delete on prescriptions
  for each row execute function app.prevent_hard_delete();
create trigger prescription_items_prevent_hard_delete before delete on prescription_items
  for each row execute function app.prevent_hard_delete();

-- =============================================================================
-- RLS (§7.3)
-- =============================================================================
-- Lectura: dueño y veterinario, igual que medical_records (la receta dice qué se le dio a
-- la mascota: es expediente clínico). Recepción y groomer no la leen.
-- Sin política de INSERT/UPDATE/DELETE: se escribe solo por save_prescription().
alter table prescriptions enable row level security;
alter table prescriptions force row level security;
alter table prescription_items enable row level security;
alter table prescription_items force row level security;

create policy prescriptions_select on prescriptions for select
  to authenticated
  using (app.is_member_of(tenant_id) and app.role_in(tenant_id) in ('owner', 'vet'));

-- Los renglones ocultos por una corrección no se leen. Aquí SÍ se puede filtrar
-- `deleted_at` en SELECT: los usuarios no tienen UPDATE (la trampa de §7.2 no aplica).
create policy prescription_items_select on prescription_items for select
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and app.role_in(tenant_id) in ('owner', 'vet')
    and deleted_at is null
  );

comment on table prescriptions is
  'Receta de una cita de veterinaria (una por cita), con copia de la cédula de quien la emitió. Solo se escribe con save_prescription().';
comment on table prescription_items is
  'Renglones de una receta: medicamento (de catálogo o texto libre), dosis, frecuencia y duración.';

-- =============================================================================
-- save_prescription(): emite o corrige la receta de una cita
-- =============================================================================
-- p_items: arreglo JSON de { product_id?, medication_name, dose?, frequency?, duration? }.
-- Reemplaza TODOS los renglones: los anteriores se ocultan y entran los nuevos (una
-- receta se corrige completa, como se imprime).
--
-- Quién puede (regla igual a la de medical_records_insert): el dueño, o el veterinario
-- ASIGNADO a la cita. Y solo si tiene cédula capturada: sin ella la receta no se emite.
create function save_prescription(p_appointment_id uuid, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_appointment appointments;
  v_license text;
  v_issuer_name text;
  v_prescription prescriptions;
  v_item jsonb;
  v_index integer := 0;
  v_name text;
  v_product_id uuid;
  v_folio integer;
begin
  select * into v_appointment
    from appointments
   where id = p_appointment_id and deleted_at is null;
  if not found then
    raise exception 'La cita no existe.' using errcode = 'no_data_found';
  end if;

  -- Revalidación primero (§7.3.4).
  if not app.is_member_of(v_appointment.tenant_id) then
    raise exception 'No perteneces a este negocio.' using errcode = 'insufficient_privilege';
  end if;

  if not (
    app.role_in(v_appointment.tenant_id) = 'owner'
    or (app.role_in(v_appointment.tenant_id) = 'vet' and v_appointment.employee_user_id = auth.uid())
  ) then
    raise exception 'Solo el veterinario de la cita o el dueño pueden emitir la receta.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_appointment.kind <> 'veterinary' then
    raise exception 'Solo las citas de veterinaria llevan receta.' using errcode = 'check_violation';
  end if;

  if v_appointment.status = 'cancelled' then
    raise exception 'La cita está cancelada: no admite receta.' using errcode = 'check_violation';
  end if;

  -- La cédula de quien emite, de SU ficha en este negocio.
  select nullif(btrim(ed.professional_license), ''), p.full_name
    into v_license, v_issuer_name
    from memberships m
    join profiles p on p.id = m.user_id
    left join employee_details ed
      on ed.membership_id = m.id and ed.deleted_at is null
   where m.tenant_id = v_appointment.tenant_id
     and m.user_id = auth.uid()
     and m.deleted_at is null
     and m.is_active;

  if v_license is null then
    raise exception 'Falta tu cédula profesional: captúrala en tu ficha de empleado (o pídele al dueño que lo haga) para poder emitir recetas.'
      using errcode = 'check_violation', hint = 'license_required';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agrega al menos un medicamento a la receta.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_items) > 30 then
    raise exception 'Una receta no puede llevar más de 30 medicamentos.' using errcode = 'check_violation';
  end if;

  -- Folio consecutivo por negocio. El candado evita que dos recetas simultáneas tomen el
  -- mismo número (el índice único lo rechazaría, pero con un error feo).
  perform pg_advisory_xact_lock(hashtext('prescription_folio:' || v_appointment.tenant_id::text));

  select * into v_prescription from prescriptions where appointment_id = p_appointment_id;
  if found then
    update prescriptions
       set issued_by_user_id = auth.uid(),
           issuer_name_snapshot = v_issuer_name,
           issuer_license_snapshot = v_license
     where id = v_prescription.id;

    -- La corrección oculta los renglones anteriores (expediente: no se borran).
    update prescription_items
       set deleted_at = now()
     where prescription_id = v_prescription.id and deleted_at is null;
  else
    select coalesce(max(folio), 0) + 1 into v_folio
      from prescriptions where tenant_id = v_appointment.tenant_id;

    insert into prescriptions (
      tenant_id, branch_id, appointment_id, pet_id, folio,
      issued_by_user_id, issuer_name_snapshot, issuer_license_snapshot
    )
    values (
      v_appointment.tenant_id, v_appointment.branch_id, v_appointment.id, v_appointment.pet_id,
      v_folio, auth.uid(), v_issuer_name, v_license
    )
    returning * into v_prescription;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_index := v_index + 1;
    v_name := btrim(coalesce(v_item->>'medication_name', ''));
    if v_name = '' then
      raise exception 'El medicamento % no tiene nombre.', v_index using errcode = 'check_violation';
    end if;

    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    -- Esta función salta RLS: el producto debe ser de ESTE negocio.
    if v_product_id is not null and not exists (
      select 1 from products
       where id = v_product_id and tenant_id = v_appointment.tenant_id and deleted_at is null
    ) then
      raise exception 'El producto del medicamento % no existe.', v_index using errcode = 'check_violation';
    end if;

    insert into prescription_items (
      tenant_id, prescription_id, position, product_id, medication_name, dose, frequency, duration
    )
    values (
      v_appointment.tenant_id, v_prescription.id, v_index, v_product_id, v_name,
      nullif(btrim(coalesce(v_item->>'dose', '')), ''),
      nullif(btrim(coalesce(v_item->>'frequency', '')), ''),
      nullif(btrim(coalesce(v_item->>'duration', '')), '')
    );
  end loop;

  return v_prescription.id;
end;
$$;

comment on function save_prescription(uuid, jsonb) is
  'Emite o corrige la receta de una cita de veterinaria. Solo el dueño o el veterinario de la cita, y solo con cédula capturada. Reemplaza los renglones anteriores.';

-- =============================================================================
-- Medicamentos de texto libre sin registrar (aviso al dueño del negocio)
-- =============================================================================
-- Agrupa por nombre normalizado (sin acentos ni mayúsculas, la ñ aparte) para que
-- "amoxicilina" y "Amoxicilina " cuenten como uno.
create function list_unregistered_medications()
returns table (medication_name text, times_prescribed integer, last_prescribed_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  -- Una persona puede ser dueña de más de un negocio: se devuelven los de todos sus
  -- negocios donde lo es (cada fila ya es de uno solo, por el group by).
  return query
  select min(pi.medication_name)::text,
         count(*)::integer,
         max(pi.created_at)
    from prescription_items pi
   where pi.product_id is null
     and pi.review_dismissed_at is null
     and pi.deleted_at is null
     and app.is_member_of(pi.tenant_id)
     and app.role_in(pi.tenant_id) = 'owner'
   group by pi.tenant_id, app.search_norm(pi.medication_name)
   order by max(pi.created_at) desc;
end;
$$;

comment on function list_unregistered_medications() is
  'Medicamentos de texto libre recetados que no están en el catálogo, agrupados por nombre. Solo para el dueño del negocio.';

-- Registra (con un producto) o descarta (sin producto) un medicamento no registrado.
-- Aplica a todos los renglones pendientes con ese nombre del negocio.
create function resolve_unregistered_medication(
  p_tenant_id uuid,
  p_medication_name text,
  p_product_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_count integer;
begin
  if not app.is_member_of(p_tenant_id) or app.role_in(p_tenant_id) <> 'owner' then
    raise exception 'Solo el dueño del negocio puede revisar los medicamentos sin registrar.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_product_id is not null and not exists (
    select 1 from products where id = p_product_id and tenant_id = p_tenant_id and deleted_at is null
  ) then
    raise exception 'El producto no existe.' using errcode = 'check_violation';
  end if;

  update prescription_items
     set product_id = coalesce(p_product_id, product_id),
         review_dismissed_at = case when p_product_id is null then now() else review_dismissed_at end
   where tenant_id = p_tenant_id
     and product_id is null
     and review_dismissed_at is null
     and deleted_at is null
     and app.search_norm(medication_name) = app.search_norm(p_medication_name);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function resolve_unregistered_medication(uuid, text, uuid) is
  'El dueño liga un medicamento de texto libre a un producto del catálogo, o lo descarta del aviso (sin producto).';

-- Permisos de ejecución: nada para anon ni PUBLIC; solo `authenticated`.
revoke execute on function save_prescription(uuid, jsonb) from public, anon;
revoke execute on function list_unregistered_medications() from public, anon;
revoke execute on function resolve_unregistered_medication(uuid, text, uuid) from public, anon;
grant execute on function save_prescription(uuid, jsonb) to authenticated;
grant execute on function list_unregistered_medications() to authenticated;
grant execute on function resolve_unregistered_medication(uuid, text, uuid) to authenticated;
