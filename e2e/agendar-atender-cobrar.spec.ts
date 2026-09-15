// El único test E2E del proyecto (tarea 6.9, CLAUDE.md D12): recorre el
// flujo completo que promete el producto — agendar, atender, cobrar — y de
// paso confirma que la venta queda en el historial de la mascota (fase 6).
// Corre contra Supabase LOCAL real (Docker, no una base de mentira):
// valida que TODAS las piezas encajan juntas (router, stores, RLS, la
// función checkout_appointment()...), algo que ningún test unitario por sí
// solo puede confirmar.
//
// Qué protege cada paso, en caso de que falle:
//
// 1. Login — si esto falla, nada de lo demás importa: es la puerta de
//    entrada a toda la app.
// 2. Agendar una cita de estética — prueba el formulario completo de
//    NewAppointmentDialog.vue (fase 3, rediseñado a un solo dialog) y la
//    función create_appointment().
// 3. Atender con notas — prueba que la transición
//    scheduled → in_progress → completed funciona de punta a punta
//    (fase 4), incluido el arreglo de la carrera de estado del PR #28: si
//    ese bug volviera, este test lo atraparía otra vez.
// 4. Cobrar en efectivo — prueba checkout_appointment() de punta a punta
//    (fase 5): folio, desglose de IVA, ticket.
// 5. Verificar el total en el ticket — confirma que lib/money.ts y el RPC
//    de la base siguen de acuerdo en el mismo número.
// 6. Verificar que aparece en el historial de la mascota — confirma que
//    services/petHistory.ts (fase 6) ve la cita recién cobrada, con las
//    notas que se acaban de escribir (no una entrada vieja parecida).
//
// Desde AppointmentDialog.vue (2026-09-10) los pasos 2-4 ya NO navegan a
// /app/citas/:id, /atender ni /cobrar — todo pasa dentro de un solo
// diálogo sobre /app/agenda, así que este test ya no espera esas URLs:
// espera los textos/botones de cada etapa del diálogo, y vuelve a hacer
// clic sobre el bloque de la cita en la agenda cada vez que una acción
// (Atender/Terminar) lo cierra.
import { test, expect } from '@playwright/test'

const DUENO_EMAIL = 'dueno@patitasfelices.mx'
const DUENO_PASSWORD = 'Demo1234!'

// Ids fijos de la semilla de demo (supabase/tests/fixtures.ts): Sofía
// Ramírez Castillo, su perro Rocky, y el servicio "Baño".
const PET_ROCKY_ID = 'e0000000-0000-4000-8000-000000000001'

