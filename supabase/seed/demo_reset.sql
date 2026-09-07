-- Restaura datos de negocio limpios en el tenant de demo (Patitas
-- Felices) para un ambiente DESPLEGADO (staging o producción) — lo corre
-- scripts/demo-reset.sh (tarea 6.12), llamado por "npm run demo:reset"
-- (CLAUDE.md §8.7). NO toca auth.users: las credenciales de demo nunca
-- cambian. Para desarrollo LOCAL no hace falta esto — ahí "npm run
-- db:reset" ya recrea todo desde cero (migraciones + seed.sql).
--
-- =============================================================================
-- Por qué esto NO puede ser un "borra todo e inserta de nuevo"
-- =============================================================================
-- grooming_records, medical_records y vaccinations tienen el trigger
-- app.prevent_hard_delete() (CLAUDE.md §8.5, migración soft_delete.sql):
-- ni siquiera con service_role se pueden borrar, a propósito — son
-- expediente clínico, un documento legal. Eso significa que una cita ya
-- atendida JAMÁS desaparece de la base, sin importar qué tan seguido se
-- "resetee" el demo.
--
-- La solución: los clientes "estrella" del guion de demo (Sofía y su
-- perro Rocky, Santiago y su perro Max — ya en seed.sql) tienen sus
-- CITAS de historial con ids FIJOS, definidos aquí mismo. Este script:
--
--   1. Le pone `deleted_at` a TODA cita, venta y partida del tenant de
--      demo que NO sea una de esas citas fijas — la basura que se
--      acumula probando el producto en vivo (agendar de más, cobros de
--      prueba de una reunión anterior) queda invisible para la app sin
--      necesidad de borrarla.
--   2. Revive (o crea, la primera vez) las citas "estrella" con
--      `insert ... on conflict (id) do update`, recalculando sus fechas
--      relativas a `now()` — así "la consulta de hace 45 días" sigue
--      pareciendo de hace 45 días sin importar cuándo se corra este
--      script.
--   3. El expediente clínico de esas citas fijas (grooming_records,
--      medical_records, vaccinations) también se revive con
--      `on conflict do update` sobre su propio id fijo — nunca un
--      `insert` liso, para no duplicar cada vez que se corre.
--
-- A propósito NO se pre-siembra ninguna venta (`sales`): cobrar una cita
-- en vivo es justo lo que el presentador hace como parte del demo
-- (README.md, "agendar → atender → cobrar") — pre-sembrar el ticket le
-- quitaría el propósito. Cualquier venta que exista en el tenant de demo
-- es, por definición, de una sesión de demo anterior, y se le pone
-- `deleted_at` en el paso 1 igual que las citas sueltas.
do $$
declare
  v_tenant_patitas   uuid := 'b0000000-0000-4000-8000-000000000001';
  v_branch_centro    uuid := 'c0000000-0000-4000-8000-000000000001';
  v_branch_delvalle  uuid := 'c0000000-0000-4000-8000-000000000002';

  v_user_dueno    uuid := 'a0000000-0000-4000-8000-000000000001';
  v_user_groomer  uuid := 'a0000000-0000-4000-8000-000000000003';
  v_user_vet      uuid := 'a0000000-0000-4000-8000-000000000004';

  -- Sofía Ramírez Castillo y su Labrador Rocky (ya en seed.sql).
  v_customer_sofia uuid := 'd0000000-0000-4000-8000-000000000001';
  v_pet_rocky      uuid := 'e0000000-0000-4000-8000-000000000001';

  -- Santiago Núñez Reyes ("el único que factura") y su Bóxer Max.
  v_customer_santiago uuid := 'd0000000-0000-4000-8000-000000000006';
  v_pet_max           uuid := 'e0000000-0000-4000-8000-000000000009';

  -- Catálogo (ya en seed.sql).
  v_service_bano     uuid := 'f0000000-0000-4000-8000-000000000001';
  v_service_corte    uuid := 'f0000000-0000-4000-8000-000000000002';
  v_service_consulta uuid := 'f0000000-0000-4000-8000-000000000004';

  v_vaccine_rabia    uuid := '10000000-0000-4000-8000-000000000001';
  v_vaccine_sextuple uuid := '10000000-0000-4000-8000-000000000003';

  -- Ids FIJOS de las citas "estrella" — nuevos para este script, no
  -- viven en supabase/tests/fixtures.ts porque ningún test de RLS los
  -- necesita referenciar (son exclusivos del guion de demo).
  v_appt_rocky_bano1   uuid := '30000000-0000-4000-8000-000000000001';
  v_appt_rocky_corte   uuid := '30000000-0000-4000-8000-000000000002';
  v_appt_rocky_vet     uuid := '30000000-0000-4000-8000-000000000003';
  v_appt_rocky_bano2   uuid := '30000000-0000-4000-8000-000000000004';
  v_appt_rocky_proxima uuid := '30000000-0000-4000-8000-000000000005';
  v_appt_max_vet       uuid := '30000000-0000-4000-8000-000000000006';
  v_appt_max_proxima   uuid := '30000000-0000-4000-8000-000000000007';

  v_vaccination_rocky uuid := '31000000-0000-4000-8000-000000000001';
  v_vaccination_max    uuid := '31000000-0000-4000-8000-000000000002';

  v_weight_rocky_vieja  uuid := '32000000-0000-4000-8000-000000000001';
  v_weight_rocky_nueva  uuid := '32000000-0000-4000-8000-000000000002';
  v_weight_max          uuid := '32000000-0000-4000-8000-000000000003';

  v_hero_appointment_ids uuid[] := array[
    '30000000-0000-4000-8000-000000000001'::uuid,
    '30000000-0000-4000-8000-000000000002'::uuid,
    '30000000-0000-4000-8000-000000000003'::uuid,
    '30000000-0000-4000-8000-000000000004'::uuid,
    '30000000-0000-4000-8000-000000000005'::uuid,
    '30000000-0000-4000-8000-000000000006'::uuid,
    '30000000-0000-4000-8000-000000000007'::uuid
  ];
