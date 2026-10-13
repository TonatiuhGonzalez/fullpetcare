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
-- Las 7 citas del guion fijo NO se cobran aquí: cobrar una cita en vivo es
-- justo lo que el presentador hace como parte del demo (README.md, "agendar
-- → atender → cobrar") — pre-sembrar su ticket le quitaría el propósito. Toda
-- venta que exista en el tenant de demo es de una sesión anterior y se le
-- pone `deleted_at` en el paso 1 igual que las citas sueltas. La única
-- excepción son las ventas de historia de la fase 12 (bloque "Ventas y caja
-- de demostración", más abajo), que cuelgan de citas propias y se revivan ahí.
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

-- =============================================================================
-- Inventario de demostración (fase 11, tarea 11.22)
-- =============================================================================
-- Deja el catálogo de productos y las existencias de Patitas Felices como las
-- trae seed.sql, para que la demo muestre siempre los tres estados de la
-- pantalla de Inventario (normal, stock bajo y "Sin inventario").
--
-- Por qué las existencias se restauran con un AJUSTE y no borrando movimientos:
-- `stock_movements` es una bitácora inmutable (sin UPDATE ni DELETE, ni siquiera
-- con service_role; CLAUDE.md §6.5). Lo vendido o consumido en una demo anterior
-- no se puede "deshacer": se compensa con un movimiento `adjustment` por la
-- diferencia entre lo que hay y lo que debería haber. Si ya está en su valor,
-- no se escribe nada (repetir el reset no ensucia la bitácora).
--
-- Lo que este bloque NO toca, a propósito: nada fiscal. `tenant_invoicing_settings`
-- (la organización del negocio en el PAC y la vigencia de su certificado) queda
-- como esté, para que la demo no pierda el certificado de pruebas cargado. Las
-- facturas de demos anteriores se ocultan en el Paso 1 de arriba, como las ventas.
-- Este script jamás llama al PAC.
do $$
declare
  v_tenant_patitas uuid := 'b0000000-0000-4000-8000-000000000001';
  v_user_dueno     uuid := 'a0000000-0000-4000-8000-000000000001';
  v_target record;
  v_current integer;
begin
  -- Los insumos usados en consultas de demos anteriores se ocultan, como las citas.
  update appointment_products set deleted_at = now()
    where tenant_id = v_tenant_patitas and deleted_at is null;

  -- Categorías base (mismos datos que seed.sql, fase 13G): se reviven las editadas u
  -- ocultadas y se ocultan (borrado suave) las creadas durante la demo.
  insert into product_categories (id, tenant_id, name, icon)
  values
    ('21000000-0000-4000-8000-000000000001', v_tenant_patitas, 'Alimento', 'mdi-food-drumstick'),
    ('21000000-0000-4000-8000-000000000002', v_tenant_patitas, 'Higiene', 'mdi-shower-head'),
    ('21000000-0000-4000-8000-000000000003', v_tenant_patitas, 'Accesorios', 'mdi-dog-service'),
    ('21000000-0000-4000-8000-000000000004', v_tenant_patitas, 'Juguetes', 'mdi-tennis-ball')
  on conflict (id) do update set
    name = excluded.name, icon = excluded.icon, is_active = true, deleted_at = null;

  update product_categories set deleted_at = now()
    where tenant_id = v_tenant_patitas
      and deleted_at is null
      and id <> all(array[
        '21000000-0000-4000-8000-000000000001'::uuid,
        '21000000-0000-4000-8000-000000000002'::uuid,
        '21000000-0000-4000-8000-000000000003'::uuid,
        '21000000-0000-4000-8000-000000000004'::uuid
      ]);

  -- Catálogo base (mismos datos que seed.sql). Se revive lo que se hubiera
  -- editado u ocultado, y se oculta (borrado suave) cualquier producto creado
  -- durante la demo.
  insert into products (id, tenant_id, name, sku, price_cents, tax_rate_bp, cost_cents, min_stock, is_active)
  values
    ('20000000-0000-4000-8000-000000000001', v_tenant_patitas, 'Alimento seco adulto 3 kg', 'ALI-3KG', 38900, 1600, 26000, 5, true),
    ('20000000-0000-4000-8000-000000000002', v_tenant_patitas, 'Shampoo hipoalergénico 250 ml', 'SHA-250', 14500, 1600, 8000, 3, true),
    ('20000000-0000-4000-8000-000000000003', v_tenant_patitas, 'Collar de nylon mediano', 'COL-M', 9900, 1600, null, 0, false)
  on conflict (id) do update set
    name = excluded.name, sku = excluded.sku, price_cents = excluded.price_cents,
    tax_rate_bp = excluded.tax_rate_bp, cost_cents = excluded.cost_cents,
    min_stock = excluded.min_stock, is_active = excluded.is_active, deleted_at = null;

  update products set category_id = '21000000-0000-4000-8000-000000000001' where id = '20000000-0000-4000-8000-000000000001';
  update products set category_id = '21000000-0000-4000-8000-000000000002' where id = '20000000-0000-4000-8000-000000000002';
  update products set category_id = '21000000-0000-4000-8000-000000000003' where id = '20000000-0000-4000-8000-000000000003';

  update products set deleted_at = now()
    where tenant_id = v_tenant_patitas
      and deleted_at is null
      and id <> all(array[
        '20000000-0000-4000-8000-000000000001'::uuid,
        '20000000-0000-4000-8000-000000000002'::uuid,
        '20000000-0000-4000-8000-000000000003'::uuid
      ]);

  -- Existencia objetivo por sucursal. La primera vez (base sin movimientos) el
  -- ajuste es toda la existencia; después solo corrige la diferencia.
  --
  -- Por qué las existencias NO están en seed.sql: ese archivo es la base
  -- determinista de los tests de base de datos (checkout, consumo de insumos,
  -- movimientos de inventario), que asumen existencia 0 de entrada. Sembrarlas
  -- ahí rompería 21 tests de inventario. Para la demo sirve este script, que se
  -- puede correr también contra la base local.
  --
  -- Estados que deja visibles en la pantalla de Inventario:
  --   Alimento 3 kg: Centro 12 (normal) y Del Valle 0 ("Sin inventario").
  --   Shampoo: Centro 6 (normal) y Del Valle 2 (stock bajo: mínimo 3).
  --   Collar (inactivo): 10 en Centro, conserva existencia pero no se ofrece.
  for v_target in
    select * from (values
      ('c0000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000001'::uuid, 12),
      ('c0000000-0000-4000-8000-000000000002'::uuid, '20000000-0000-4000-8000-000000000001'::uuid, 0),
      ('c0000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000002'::uuid, 6),
      ('c0000000-0000-4000-8000-000000000002'::uuid, '20000000-0000-4000-8000-000000000002'::uuid, 2),
      ('c0000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000003'::uuid, 10),
      ('c0000000-0000-4000-8000-000000000002'::uuid, '20000000-0000-4000-8000-000000000003'::uuid, 0)
    ) as t(branch_id, product_id, quantity)
  loop
    select coalesce(sum(quantity), 0)::integer into v_current
      from stock_movements
      where tenant_id = v_tenant_patitas
        and branch_id = v_target.branch_id
        and product_id = v_target.product_id;

    if v_current <> v_target.quantity then
      insert into stock_movements (tenant_id, branch_id, product_id, movement_type, quantity, reason, created_by)
      values (
        v_tenant_patitas, v_target.branch_id, v_target.product_id, 'adjustment',
        v_target.quantity - v_current, 'Restablecer inventario de demostración', v_user_dueno
      );
    end if;
  end loop;
end $$;

-- =============================================================================
-- Ventas y caja de demostración (fase 12, tarea 12.14)
-- =============================================================================
-- Deja la demo con historia para que Reportes y Caja no salgan vacíos:
--   * 13 ventas de los últimos 6 días en las dos sucursales (una cancelada,
--     una con descuento, pagos en efectivo con cambio, tarjeta, transferencia y
--     un pago dividido), con 8 citas ya atendidas por la groomer y el vet para
--     que el reporte de empleados tenga filas.
--   * Un corte de caja CERRADO en Centro (fondo, un retiro, un gasto y un
--     faltante de $4), de las ventas 1 a 5.
--   * Ninguna caja abierta: el presentador la abre en vivo.
--
-- "Hoy" queda vacío a propósito: el cobro en vivo es lo que lo llena.
--
-- Ninguna cita del guion fijo (las 7 de arriba) se cobra aquí: el presentador
-- las cobra en vivo ("agendar → atender → cobrar"). Estas ventas cuelgan de
-- citas propias (ids 33...), que el Paso 1 oculta y este bloque revive.
--
-- Cómo se mantiene repetible (se corre antes de cada demo):
--   * Ventas, partidas y pagos tienen ids fijos y se REHACEN cada vez (las
--     partidas y los pagos se borran y se vuelven a insertar; no son expediente).
--     La venta conserva su folio si ya existía; si es nueva toma el siguiente
--     de su sucursal, así que no choca con los folios de demos anteriores.
--   * Las fechas de las ventas son relativas a hoy en la zona de su sucursal
--     (§8.3), salvo las del corte (ver abajo).
--   * No se escriben movimientos de inventario por estas ventas: las existencias
--     de la demo las fija el bloque de Inventario de arriba, y la bitácora es
--     inmutable. Por eso lo vendido aquí no baja el stock.
--
-- Por qué el corte NO se restaura como lo demás: un corte cerrado es inmutable
-- (trigger `protect_closed_cash_session`, ni siquiera con service_role). No se
-- puede ocultar, ni corregir, ni borrar. Así que:
--   * Se crea UNA sola vez, con id fijo, y las corridas siguientes no lo tocan.
--   * Las ventas 1 a 5 se anclan al DÍA DEL CORTE (no a "ayer"): así su efectivo
--     esperado congelado sigue cuadrando con lo que Caja recalcula. El corte
--     "envejece" (y sale de "esta semana" en Reportes); las otras ventas no.
--   * Los cortes que alguien cierre durante una demo se quedan en el historial
--     de Caja para siempre. Lo que sí se puede ocultar es una caja ABIERTA:
--     se le pone `deleted_at` para que la demo arranque con la caja cerrada.
do $$
declare
  v_tenant uuid := 'b0000000-0000-4000-8000-000000000001';
  v_branch_centro uuid := 'c0000000-0000-4000-8000-000000000001';
  v_branch_delvalle uuid := 'c0000000-0000-4000-8000-000000000002';
  v_user_dueno uuid := 'a0000000-0000-4000-8000-000000000001';
  v_user_recepcion uuid := 'a0000000-0000-4000-8000-000000000002';
  v_user_groomer uuid := 'a0000000-0000-4000-8000-000000000003';
  v_user_vet uuid := 'a0000000-0000-4000-8000-000000000004';
  v_cut_id uuid := '35000000-0000-4000-8000-000000000001';

  -- Claves cortas: s = servicio (1 Baño, 2 Corte, 3 Deslanado, 4 Consulta,
  -- 5 Vacunación, 6 Desparasitación), p = producto (1 Alimento, 2 Shampoo),
  -- cust = cliente de la semilla. En un pago, `a` ausente = lo que falte para
  -- el total y `f` = forma de pago de la tarjeta (04 crédito, 28 débito).
  v_sales jsonb := $json$[
    {"n":1,  "branch":"centro",   "cut":true, "time":"10:15", "cust":1, "by":"recepcion", "appt":"groomer",
     "items":[{"s":1}], "pay":[{"m":"cash","a":25000}]},
    {"n":2,  "branch":"centro",   "cut":true, "time":"12:30", "cust":2, "by":"recepcion", "appt":"groomer", "disc":3000,
     "items":[{"s":2},{"p":2}], "pay":[{"m":"card","f":"04"}]},
    {"n":3,  "branch":"centro",   "cut":true, "time":"14:05", "cust":4, "by":"recepcion",
     "items":[{"p":1}], "pay":[{"m":"cash","a":40000}]},
    {"n":4,  "branch":"centro",   "cut":true, "time":"16:20", "cust":3, "by":"dueno", "appt":"groomer",
     "items":[{"s":3}], "pay":[{"m":"transfer_spei"}]},
    {"n":5,  "branch":"centro",   "cut":true, "time":"17:45", "cust":5, "by":"recepcion",
     "items":[{"p":2,"q":2}], "pay":[{"m":"card","f":"28"}]},
    {"n":6,  "branch":"delvalle", "days":2, "time":"11:00", "cust":6, "by":"dueno", "appt":"vet",
     "items":[{"s":4}], "pay":[{"m":"card","f":"04"}]},
    {"n":7,  "branch":"delvalle", "days":2, "time":"13:30", "cust":1, "by":"recepcion", "appt":"vet",
     "items":[{"s":5},{"s":6}], "pay":[{"m":"cash","a":50000}]},
    {"n":8,  "branch":"centro",   "days":3, "time":"10:00", "cust":2, "by":"recepcion", "appt":"groomer",
     "items":[{"s":1}], "pay":[{"m":"card","f":"28"}]},
    {"n":9,  "branch":"centro",   "days":3, "time":"15:30", "cust":3, "by":"recepcion",
     "items":[{"p":1,"q":2}], "pay":[{"m":"card","f":"04"}]},
    {"n":10, "branch":"delvalle", "days":4, "time":"12:00", "cust":4, "by":"recepcion", "appt":"vet",
     "items":[{"s":4},{"p":1}], "pay":[{"m":"cash","a":30000},{"m":"card","f":"04"}]},
    {"n":11, "branch":"centro",   "days":5, "time":"11:20", "cust":5, "by":"recepcion", "appt":"groomer",
     "items":[{"s":2}], "pay":[{"m":"cash","a":45000}]},
    {"n":12, "branch":"centro",   "days":5, "time":"16:00", "cust":6, "by":"recepcion", "appt":"groomer", "status":"cancelled",
     "items":[{"s":1}], "pay":[{"m":"cash","a":25000}]},
    {"n":13, "branch":"delvalle", "days":6, "time":"10:30", "cust":1, "by":"dueno", "appt":"vet",
     "items":[{"s":4}], "pay":[{"m":"transfer_spei"}]}
  ]$json$;

  v_sale jsonb;
  v_pay jsonb;
  v_n integer;
  v_sale_id uuid;
  v_appt_id uuid;
  v_branch uuid;
  v_tz text;
  v_cut_day date;
  v_paid_at timestamptz;
  v_customer uuid;
  v_closed_by uuid;
  v_employee uuid;
  v_pet uuid;
  v_first_service uuid;
  v_minutes integer;
  v_status sale_status;
  v_discount integer;
  v_folio integer;
  v_subtotal integer;
  v_tax integer;
  v_total integer;
  v_explicit integer;
  v_paid_sum integer;
  v_amount integer;
  v_method text;
  v_open_at timestamptz;
  v_close_at timestamptz;
  v_expected integer;
begin
  -- Una caja abierta de una demo anterior se oculta (ver arriba): la demo
  -- arranca con la caja cerrada. Se hace antes de crear nada, porque la base
  -- permite una sola caja abierta por sucursal.
  update cash_sessions set deleted_at = now()
    where tenant_id = v_tenant and closed_at is null and deleted_at is null;

  -- Día del corte: el que ya tiene si existe; si no, ayer en Centro.
  select timezone into v_tz from branches where id = v_branch_centro;
  v_cut_day := coalesce(
    (select (opened_at at time zone v_tz)::date from cash_sessions where id = v_cut_id),
    (now() at time zone v_tz)::date - 1
  );

  for v_sale in select * from jsonb_array_elements(v_sales) loop
    v_n := (v_sale->>'n')::integer;
    v_sale_id := ('34000000-0000-4000-8000-' || lpad(v_n::text, 12, '0'))::uuid;
    v_branch := case v_sale->>'branch' when 'centro' then v_branch_centro else v_branch_delvalle end;
    select timezone into v_tz from branches where id = v_branch;

    -- Instante del cobro: día local + hora local, convertido a UTC con la zona
    -- IANA de la sucursal (§8.3), nunca con un offset fijo.
    v_paid_at := (
      case when (v_sale->>'cut')::boolean is true
           then v_cut_day
           else (now() at time zone v_tz)::date - (v_sale->>'days')::integer
      end + (v_sale->>'time')::time
    ) at time zone v_tz;

    v_customer := ('d0000000-0000-4000-8000-' || lpad(v_sale->>'cust', 12, '0'))::uuid;
    v_closed_by := case v_sale->>'by' when 'dueno' then v_user_dueno else v_user_recepcion end;
    v_status := coalesce(v_sale->>'status', 'paid')::sale_status;
    v_discount := coalesce((v_sale->>'disc')::integer, 0);

    -- Cita atendida de la que cuelgan los servicios (solo si la venta la lleva).
    v_appt_id := null;
    if v_sale ? 'appt' then
      select id into v_pet from pets
        where customer_id = v_customer and tenant_id = v_tenant and deleted_at is null
        order by created_at, id limit 1;
      -- Duración total de los servicios, y uno de ellos para tomar el tipo de cita
      -- (en esta lista todos los servicios de una cita son del mismo tipo).
      select (array_agg(s.id order by s.id))[1],
             sum(s.duration_minutes * coalesce((i->>'q')::integer, 1))::integer
        into v_first_service, v_minutes
        from jsonb_array_elements(v_sale->'items') i
        join services s on s.id = ('f0000000-0000-4000-8000-' || lpad(i->>'s', 12, '0'))::uuid
        where i ? 's';

      if v_pet is not null and v_first_service is not null then
        v_appt_id := ('33000000-0000-4000-8000-' || lpad(v_n::text, 12, '0'))::uuid;
        v_employee := case v_sale->>'appt' when 'groomer' then v_user_groomer else v_user_vet end;

        insert into appointments (id, tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, status, created_by)
        values (
          v_appt_id, v_tenant, v_branch, v_customer, v_pet,
          (select kind from services where id = v_first_service),
          v_employee,
          v_paid_at - make_interval(mins => v_minutes + 10),
          v_paid_at - interval '10 minutes',
          'completed', v_user_dueno
        )
        on conflict (id) do update set
          branch_id = excluded.branch_id, customer_id = excluded.customer_id, pet_id = excluded.pet_id,
          kind = excluded.kind, employee_user_id = excluded.employee_user_id,
          starts_at = excluded.starts_at, ends_at = excluded.ends_at, status = excluded.status,
          deleted_at = null;

        -- Sin restricción única: se limpia y se reinserta (como las citas del guion).
        delete from appointment_services where appointment_id = v_appt_id;
        insert into appointment_services (tenant_id, appointment_id, service_id, name_snapshot, unit_price_cents, quantity, duration_minutes_snapshot)
        select v_tenant, v_appt_id, s.id, s.name, s.price_cents, coalesce((i->>'q')::integer, 1), s.duration_minutes
        from jsonb_array_elements(v_sale->'items') i
        join services s on s.id = ('f0000000-0000-4000-8000-' || lpad(i->>'s', 12, '0'))::uuid
        where i ? 's';
      end if;
    end if;

    -- Folio: el de siempre si la venta ya existía; si no, el siguiente de la
    -- sucursal (el índice único cuenta también las ventas ocultas).
    select coalesce(max(folio), 0) + 1 into v_folio
      from sales where tenant_id = v_tenant and branch_id = v_branch;

    insert into sales (id, tenant_id, branch_id, customer_id, folio, status, discount_cents, paid_at, closed_by)
    values (v_sale_id, v_tenant, v_branch, v_customer, v_folio, v_status, v_discount, v_paid_at, v_closed_by)
    on conflict (id) do update set
      customer_id = excluded.customer_id, status = excluded.status, discount_cents = excluded.discount_cents,
      paid_at = excluded.paid_at, closed_by = excluded.closed_by, deleted_at = null;

    -- Partidas: IVA incluido en el precio y desglosado por partida (§8.2),
    -- la misma cuenta que hace el cobro.
    delete from sale_items where sale_id = v_sale_id;
    delete from payments where sale_id = v_sale_id;

    insert into sale_items (tenant_id, sale_id, item_type, service_id, appointment_id, description, quantity, unit_price_cents, tax_rate_bp, tax_cents, line_total_cents)
    select v_tenant, v_sale_id, 'service', s.id, v_appt_id, s.name, x.q, s.price_cents, s.tax_rate_bp,
           s.price_cents * x.q - round((s.price_cents * x.q)::numeric * 10000 / (10000 + s.tax_rate_bp))::integer,
           s.price_cents * x.q
    from jsonb_array_elements(v_sale->'items') i
    join services s on s.id = ('f0000000-0000-4000-8000-' || lpad(i->>'s', 12, '0'))::uuid
    cross join lateral (select coalesce((i->>'q')::integer, 1) as q) x
    where i ? 's';

    insert into sale_items (tenant_id, sale_id, item_type, product_id, description, quantity, unit_price_cents, tax_rate_bp, tax_cents, line_total_cents)
    select v_tenant, v_sale_id, 'product', p.id, p.name, x.q, p.price_cents, p.tax_rate_bp,
           p.price_cents * x.q - round((p.price_cents * x.q)::numeric * 10000 / (10000 + p.tax_rate_bp))::integer,
           p.price_cents * x.q
    from jsonb_array_elements(v_sale->'items') i
    join products p on p.id = ('20000000-0000-4000-8000-' || lpad(i->>'p', 12, '0'))::uuid
    cross join lateral (select coalesce((i->>'q')::integer, 1) as q) x
    where i ? 'p';

    select coalesce(sum(line_total_cents - tax_cents), 0), coalesce(sum(tax_cents), 0)
      into v_subtotal, v_tax
      from sale_items where sale_id = v_sale_id;
    v_total := greatest(0, v_subtotal + v_tax - v_discount);

    update sales set subtotal_cents = v_subtotal, tax_cents = v_tax, total_cents = v_total
      where id = v_sale_id;

    -- Pagos. Un pago sin `a` toma lo que falta para el total.
    select coalesce(sum((p->>'a')::integer), 0) into v_explicit
      from jsonb_array_elements(v_sale->'pay') p;
    v_paid_sum := 0;
    for v_pay in select * from jsonb_array_elements(v_sale->'pay') loop
      v_method := v_pay->>'m';
      v_amount := coalesce((v_pay->>'a')::integer, v_total - v_explicit);
      insert into payments (tenant_id, sale_id, method, amount_cents, reference, status, paid_at, payment_form_code)
      values (
        v_tenant, v_sale_id, v_method::payment_method, v_amount,
        case when v_method = 'cash' then null else 'SIM-DEMO-' || lpad(v_n::text, 3, '0') end,
        (case when v_method = 'cash' then 'approved' else 'simulated_approved' end)::payment_status,
        v_paid_at,
        case v_method when 'cash' then '01' when 'transfer_spei' then '03' else v_pay->>'f' end
      );
      v_paid_sum := v_paid_sum + v_amount;
    end loop;

    -- Cinturón: si alguien edita la lista de arriba y los pagos no alcanzan, el
    -- reset falla ruidosamente (y deshace todo) en vez de sembrar un ticket roto.
    if v_paid_sum < v_total then
      raise exception 'Semilla de demo: la venta % no queda cubierta (pagos %, total %).', v_n, v_paid_sum, v_total;
    end if;
  end loop;

  -- ===========================================================================
  -- Corte de caja cerrado de ejemplo (solo la primera vez, ver arriba)
  -- ===========================================================================
  if not exists (select 1 from cash_sessions where id = v_cut_id) then
    select timezone into v_tz from branches where id = v_branch_centro;
    v_open_at := (v_cut_day + time '09:00') at time zone v_tz;
    v_close_at := (v_cut_day + time '19:00') at time zone v_tz;

    insert into cash_sessions (id, tenant_id, branch_id, opened_by, opened_at, opening_float_cents, opening_note)
    values (v_cut_id, v_tenant, v_branch_centro, v_user_recepcion, v_open_at, 80000, 'Fondo para dar cambio');

    insert into cash_movements (tenant_id, branch_id, cash_session_id, movement_type, amount_cents, reason, created_by, created_at)
    values
      (v_tenant, v_branch_centro, v_cut_id, 'withdrawal', 30000, 'Retiro a caja fuerte', v_user_dueno, (v_cut_day + time '13:00') at time zone v_tz),
      (v_tenant, v_branch_centro, v_cut_id, 'expense', 8500, 'Papelería y bolsas', v_user_recepcion, (v_cut_day + time '15:00') at time zone v_tz);

    -- El esperado lo calcula la misma función que usa close_cash_session(), con
    -- las ventas 1 a 5 ya insertadas arriba; el conteo queda $4 por debajo.
    select expected_cents::integer into v_expected from app.cash_session_summary(v_cut_id, v_close_at);

    update cash_sessions
       set closed_by = v_user_recepcion, closed_at = v_close_at,
           expected_cents = v_expected, counted_cents = v_expected - 400, difference_cents = -400,
           closing_note = 'Faltaron $4 de cambio'
     where id = v_cut_id;
  end if;
end $$;

-- =============================================================================
-- Estado de PLATAFORMA (fase 10): lo que el superadmin toca en una demo
-- =============================================================================
-- El panel de superadmin permite suspender empresas, cambiar sus notas y dar
-- de alta empresas nuevas. Sin este bloque, todo eso se quedaría para la
-- siguiente presentación (CLAUDE.md §8.7: "no debe presentar con basura de
-- la sesión anterior"). Dos cosas:
--
--   1. Los tres negocios de la semilla vuelven a su estado original de
--      plataforma. Solo se escribe si algo CAMBIÓ (`is distinct from`): un
--      demo:reset sobre un demo intacto no genera ni una entrada de bitácora.
--      Las que sí genera (quien corre este script no tiene sesión de usuario)
--      quedan con actor "Sistema" en la pestaña Bitácora, que es la verdad.
--   2. Toda empresa que NO sea de la semilla Y esté marcada `is_demo` se
--      oculta (borrado suave). Son las que se dieron de alta durante una demo
--      con la casilla "Empresa de demostración" del formulario de alta.
--
-- Una empresa SIN esa marca se trata como real y este script no la toca:
-- `is_demo` nace en false (migración 20260925120000_tenant_is_demo.sql), así
-- que el riesgo de ocultar a un cliente real por un descuido no existe. El
-- descuido contrario (no marcar una empresa de demo) solo deja una empresa de
-- sobra en la lista, que se oculta a mano desde el panel.
--
-- Lo que NO hace, a propósito: no toca auth.users (las credenciales de demo
-- nunca cambian), así que el correo del dueño de una empresa creada en una
-- demo SIGUE REGISTRADO. Para volver a dar de alta una empresa en la
-- siguiente demo hay que usar otro correo de dueño.
do $$
declare
  v_tenant_patitas   uuid := 'b0000000-0000-4000-8000-000000000001';
  v_tenant_huellitas uuid := 'b0000000-0000-4000-8000-000000000002';
  v_tenant_mimos     uuid := 'b0000000-0000-4000-8000-000000000003';
  v_seed_tenants     uuid[];
  v_hidden_names     text;
begin
  v_seed_tenants := array[v_tenant_patitas, v_tenant_huellitas, v_tenant_mimos];

  -- Patitas Felices y Huellitas Spa: plan Básico, forma de pago indeterminada,
  -- activas, sin notas. (tarea #1906: plan/plan_name_snapshot/billing_period
  -- en vez del texto libre `plan`.)
  update tenant_platform_info
  set plan_id = (select id from plans where name = 'Básico' order by created_at limit 1),
      plan_name_snapshot = 'Básico', billing_period = 'indefinite', plan_expires_at = null,
      status = 'active', status_reason = null, internal_notes = null,
      public_reason_id = null, public_reason = null
  where tenant_id in (v_tenant_patitas, v_tenant_huellitas)
    and (plan_name_snapshot is distinct from 'Básico' or billing_period <> 'indefinite'
         or plan_expires_at is not null
         or status <> 'active' or status_reason is not null or internal_notes is not null
         or public_reason is not null);

  -- Mascotas y Mimos: suspendida, con las notas de ejemplo de seed.sql (existe
  -- para dar variedad a la lista y a los filtros del superadmin).
  update tenant_platform_info
  set plan_id = (select id from plans where name = 'Básico' order by created_at limit 1),
      plan_name_snapshot = 'Básico', billing_period = 'indefinite', plan_expires_at = null,
      status = 'suspended',
      status_reason = 'Pago de la mensualidad pendiente (ejemplo de demo)',
      public_reason_id = (select id from cancellation_reasons where kind = 'non_payment' order by created_at limit 1),
      public_reason = 'Falta de pago',
      internal_notes = 'Empresa de ejemplo para la demo. Se puede reactivar desde el detalle.'
  where tenant_id = v_tenant_mimos
    and (plan_name_snapshot is distinct from 'Básico' or billing_period <> 'indefinite'
         or plan_expires_at is not null
         or status <> 'suspended' or public_reason is distinct from 'Falta de pago'
         or status_reason is distinct from 'Pago de la mensualidad pendiente (ejemplo de demo)'
         or internal_notes is distinct from 'Empresa de ejemplo para la demo. Se puede reactivar desde el detalle.');

  -- Empresas de demostración dadas de alta durante una demo: se ocultan (borrado suave, se
  -- pueden recuperar quitando deleted_at). El aviso lista cuáles fueron.
  -- `is_demo` se consulta en tenant_platform_info (la marca vive ahí, junto
  -- al resto del estado de plataforma, no en `tenants`).
  select string_agg(t.name, ', ' order by t.name) into v_hidden_names
  from tenants t
  join tenant_platform_info i on i.tenant_id = t.id
  where t.id <> all (v_seed_tenants) and t.deleted_at is null and i.is_demo;

  update tenants t set deleted_at = now()
  from tenant_platform_info i
  where i.tenant_id = t.id
    and t.id <> all (v_seed_tenants) and t.deleted_at is null and i.is_demo;

  if v_hidden_names is not null then
    raise notice 'demo_reset: se ocultaron las empresas de demostración: %', v_hidden_names;
  end if;
end $$;
