-- Datos de ejemplo para desarrollo local y para las demos.
-- SIEMPRE ficticios — nunca información real de un cliente (CLAUDE.md
-- §8.7). Este archivo se recarga por completo con "supabase db reset"
-- (que corre todas las migraciones desde cero y luego este archivo).
--
-- Contraseña de los 4 usuarios de demo (todos la misma, solo para local):
-- Demo1234!
--
-- Los usuarios de Auth se insertan directo en auth.users / auth.identities
-- en vez de usar la API de registro. Es el patrón estándar para sembrar
-- usuarios en desarrollo local: seed.sql es SQL puro, corre dentro de
-- "supabase db reset" sin depender de que la API esté arriba todavía. En
-- producción los usuarios SIEMPRE se crean por el flujo normal de
-- login/invitación — esto es exclusivo de datos de demo.
do $$
declare
  -- Ids FIJOS (no gen_random_uuid) para tenants, sucursales y usuarios de
  -- demo. A propósito: los tests de RLS (supabase/tests/) necesitan poder
  -- referenciar "el tenant B" o "la sucursal de Tijuana" sin tener que
  -- consultarlos primero, y así también se pueden citar en el README para
  -- pruebas manuales. La lista completa vive espejada en
  -- supabase/tests/fixtures.ts — si cambias un id aquí, cámbialo allá.
  v_tenant_patitas   uuid := 'b0000000-0000-4000-8000-000000000001';
  v_tenant_huellitas uuid := 'b0000000-0000-4000-8000-000000000002';

  v_branch_centro    uuid := 'c0000000-0000-4000-8000-000000000001';
  v_branch_delvalle  uuid := 'c0000000-0000-4000-8000-000000000002';
  v_branch_tijuana   uuid := 'c0000000-0000-4000-8000-000000000003';

  v_user_dueno     uuid := 'a0000000-0000-4000-8000-000000000001';
  v_user_recepcion uuid := 'a0000000-0000-4000-8000-000000000002';
  v_user_groomer   uuid := 'a0000000-0000-4000-8000-000000000003';
  v_user_vet       uuid := 'a0000000-0000-4000-8000-000000000004';

  v_membership_recepcion uuid;
  v_membership_groomer   uuid;
  v_membership_vet       uuid;

  v_demo_password text := 'Demo1234!';
