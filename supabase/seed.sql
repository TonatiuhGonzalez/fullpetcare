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
  -- opening_hours: una entrada por día de la semana ('sunday'..'saturday',
  -- mismas claves que Date.getDay() en JS — ver lib/availability.ts
  -- #hoursForDate, fase 3). null = cerrado ese día. Lunes a sábado
  -- 09:00-18:00, domingo cerrado — horario típico de una estética/
  -- veterinaria mexicana chica.
  insert into branches (id, tenant_id, name, address, postal_code, phone, timezone, opening_hours)
  values (
    v_branch_centro, v_tenant_patitas, 'Sucursal Centro',
    'Av. Insurgentes Sur 100, Col. Roma Norte, CDMX', '06700', '5555550101',
    'America/Mexico_City',
    '{
      "sunday": null,
      "monday": {"opensAt": "09:00", "closesAt": "18:00"},
      "tuesday": {"opensAt": "09:00", "closesAt": "18:00"},
      "wednesday": {"opensAt": "09:00", "closesAt": "18:00"},
      "thursday": {"opensAt": "09:00", "closesAt": "18:00"},
      "friday": {"opensAt": "09:00", "closesAt": "18:00"},
      "saturday": {"opensAt": "09:00", "closesAt": "15:00"}
    }'::jsonb
  );

  insert into branches (id, tenant_id, name, address, postal_code, phone, timezone, opening_hours)
  values (
    v_branch_delvalle, v_tenant_patitas, 'Sucursal Del Valle',
    'Av. Universidad 450, Col. Del Valle, CDMX', '03100', '5555550102',
    'America/Mexico_City',
    '{
      "sunday": null,
      "monday": {"opensAt": "09:00", "closesAt": "18:00"},
      "tuesday": {"opensAt": "09:00", "closesAt": "18:00"},
      "wednesday": {"opensAt": "09:00", "closesAt": "18:00"},
      "thursday": {"opensAt": "09:00", "closesAt": "18:00"},
      "friday": {"opensAt": "09:00", "closesAt": "18:00"},
      "saturday": {"opensAt": "09:00", "closesAt": "15:00"}
    }'::jsonb
  );

  -- Tijuana a propósito: es la excepción al "México ya no tiene horario de
  -- verano" (CLAUDE.md §8.3) — la franja fronteriza lo sigue aplicando
  -- para alinearse con EE. UU. Da un caso real con el que probar
  -- lib/datetime.ts en la fase 3.
  insert into branches (id, tenant_id, name, address, postal_code, phone, timezone, opening_hours)
  values (
    v_branch_tijuana, v_tenant_huellitas, 'Huellitas Spa Zona Río',
    'Blvd. Agua Caliente 4558, Tijuana, B.C.', '22420', '6646660303',
    'America/Tijuana',
    '{
      "sunday": null,
      "monday": {"opensAt": "09:00", "closesAt": "18:00"},
      "tuesday": {"opensAt": "09:00", "closesAt": "18:00"},
      "wednesday": {"opensAt": "09:00", "closesAt": "18:00"},
      "thursday": {"opensAt": "09:00", "closesAt": "18:00"},
      "friday": {"opensAt": "09:00", "closesAt": "18:00"},
      "saturday": {"opensAt": "09:00", "closesAt": "15:00"}
    }'::jsonb
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