begin
  -- ===========================================================================
  -- Paso 1: limpiar lo transaccional que NO es parte del guion fijo
  -- ===========================================================================
  -- Ventas y sus partidas: TODAS son de una demo anterior (este script
  -- nunca pre-siembra una venta), así que se ocultan completas.
  update sales set deleted_at = now()
    where tenant_id = v_tenant_patitas and deleted_at is null;
  update sale_items set deleted_at = now()
    where tenant_id = v_tenant_patitas and deleted_at is null;
  update payments set deleted_at = now()
    where tenant_id = v_tenant_patitas and deleted_at is null;
  update invoice_requests set deleted_at = now()
    where tenant_id = v_tenant_patitas and deleted_at is null;

  -- Citas: todas menos las 7 del guion fijo de arriba.
  update appointments set deleted_at = now()
    where tenant_id = v_tenant_patitas
      and deleted_at is null
      and id != all(v_hero_appointment_ids);
  update appointment_services set deleted_at = now()
    where tenant_id = v_tenant_patitas
      and deleted_at is null
      and appointment_id != all(v_hero_appointment_ids);

  -- ===========================================================================
  -- Paso 2: revivir/crear las citas "estrella" de Rocky (estética + una
  -- consulta), con fechas relativas a HOY
  -- ===========================================================================
  insert into appointments (id, tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, status, created_by)
  values (v_appt_rocky_bano1, v_tenant_patitas, v_branch_centro, v_customer_sofia, v_pet_rocky, 'grooming', v_user_groomer, now() - interval '90 days', now() - interval '90 days' + interval '60 minutes', 'completed', v_user_dueno)
  on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, status = excluded.status, deleted_at = null;

  -- appointment_services no tiene una restricción única propia
  -- (solo `id`, siempre nuevo) — un `on conflict` no evitaría
  -- duplicarla cada vez que se corre este script. A diferencia del
  -- expediente, esta tabla SÍ se puede borrar de verdad (CLAUDE.md
  -- §8.5 no la incluye en la lista de tablas con `prevent_hard_delete`),
  -- así que se limpia y se vuelve a insertar tal cual.
  delete from appointment_services where appointment_id = v_appt_rocky_bano1;
  insert into appointment_services (tenant_id, appointment_id, service_id, name_snapshot, unit_price_cents, quantity, duration_minutes_snapshot)
  select v_tenant_patitas, v_appt_rocky_bano1, id, name, price_cents, 1, duration_minutes from services where id = v_service_bano;

  insert into grooming_records (tenant_id, appointment_id, pet_id, cut_style, shampoo_used, behavior_notes, groomer_notes)
  values (v_tenant_patitas, v_appt_rocky_bano1, v_pet_rocky, 'Corte de verano', 'Shampoo hipoalergénico', 'Tranquilo, se dejó bañar sin problema', 'Pelo un poco reseco, se recomienda shampoo hidratante la próxima vez')
  on conflict (appointment_id) do update set groomer_notes = excluded.groomer_notes;

  insert into appointments (id, tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, status, created_by)
  values (v_appt_rocky_corte, v_tenant_patitas, v_branch_centro, v_customer_sofia, v_pet_rocky, 'grooming', v_user_groomer, now() - interval '60 days', now() - interval '60 days' + interval '90 minutes', 'completed', v_user_dueno)
  on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, status = excluded.status, deleted_at = null;

  -- Se limpia y reinserta (mismo motivo que arriba: appointment_services no tiene restricción única).
  delete from appointment_services where appointment_id = v_appt_rocky_corte;
  insert into appointment_services (tenant_id, appointment_id, service_id, name_snapshot, unit_price_cents, quantity, duration_minutes_snapshot)
  select v_tenant_patitas, v_appt_rocky_corte, id, name, price_cents, 1, duration_minutes from services where id = v_service_corte;

  insert into grooming_records (tenant_id, appointment_id, pet_id, cut_style, blade_used, behavior_notes, groomer_notes)
  values (v_tenant_patitas, v_appt_rocky_corte, v_pet_rocky, 'Corte de raza (Labrador)', 'Navaja #7', 'Un poco nervioso al principio, se calmó rápido', 'Pelaje en buen estado, sin nudos')
  on conflict (appointment_id) do update set groomer_notes = excluded.groomer_notes;

  insert into appointments (id, tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, status, created_by)
  values (v_appt_rocky_vet, v_tenant_patitas, v_branch_delvalle, v_customer_sofia, v_pet_rocky, 'veterinary', v_user_vet, now() - interval '45 days', now() - interval '45 days' + interval '30 minutes', 'completed', v_user_dueno)
  on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, status = excluded.status, deleted_at = null;

  -- Se limpia y reinserta (mismo motivo que arriba: appointment_services no tiene restricción única).
  delete from appointment_services where appointment_id = v_appt_rocky_vet;
  insert into appointment_services (tenant_id, appointment_id, service_id, name_snapshot, unit_price_cents, quantity, duration_minutes_snapshot)
  select v_tenant_patitas, v_appt_rocky_vet, id, name, price_cents, 1, duration_minutes from services where id = v_service_consulta;

  insert into medical_records (tenant_id, appointment_id, pet_id, reason, examination, diagnosis, treatment, indications, temperature_deci_c)
  values (v_tenant_patitas, v_appt_rocky_vet, v_pet_rocky, 'Revisión anual y refuerzo de vacunas', 'Buen estado general, mucosas rosadas, sin dolor a la palpación abdominal', 'Sano, sin hallazgos relevantes', 'Ninguno', 'Continuar con su alimentación habitual y ejercicio diario', 385)
  on conflict (appointment_id) do update set diagnosis = excluded.diagnosis;

  -- next_due_date ~20 días en el futuro: aparece "por vencer" en el
  -- dashboard (tarea 6.7) sin necesidad de esperar meses para verlo en
  -- una demo real.
  insert into vaccinations (id, tenant_id, pet_id, vaccine_id, applied_by_user_id, applied_at, next_due_date, appointment_id)
  values (v_vaccination_rocky, v_tenant_patitas, v_pet_rocky, v_vaccine_sextuple, v_user_vet, now() - interval '45 days', (now() + interval '20 days')::date, v_appt_rocky_vet)
  on conflict (id) do update set applied_at = excluded.applied_at, next_due_date = excluded.next_due_date;

  insert into pet_weights (id, tenant_id, pet_id, appointment_id, weight_grams, measured_at)
  values (v_weight_rocky_vieja, v_tenant_patitas, v_pet_rocky, v_appt_rocky_vet, 28900, now() - interval '45 days')
  on conflict (id) do update set weight_grams = excluded.weight_grams, measured_at = excluded.measured_at;

  insert into appointments (id, tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, status, created_by)
  values (v_appt_rocky_bano2, v_tenant_patitas, v_branch_centro, v_customer_sofia, v_pet_rocky, 'grooming', v_user_groomer, now() - interval '15 days', now() - interval '15 days' + interval '60 minutes', 'completed', v_user_dueno)
  on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, status = excluded.status, deleted_at = null;

  -- Se limpia y reinserta (mismo motivo que arriba: appointment_services no tiene restricción única).
  delete from appointment_services where appointment_id = v_appt_rocky_bano2;
  insert into appointment_services (tenant_id, appointment_id, service_id, name_snapshot, unit_price_cents, quantity, duration_minutes_snapshot)
  select v_tenant_patitas, v_appt_rocky_bano2, id, name, price_cents, 1, duration_minutes from services where id = v_service_bano;

  insert into grooming_records (tenant_id, appointment_id, pet_id, cut_style, shampoo_used, behavior_notes, groomer_notes)
  values (v_tenant_patitas, v_appt_rocky_bano2, v_pet_rocky, 'Corte de verano', 'Shampoo hipoalergénico', 'Tranquilo, ya conoce el lugar', 'Buen estado general del pelaje')
  on conflict (appointment_id) do update set groomer_notes = excluded.groomer_notes;

  insert into pet_weights (id, tenant_id, pet_id, appointment_id, weight_grams, measured_at)
  values (v_weight_rocky_nueva, v_tenant_patitas, v_pet_rocky, v_appt_rocky_bano2, 29200, now() - interval '15 days')
  on conflict (id) do update set weight_grams = excluded.weight_grams, measured_at = excluded.measured_at;

  -- Una cita agendada a futuro, sin atender — para la sección "Próximas
  -- citas" de la ficha de Rocky (tarea 6.6).
  insert into appointments (id, tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, status, created_by)
  values (v_appt_rocky_proxima, v_tenant_patitas, v_branch_centro, v_customer_sofia, v_pet_rocky, 'grooming', v_user_groomer, now() + interval '5 days', now() + interval '5 days' + interval '60 minutes', 'scheduled', v_user_dueno)
  on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, status = excluded.status, deleted_at = null;

  -- Se limpia y reinserta (mismo motivo que arriba: appointment_services no tiene restricción única).
  delete from appointment_services where appointment_id = v_appt_rocky_proxima;
  insert into appointment_services (tenant_id, appointment_id, service_id, name_snapshot, unit_price_cents, quantity, duration_minutes_snapshot)
  select v_tenant_patitas, v_appt_rocky_proxima, id, name, price_cents, 1, duration_minutes from services where id = v_service_bano;

  -- ===========================================================================
  -- Paso 3: revivir/crear la cita "estrella" de Max (veterinaria, con
  -- alerta médica ya sembrada en seed.sql: cardiopatía leve)
  -- ===========================================================================
  insert into appointments (id, tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, status, created_by)
  values (v_appt_max_vet, v_tenant_patitas, v_branch_delvalle, v_customer_santiago, v_pet_max, 'veterinary', v_user_vet, now() - interval '30 days', now() - interval '30 days' + interval '30 minutes', 'completed', v_user_dueno)
  on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, status = excluded.status, deleted_at = null;

  -- Se limpia y reinserta (mismo motivo que arriba: appointment_services no tiene restricción única).
  delete from appointment_services where appointment_id = v_appt_max_vet;
  insert into appointment_services (tenant_id, appointment_id, service_id, name_snapshot, unit_price_cents, quantity, duration_minutes_snapshot)
  select v_tenant_patitas, v_appt_max_vet, id, name, price_cents, 1, duration_minutes from services where id = v_service_consulta;

  insert into medical_records (tenant_id, appointment_id, pet_id, reason, examination, diagnosis, treatment, indications, temperature_deci_c, next_visit_date)
  values (
    v_tenant_patitas, v_appt_max_vet, v_pet_max,
    'Control de cardiopatía leve', 'Auscultación cardiaca: soplo grado I/VI, sin signos de descompensación',
    'Cardiopatía leve, estable', 'Sin cambios en el tratamiento actual',
    'Evitar ejercicio intenso, revisión de seguimiento en un mes', 384,
    (now() + interval '14 days')::date
  )
  on conflict (appointment_id) do update set diagnosis = excluded.diagnosis, next_visit_date = excluded.next_visit_date;

  insert into vaccinations (id, tenant_id, pet_id, vaccine_id, applied_by_user_id, applied_at, next_due_date, appointment_id)
  values (v_vaccination_max, v_tenant_patitas, v_pet_max, v_vaccine_rabia, v_user_vet, now() - interval '30 days', (now() + interval '10 days')::date, v_appt_max_vet)
  on conflict (id) do update set applied_at = excluded.applied_at, next_due_date = excluded.next_due_date;

  insert into pet_weights (id, tenant_id, pet_id, appointment_id, weight_grams, measured_at)
  values (v_weight_max, v_tenant_patitas, v_pet_max, v_appt_max_vet, 31500, now() - interval '30 days')
  on conflict (id) do update set weight_grams = excluded.weight_grams, measured_at = excluded.measured_at;

  -- Revisión de seguimiento agendada (coincide con next_visit_date de arriba).
  insert into appointments (id, tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, status, created_by)
  values (v_appt_max_proxima, v_tenant_patitas, v_branch_delvalle, v_customer_santiago, v_pet_max, 'veterinary', v_user_vet, now() + interval '14 days', now() + interval '14 days' + interval '30 minutes', 'scheduled', v_user_dueno)
  on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, status = excluded.status, deleted_at = null;

  -- Se limpia y reinserta (mismo motivo que arriba: appointment_services no tiene restricción única).
  delete from appointment_services where appointment_id = v_appt_max_proxima;
  insert into appointment_services (tenant_id, appointment_id, service_id, name_snapshot, unit_price_cents, quantity, duration_minutes_snapshot)
  select v_tenant_patitas, v_appt_max_proxima, id, name, price_cents, 1, duration_minutes from services where id = v_service_consulta;
end $$;
