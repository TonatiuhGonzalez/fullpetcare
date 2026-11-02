-- Fase 16B (PLAN.md D31): cuenta del dueño de la mascota.
--
-- =============================================================================
-- Modelo
-- =============================================================================
-- El dueño inicia sesión con Supabase Auth (código por correo). Su usuario de Auth NO tiene
-- membresía en ningún negocio, así que TODAS las políticas RLS del personal lo niegan solas:
-- por la API directa no lee ninguna tabla de negocio. Lo único que ve lo devuelve la Edge
-- Function `customer-account` a través de las funciones `customer_account_*` de abajo, que
-- solo puede llamar `service_role` y que devuelven campos en LISTA BLANCA.
--
--   customer_accounts       Vínculo cuenta ↔ cliente (uno por negocio, un cliente una cuenta).
--   claim_customer_link()   Vincula con un link con token vigente: el link es la PRUEBA. Nunca
--                           se vincula por coincidencia de correo o teléfono.
--   unlink_customer_account()  El negocio desvincula (la persona ya no es su cliente).
--   customer_account_user_by_email()   Para la Edge Function: ¿es una cuenta de dueño?
--   customer_account_overview() / customer_account_pet_detail()  Lectura en lista blanca, con las
--                           reglas de visibilidad por periodo de la fase 31.
--
-- Migración ADITIVA (§8.1): una tabla nueva y funciones.

-- =============================================================================
-- customer_accounts
-- =============================================================================
create table customer_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  -- Al eliminar la cuenta (Edge Function) el vínculo se va con ella; el expediente del negocio
  -- no se toca (§8.5).
  user_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid not null,
  linked_via_link_id uuid references share_links(id),
  linked_at timestamptz not null default now(),
  -- Nulo = vínculo vigente. Desvincular conserva la fila (quién y cuándo).
  unlinked_at timestamptz,
  unlinked_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_accounts_customer_fkey
    foreign key (tenant_id, customer_id) references customers (tenant_id, id)
);

-- Una cuenta por negocio (decisión del usuario, D31 punto 1) y un cliente, una cuenta.
create unique index customer_accounts_user_tenant_key
  on customer_accounts (user_id, tenant_id) where unlinked_at is null;
create unique index customer_accounts_customer_key
  on customer_accounts (tenant_id, customer_id) where unlinked_at is null;
create index customer_accounts_user_idx on customer_accounts (user_id);

create trigger customer_accounts_set_updated_at before update on customer_accounts
  for each row execute function app.set_updated_at();
create trigger customer_accounts_audit after insert or update or delete on customer_accounts
  for each row execute function app.log_change();
create trigger enforce_tenant_writable before insert or update on customer_accounts
  for each row execute function app.enforce_tenant_writable();

alter table customer_accounts enable row level security;
alter table customer_accounts force row level security;

-- La persona ve sus propios vínculos; el personal que administra clientes ve los de su negocio
-- (para mostrar "cuenta vinculada" y poder desvincular). Sin política de escritura: solo las
-- funciones de abajo escriben.
create policy customer_accounts_select on customer_accounts for select
  to authenticated
  using (
    user_id = auth.uid()
    or (app.is_member_of(tenant_id) and app.role_in(tenant_id) in ('owner', 'receptionist'))
  );

comment on table customer_accounts is
  'Vínculo entre la cuenta de un dueño de mascota (auth.users sin membresía) y su cliente en un negocio.';