-- ===========================================================================
-- Clientes y mascotas (fase 2, tarea 2.6)
-- ===========================================================================
-- 8 clientes y 12 mascotas ficticias, repartidas entre los dos tenants:
-- 6 clientes / 9 mascotas en Patitas Felices (la que se usa en el
-- recorrido de demo), 2 clientes / 3 mascotas en Huellitas Spa — igual
-- que con las sucursales, lo mínimo necesario para que el aislamiento
-- entre tenants sea verificable de verdad en los tests de RLS (tarea
-- 2.11), no un tenant vacío que "por casualidad" no tiene nada que
-- filtrar. Ids fijos con el mismo criterio que el resto de la semilla
-- (ver supabase/tests/fixtures.ts).
insert into customers (id, tenant_id, first_name, last_name, phone, email, requires_invoice, rfc, legal_name, tax_regime_code, cfdi_use, postal_code)
values
  ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Sofía', 'Ramírez Castillo', '5512345601', 'sofia.ramirez@example.mx', false, null, null, null, null, null),
  ('d0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'Diego', 'Martínez Ortiz', '5512345602', 'diego.martinez@example.mx', false, null, null, null, null, null),
  ('d0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'Valentina', 'Cruz Mendoza', '5512345603', null, false, null, null, null, null, null),
  ('d0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001', 'Emiliano', 'Flores Vargas', '5512345604', 'emiliano.flores@example.mx', false, null, null, null, null, null),
  ('d0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000001', 'Camila', 'Herrera Soto', '5512345605', 'camila.herrera@example.mx', false, null, null, null, null, null),
  -- Único cliente de la semilla que factura — da un caso real con el que
  -- probar la sección fiscal de CustomerFormDialog (tarea 2.17) sin
  -- inventar datos al vuelo. RFC y demás campos ficticios, por supuesto.
  ('d0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000001', 'Santiago', 'Núñez Reyes', '5512345606', 'santiago.nunez@example.mx', true, 'NURS850312AB1', 'Santiago Núñez Reyes', '612', 'G03', '03100'),
  ('d0000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000002', 'Fernanda', 'López Aguilar', '6641234567', 'fernanda.lopez@example.mx', false, null, null, null, null, null),
  ('d0000000-0000-4000-8000-000000000008', 'b0000000-0000-4000-8000-000000000002', 'Ricardo', 'Gómez Torres', '6641234568', null, false, null, null, null, null, null);

insert into pets (id, tenant_id, customer_id, name, species, breed, sex, birth_date, is_sterilized, grooming_notes, medical_alerts)
values
  ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'Rocky', 'dog', 'Labrador', 'male', '2021-03-15', true, 'Le gusta el corte de verano, se asusta con la secadora', null),
  ('e0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'Michi', 'cat', 'Doméstico de pelo corto', 'female', '2022-07-01', true, null, null),
  ('e0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 'Luna', 'dog', 'Schnauzer', 'female', '2019-11-20', true, 'Corte estilo teddy bear', null),
  ('e0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000003', 'Toby', 'dog', 'Salchicha', 'male', '2020-05-10', false, null, 'Alergia a shampoo con avena'),
  ('e0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000003', 'Nube', 'cat', 'Persa', null, '2023-01-05', false, 'Pelo largo, requiere cepillado antes del baño', null),
  ('e0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'Kira', 'dog', 'Border Collie', 'female', '2018-09-30', true, null, null),
  ('e0000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000005', 'Simón', 'cat', 'Siamés', 'male', '2021-12-25', true, null, null),
  ('e0000000-0000-4000-8000-000000000008', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000005', 'Coco', 'dog', 'Poodle', 'male', '2022-02-14', false, 'Corte estilo poodle clásico', null),
  ('e0000000-0000-4000-8000-000000000009', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006', 'Max', 'dog', 'Bóxer', 'male', '2020-08-08', true, null, 'Cardiopatía leve, vigilar durante ejercicio'),
  ('e0000000-0000-4000-8000-000000000010', 'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000007', 'Bruno', 'dog', 'Chihuahua', 'male', '2019-04-18', true, null, null),
  ('e0000000-0000-4000-8000-000000000011', 'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000007', 'Pelusa', 'cat', 'Angora', 'female', '2021-06-06', false, 'Pelo largo, se estresa fácil', null),
  ('e0000000-0000-4000-8000-000000000012', 'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000008', 'Duna', 'dog', 'Golden Retriever', 'female', '2020-10-02', true, null, null);

-- Un par de pesos de ejemplo para Rocky, para tener algo real que mostrar
-- en la ficha de mascota (tarea 2.20) sin esperar a que exista el flujo
-- completo de citas (fase 3) que normalmente los generaría.
insert into pet_weights (tenant_id, pet_id, weight_grams, measured_at)
values
  ('b0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 28500, now() - interval '90 days'),
  ('b0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 29200, now() - interval '30 days');

-- ===========================================================================
-- Catálogo de servicios (fase 3, tarea 3.3)
-- ===========================================================================
-- Precios en centavos, IVA incluido (CLAUDE.md §8.2 — el precio es lo
-- que paga el cliente, el ticket desglosa el IVA hacia atrás). Duraciones
-- realistas para una estética/veterinaria mexicana chica. Solo en
-- Patitas Felices — Huellitas Spa sigue sin catálogo propio, a
-- propósito (existe solo para aislamiento y zona horaria, ver el
-- comentario de arriba).
insert into services (id, tenant_id, kind, name, duration_minutes, price_cents, tax_rate_bp)
values
  ('f0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'grooming', 'Baño', 60, 25000, 1600),
  ('f0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'grooming', 'Corte de raza', 90, 45000, 1600),
  ('f0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'grooming', 'Deslanado', 75, 38000, 1600),
  ('f0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001', 'veterinary', 'Consulta general', 30, 35000, 1600),
  ('f0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000001', 'veterinary', 'Vacunación', 20, 28000, 1600),
  ('f0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000001', 'veterinary', 'Desparasitación', 15, 18000, 1600);

-- ===========================================================================
-- Catálogo de vacunas (fase 4, tarea 4.5)
-- ===========================================================================
-- Rabia y bordetella sin especie (aplican a perro y gato por igual);
-- triple felina y séxtuple canina restringidas a su especie. Intervalos
-- realistas de refuerzo anual, salvo bordetella (semestral, criterio
-- común cuando la mascota va seguido a estética o pensión).
insert into vaccines (id, tenant_id, name, species, default_interval_days)
values
  ('10000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Rabia', null, 365),
  ('10000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'Triple felina', 'cat', 365),
  ('10000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'Séxtuple canina', 'dog', 365),
  ('10000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001', 'Bordetella', null, 180);