test('agendar → atender → cobrar, y que la visita quede en el historial de la mascota', async ({
  page,
}) => {
  const groomerNotes = `Se portó tranquilo — corrida de prueba ${Date.now()}`

  // 1. Login
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(DUENO_EMAIL)
  await page.locator('input[type="password"]').fill(DUENO_PASSWORD)
  await page.locator('button', { hasText: /iniciar sesión|entrar/i }).click()
  await page.waitForURL(/\/(app|seleccionar-negocio)/)

  // El dueño de la demo pertenece a un solo negocio (Patitas Felices) con
  // DOS sucursales — SelectBusinessPage.vue salta el paso "elige tu
  // negocio" solo (hay una única membresía) y muestra directo "Elige la
  // sucursal". Se espera ESE título específico, no cualquier
  // v-list-item: mientras useSessionStore todavía está cargando las
  // membresías, la página puede pintar brevemente el paso de "negocio"
  // primero — hacerle clic a lo que sea ahí es la carrera que tumbaba
  // este test en CI (Ubuntu es más lento que la Mac para esto).
  if (page.url().includes('seleccionar-negocio')) {
    await page.getByText('Elige la sucursal').waitFor()
    await page.locator('.v-list-item').first().click()
    await page.waitForURL(/\/app\//)
  }

  // 2. Agendar una cita de estética para Rocky — todo en un solo dialog,
  // sin pasos intermedios (NewAppointmentDialog.vue).
  //
  // Todo lo que se llena queda DENTRO del dialog (locator "dialog" a
  // continuación): AgendaPage.vue, detrás del dialog, tiene su propio
  // v-select "Empleado" (el filtro de la agenda) y su propia lista de
  // citas del día — sin acotar los selectores a un lado u otro, Playwright
  // encuentra dos elementos que hacen match y falla en modo estricto.
  await page.goto('/app/agenda')
  await page.locator('button', { hasText: 'Nueva cita' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()

  // El buscador de cliente es un v-autocomplete (rediseño de UX): su menú
  // también se pinta en un overlay fuera del dialog — mismo caso que el
  // v-select de Empleado, un poco más abajo.
  await dialog.getByLabel(/Buscar cliente/i).fill('Sofía')
  await page.locator('.v-list-item', { hasText: 'Sofía' }).first().click()
  await dialog.locator('.v-chip', { hasText: 'Rocky' }).first().click()

  await dialog.locator('button', { hasText: 'Estética' }).click()

  // Servicios es un v-select de selección múltiple con chips (rediseño de
  // UX, ya no checkboxes): se abre el menú — el listado con nombre,
  // duración y precio se pinta en un overlay fuera del dialog — se elige
  // "Baño" y se cierra con Escape (si no, el menú se queda abierto y
  // estorba el siguiente click, porque un v-select "multiple" no se
  // cierra solo al elegir una opción).
  await dialog.locator('.v-select', { hasText: 'Servicios' }).click()
  await page.locator('.v-list-item', { hasText: 'Baño' }).first().click()
  await page.keyboard.press('Escape')

  // El menú del v-select se pinta en un overlay fuera del propio dialog
  // (por eso la opción se busca en "page", no en "dialog"), pero el
  // v-select que lo abre sí es el de adentro.
  await dialog.locator('.v-select', { hasText: 'Empleado' }).click()
  await page.getByRole('option').first().click()

  // El PRIMER hueco disponible, sea cual sea — no un horario fijo. Así el
  // test no choca si se corre más de una vez sin reiniciar la base (el
  // hueco que usó la corrida anterior ya no aparecería disponible).
  const slot = dialog.locator('.v-chip', { hasText: /^\d{2}:\d{2}$/ }).first()
  await slot.waitFor({ state: 'visible' })
  await slot.click()

  await dialog.locator('button', { hasText: 'Agendar' }).click()

  // NewAppointmentDialog se cierra y AppointmentDialog.vue se abre solo,
  // ya para la cita recién creada (etapa 'info': "Detalle de la cita").
  await expect(page.getByText('Detalle de la cita')).toBeVisible()

  // 3. Atender: solo cambia el estado (scheduled → in_progress) y CIERRA
  // el diálogo — pedido explícito del usuario (2026-09-10). Para llenar
  // la ficha hay que volver a hacer clic sobre el bloque de la cita en
  // la agenda, ya en su nuevo color ("En curso").
  await page.locator('button', { hasText: 'Atender' }).click()
  await expect(page.getByText('Detalle de la cita')).toBeHidden()

  await page.getByText('Sofía Ramírez', { exact: false }).first().click()
  await expect(page.getByText('Atender cita')).toBeVisible()

  // Nota de groomer que sirve de "huella" única para el paso 6 (así el
  // assert final no puede confundirse con una visita vieja de otra
  // corrida o de otro test). "Terminar" dispara el guardado de la ficha
  // (GroomingRecordForm) y, si se guarda bien, cierra el diálogo.
  await page.getByLabel('Notas del groomer').fill(groomerNotes)
  await page.locator('button', { hasText: 'Terminar' }).click()
  await expect(page.getByText('Atender cita')).toBeHidden()

  // 4. Cobrar en efectivo — "Cobrar" desliza al mismo formulario que antes
  // vivía en /cobrar, DENTRO del diálogo (pedido explícito del usuario).
  await page.getByText('Sofía Ramírez', { exact: false }).first().click()
  await page.getByRole('button', { name: 'Cobrar', exact: true }).click()
  await expect(page.getByText('Subtotal')).toBeVisible()

  // Acotado al diálogo (page.getByRole('dialog')): tanto "Nueva cita" del
  // encabezado de AgendaPage.vue como el botón de "+" para agregar un
  // pago usan el mismo ícono mdi-plus — sin acotar, Playwright puede
  // resolver "button:has(.mdi-plus)" al del encabezado, que además queda
  // bloqueado por el scrim del diálogo.
  const checkoutDialog = page.getByRole('dialog')
  await checkoutDialog.locator('button', { hasText: 'Todo' }).first().click()
  await checkoutDialog.locator('button:has(.mdi-plus)').click()
  await checkoutDialog.locator('button', { hasText: /Cobrar \$/ }).click()

  // 5. El ticket queda mostrándose en el mismo diálogo (con su botón
  // "Imprimir", TicketView) con el total de Baño ($250.00, IVA incluido
  // — seed.sql).
  const ticket = page.locator('.ticket-print')
  await expect(ticket).toBeVisible()
  await expect(ticket).toContainText('$250.00')

  // 6. El historial de Rocky ve esta visita, con la nota que se acaba de
  // escribir — prueba que services/petHistory.ts (fase 6) refleja la cita
  // recién cobrada, no solo que "algo" se guardó.
  await page.goto(`/app/mascotas/${PET_ROCKY_ID}`)
  await expect(page.getByText(groomerNotes)).toBeVisible()
})