-- =============================================================================
-- claim_customer_link(): vincular con un link con token
-- =============================================================================
create function claim_customer_link(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_link share_links;
  v_pet pets;
  v_existing customer_accounts;
  v_account_id uuid;
  v_business text;
begin
  if auth.uid() is null then
    raise exception 'Inicia sesión para guardar la mascota en tu cuenta.' using errcode = 'insufficient_privilege';
  end if;
  if p_token is null or length(p_token) < 20 then
    raise exception 'Este link no es válido o ya venció.' using errcode = 'check_violation';
  end if;

  v_hash := encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');

  -- El mismo mensaje para token inexistente, revocado o vencido (§7.4): no se explica el motivo.
  select * into v_link
    from share_links
   where token_hash = v_hash and deleted_at is null and scope = 'pet'
     and revoked_at is null and expires_at > now();
  if not found then
    raise exception 'Este link no es válido o ya venció.' using errcode = 'check_violation';
  end if;

  select * into v_pet from pets where id = v_link.pet_id and tenant_id = v_link.tenant_id and deleted_at is null;
  if not found then
    raise exception 'Este link no es válido o ya venció.' using errcode = 'check_violation';
  end if;

  -- Ya estaba vinculado esta misma cuenta con este cliente: es idempotente.
  select * into v_existing
    from customer_accounts
   where tenant_id = v_pet.tenant_id and customer_id = v_pet.customer_id and unlinked_at is null;
  if found then
    if v_existing.user_id = auth.uid() then
      v_account_id := v_existing.id;
    else
      raise exception 'Este cliente ya está vinculado a otra cuenta. Pídele a tu veterinaria que lo desvincule.'
        using errcode = 'check_violation', hint = 'customer_already_linked';
    end if;
  else
    if exists (
      select 1 from customer_accounts
       where user_id = auth.uid() and tenant_id = v_pet.tenant_id and unlinked_at is null
    ) then
      raise exception 'Tu cuenta ya está vinculada a otro cliente de esta veterinaria.'
        using errcode = 'check_violation', hint = 'account_already_linked';
    end if;

    insert into customer_accounts (tenant_id, user_id, customer_id, linked_via_link_id)
    values (v_pet.tenant_id, auth.uid(), v_pet.customer_id, v_link.id)
    returning id into v_account_id;
  end if;

  select name into v_business from tenants where id = v_pet.tenant_id;
  return jsonb_build_object(
    'account_id', v_account_id,
    'tenant_id', v_pet.tenant_id,
    'business_name', v_business
  );
end;
$$;

comment on function claim_customer_link(text) is
  'Vincula la cuenta de quien llama con el cliente dueño de la mascota de un link con token vigente.';

-- =============================================================================
-- unlink_customer_account(): el negocio desvincula
-- =============================================================================
create function unlink_customer_account(p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from customers where id = p_customer_id;
  if not found then
    raise exception 'El cliente no existe.' using errcode = 'no_data_found';
  end if;
  if not app.is_member_of(v_tenant) or app.role_in(v_tenant) not in ('owner', 'receptionist') then
    raise exception 'No tienes permiso para desvincular cuentas.' using errcode = 'insufficient_privilege';
  end if;

  update customer_accounts
     set unlinked_at = now(), unlinked_by = auth.uid()
   where tenant_id = v_tenant and customer_id = p_customer_id and unlinked_at is null;
end;
$$;

-- =============================================================================
-- Funciones SOLO para la Edge Function (service_role)
-- =============================================================================

-- ¿Existe un usuario con este correo y es una cuenta de dueño? La Edge Function la usa para
-- NO mandar un código de acceso a una cuenta del personal por esta vía.
create function customer_account_user_by_email(p_email text)
returns table (user_id uuid, is_customer_account boolean)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select u.id,
         coalesce((u.raw_app_meta_data ->> 'customer_account')::boolean, false)
    from auth.users u
   where lower(u.email) = lower(btrim(p_email))
   limit 1;
$$;

-- Resumen: negocios vinculados, sus mascotas visibles hoy y sus próximas citas. Lista blanca.
create function customer_account_overview(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_result jsonb;
begin
  select coalesce(jsonb_agg(business order by business ->> 'business_name'), '[]'::jsonb)
    into v_result
    from (
      select jsonb_build_object(
        'tenant_id', t.id,
        'business_name', t.name,
        'business_timezone', t.timezone,
        'customer_id', ca.customer_id,
        'pets', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'id', p.id,
                   'name', p.name,
                   'species', p.species,
                   'breed', p.breed,
                   'sex', p.sex,
                   'birth_date', p.birth_date,
                   'photo_path', p.photo_path
                 ) order by p.name)
            from pets p
           where p.tenant_id = ca.tenant_id
             and p.deleted_at is null
             and app.customer_can_view_pet(ca.customer_id, p.id, now())
        ), '[]'::jsonb),
        'upcoming', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'pet_id', a.pet_id,
                   'pet_name', p.name,
                   'kind', a.kind,
                   'starts_at', a.starts_at,
                   'branch_name', b.name,
                   'branch_address', b.address,
                   'branch_phone', b.phone,
                   'branch_timezone', b.timezone
                 ) order by a.starts_at)
            from appointments a
            join pets p on p.id = a.pet_id
            join branches b on b.id = a.branch_id
           where a.tenant_id = ca.tenant_id
             and a.status = 'scheduled'
             and a.deleted_at is null
             and a.starts_at >= now()
             and p.deleted_at is null
             and app.customer_can_view_pet(ca.customer_id, p.id, now())
        ), '[]'::jsonb)
      ) as business
        from customer_accounts ca
        join tenants t on t.id = ca.tenant_id
       where ca.user_id = p_user_id
         and ca.unlinked_at is null
         -- Un negocio dado de baja ya no muestra nada.
         and app.tenant_access_level(t.id) <> 'blocked'
    ) x;

  return v_result;