begin
  -- ===========================================================================
  -- Tenants
  -- ===========================================================================
  insert into tenants (id, name, legal_name, rfc, tax_regime_code, postal_code, default_cfdi_use, timezone)
  values (
    v_tenant_patitas, 'Patitas Felices', 'Patitas Felices S.A. de C.V.',
    'PFE120515AB1', '601', '03100', 'G03', 'America/Mexico_City'
  );

  insert into tenants (id, name, legal_name, rfc, tax_regime_code, postal_code, default_cfdi_use, timezone)
  values (
    v_tenant_huellitas, 'Huellitas Spa', 'Huellitas Spa S. de R.L. de C.V.',
    'HSP180222XY2', '621', '22420', 'G03', 'America/Tijuana'
  );

  -- ===========================================================================
  -- Branches
  -- ===========================================================================
  insert into branches (id, tenant_id, name, address, postal_code, phone, timezone)
  values (
    v_branch_centro, v_tenant_patitas, 'Sucursal Centro',
    'Av. Insurgentes Sur 100, Col. Roma Norte, CDMX', '06700', '5555550101',
    'America/Mexico_City'
  );

  insert into branches (id, tenant_id, name, address, postal_code, phone, timezone)
  values (
    v_branch_delvalle, v_tenant_patitas, 'Sucursal Del Valle',
    'Av. Universidad 450, Col. Del Valle, CDMX', '03100', '5555550102',
    'America/Mexico_City'
  );

  -- Tijuana a propósito: es la excepción al "México ya no tiene horario de
  -- verano" (CLAUDE.md §8.3) — la franja fronteriza lo sigue aplicando
  -- para alinearse con EE. UU. Da un caso real con el que probar
  -- lib/datetime.ts en la fase 3.
  insert into branches (id, tenant_id, name, address, postal_code, phone, timezone)
  values (
    v_branch_tijuana, v_tenant_huellitas, 'Huellitas Spa Zona Río',
    'Blvd. Agua Caliente 4558, Tijuana, B.C.', '22420', '6646660303',
    'America/Tijuana'
  );

  -- ===========================================================================
  -- Usuarios de Auth (los 4 de demo, todos en Patitas Felices)
  -- ===========================================================================
  -- Huellitas Spa se deja sin personal a propósito: en v1 solo existe para
  -- (a) probar el aislamiento entre tenants en los tests de RLS, y (b) dar
  -- una sucursal real en otra zona horaria (ver arriba). No forma parte
  -- del recorrido de demo con dueños de negocio.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values
    ('00000000-0000-0000-0000-000000000000', v_user_dueno, 'authenticated', 'authenticated',
     'dueno@patitasfelices.mx', extensions.crypt(v_demo_password, extensions.gen_salt('bf')),
     now(), '{"provider":"email","providers":["email"]}'::jsonb,
     jsonb_build_object('full_name', 'Fernanda Ruiz Gómez'),
     now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_user_recepcion, 'authenticated', 'authenticated',
     'recepcion@patitasfelices.mx', extensions.crypt(v_demo_password, extensions.gen_salt('bf')),
     now(), '{"provider":"email","providers":["email"]}'::jsonb,
     jsonb_build_object('full_name', 'Karla Sánchez López'),
     now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_user_groomer, 'authenticated', 'authenticated',
     'groomer@patitasfelices.mx', extensions.crypt(v_demo_password, extensions.gen_salt('bf')),
     now(), '{"provider":"email","providers":["email"]}'::jsonb,
     jsonb_build_object('full_name', 'Lupita Hernández Mora'),
     now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_user_vet, 'authenticated', 'authenticated',
     'vet@patitasfelices.mx', extensions.crypt(v_demo_password, extensions.gen_salt('bf')),
     now(), '{"provider":"email","providers":["email"]}'::jsonb,
     jsonb_build_object('full_name', 'Dr. Manuel Torres Vidal'),
     now(), now(), '', '', '', '');

  -- auth.identities: GoTrue lo consulta para resolver el login por
  -- email/contraseña. "identity_data" necesita al menos "sub" (el id de
  -- usuario) y "email" para que arme la sesión correctamente.
  insert into auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
  values
    (gen_random_uuid(), v_user_dueno::text, v_user_dueno,
     jsonb_build_object('sub', v_user_dueno::text, 'email', 'dueno@patitasfelices.mx'),
     'email', now(), now()),
    (gen_random_uuid(), v_user_recepcion::text, v_user_recepcion,
     jsonb_build_object('sub', v_user_recepcion::text, 'email', 'recepcion@patitasfelices.mx'),
     'email', now(), now()),
    (gen_random_uuid(), v_user_groomer::text, v_user_groomer,
     jsonb_build_object('sub', v_user_groomer::text, 'email', 'groomer@patitasfelices.mx'),
     'email', now(), now()),
    (gen_random_uuid(), v_user_vet::text, v_user_vet,
     jsonb_build_object('sub', v_user_vet::text, 'email', 'vet@patitasfelices.mx'),
     'email', now(), now());

  -- El trigger on_auth_user_created (migración profile_on_signup) ya creó
  -- las 4 filas en public.profiles en el mismo INSERT de arriba — no hace
  -- falta insertarlas aquí.

  -- ===========================================================================
  -- Memberships
  -- ===========================================================================
  -- El dueño no necesita filas en membership_branches: ve todas las
  -- sucursales de su tenant por rol (CLAUDE.md §6.1).
  insert into memberships (id, tenant_id, user_id, role)
  values (gen_random_uuid(), v_tenant_patitas, v_user_dueno, 'owner');

  insert into memberships (id, tenant_id, user_id, role)
  values (gen_random_uuid(), v_tenant_patitas, v_user_recepcion, 'receptionist')
  returning id into v_membership_recepcion;

  insert into memberships (id, tenant_id, user_id, role)
  values (gen_random_uuid(), v_tenant_patitas, v_user_groomer, 'groomer')
  returning id into v_membership_groomer;

  insert into memberships (id, tenant_id, user_id, role)
  values (gen_random_uuid(), v_tenant_patitas, v_user_vet, 'vet')
  returning id into v_membership_vet;

  -- Recepción y groomer trabajan en Centro; el veterinario en Del Valle —
  -- variedad de sucursal a propósito, útil para las demos de agenda
  -- (fase 3).
  insert into membership_branches (id, tenant_id, membership_id, branch_id)
  values
    (gen_random_uuid(), v_tenant_patitas, v_membership_recepcion, v_branch_centro),
    (gen_random_uuid(), v_tenant_patitas, v_membership_groomer, v_branch_centro),
    (gen_random_uuid(), v_tenant_patitas, v_membership_vet, v_branch_delvalle);
end $$;