end;
$$;

-- Detalle de una mascota: cartilla, visitas, próximas citas y hospitalización, filtrados por el
-- periodo en que la persona (o su familia) fue dueña, y con montos solo para quien le toca.
-- Devuelve NULL si la mascota no es visible para esa cuenta (el mismo resultado que "no existe").
create function customer_account_pet_detail(p_user_id uuid, p_pet_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_pet pets;
  v_customer_id uuid;
begin
  select * into v_pet from pets where id = p_pet_id and deleted_at is null;
  if not found then
    return null;
  end if;

  -- La cuenta debe estar vinculada a un cliente de ESE negocio.
  select ca.customer_id into v_customer_id
    from customer_accounts ca
   where ca.user_id = p_user_id and ca.tenant_id = v_pet.tenant_id and ca.unlinked_at is null;
  if v_customer_id is null then
    return null;
  end if;

  if app.tenant_access_level(v_pet.tenant_id) = 'blocked' then
    return null;
  end if;
  if not app.customer_can_view_pet(v_customer_id, v_pet.id, now()) then
    -- Dueño anterior: ve solo lo de su periodo (se filtra abajo por fecha). Si nunca lo fue, nada.
    if not exists (
      select 1 from pet_ownerships o
        join app.customer_circle(v_customer_id) c on c.customer_id = o.customer_id
       where o.pet_id = v_pet.id
    ) then
      return null;
    end if;
  end if;

  return jsonb_build_object(
    'tenant_id', v_pet.tenant_id,
    'business_name', (select name from tenants where id = v_pet.tenant_id),
    'pet', jsonb_build_object(
      'id', v_pet.id, 'name', v_pet.name, 'species', v_pet.species, 'breed', v_pet.breed,
      'sex', v_pet.sex, 'birth_date', v_pet.birth_date, 'photo_path', v_pet.photo_path
    ),
    'vaccinations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'vaccine_name', vc.name, 'applied_at', v.applied_at, 'next_due_date', v.next_due_date
             ) order by v.applied_at desc)
        from vaccinations v
        join vaccines vc on vc.id = v.vaccine_id
       where v.pet_id = v_pet.id
         and app.customer_can_view_pet(v_customer_id, v_pet.id, v.applied_at)
    ), '[]'::jsonb),
    'visits', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', a.kind,
               'starts_at', a.starts_at,
               'branch_timezone', b.timezone,
               'employee_name', pr.full_name,
               'detail', case a.kind
                 when 'grooming' then (select gr.cut_style from grooming_records gr where gr.appointment_id = a.id)
                 else (select mr.diagnosis from medical_records mr where mr.appointment_id = a.id)
               end
             ) order by a.starts_at desc)
        from appointments a
        join branches b on b.id = a.branch_id
        left join profiles pr on pr.id = a.employee_user_id
       where a.pet_id = v_pet.id
         and a.status = 'completed'
         and a.deleted_at is null
         and app.customer_can_view_pet(v_customer_id, v_pet.id, a.starts_at)
    ), '[]'::jsonb),
    'upcoming', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', a.kind, 'starts_at', a.starts_at,
               'branch_name', b.name, 'branch_address', b.address,
               'branch_phone', b.phone, 'branch_timezone', b.timezone
             ) order by a.starts_at)
        from appointments a
        join branches b on b.id = a.branch_id
       where a.pet_id = v_pet.id
         and a.status = 'scheduled'
         and a.deleted_at is null
         and a.starts_at >= now()
         and app.customer_can_view_pet(v_customer_id, v_pet.id, now())
    ), '[]'::jsonb),
    'hospital_stays', coalesce((
      select jsonb_agg(jsonb_build_object(
               'admitted_at', s.admitted_at,
               'discharged_at', s.discharged_at,
               'reason', s.reason,
               'branch_timezone', b.timezone,
               -- El costo, solo para quien le toca (el dueño de ese momento o el titular).
               'cost_cents', case
                 when app.customer_can_view_pet_money(v_customer_id, v_pet.id, s.admitted_at)
                 then (select c.amount_cents from app.hospital_stay_charge(s, coalesce(s.discharged_at, now())) c)
               end,
               'notes', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'noted_at', n.noted_at,
                          'content', n.content,
                          'temperature_deci_c', n.temperature_deci_c,
                          'weight_grams', n.weight_grams,
                          'heart_rate_bpm', n.heart_rate_bpm,
                          'mucous_color', n.mucous_color,
                          'mood', n.mood,
                          'elimination', n.elimination
                        ) order by n.noted_at desc)
                   from hospital_notes n
                  where n.stay_id = s.id
                    and app.customer_can_view_pet(v_customer_id, v_pet.id, n.noted_at)
               ), '[]'::jsonb),
               'medications', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'name', m.name_snapshot, 'quantity', m.quantity, 'administered_at', m.administered_at
                        ) order by m.administered_at)
                   from hospital_medications m
                  where m.stay_id = s.id and m.deleted_at is null
                    and app.customer_can_view_pet(v_customer_id, v_pet.id, m.administered_at)
               ), '[]'::jsonb)
             ) order by s.admitted_at desc)
        from hospital_stays s
        join branches b on b.id = s.branch_id
       where s.pet_id = v_pet.id
         and app.customer_can_view_pet(v_customer_id, v_pet.id, s.admitted_at)
    ), '[]'::jsonb)
  );
end;
$$;

-- Permisos (§7.3): las RPC de la persona y del personal para `authenticated`; las de lectura
-- y la consulta por correo SOLO para service_role (la Edge Function).
revoke execute on function claim_customer_link(text) from public, anon;
revoke execute on function unlink_customer_account(uuid) from public, anon;
grant execute on function claim_customer_link(text) to authenticated;
grant execute on function unlink_customer_account(uuid) to authenticated;

revoke execute on function customer_account_user_by_email(text) from public, anon, authenticated;
revoke execute on function customer_account_overview(uuid) from public, anon, authenticated;
revoke execute on function customer_account_pet_detail(uuid, uuid) from public, anon, authenticated;
grant execute on function customer_account_user_by_email(text) to service_role;
grant execute on function customer_account_overview(uuid) to service_role;
grant execute on function customer_account_pet_detail(uuid, uuid) to service_role;
