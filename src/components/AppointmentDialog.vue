<script setup lang="ts">
// Diálogo único para interactuar con una cita desde la agenda (pedido
// explícito del usuario, 2026-09-10: antes esto eran dos PÁGINAS
// completas, AppointmentDetailPage.vue y AttendPage.vue, y hacer clic en
// una cita navegaba fuera de la agenda). Junta la lógica de ambas en tres
// "etapas" según el estado de la cita:
//
//   - 'info'     (status = 'scheduled'):  datos de la cita, sin editar.
//                Botones: [Cerrar, Editar ▾ (solo owner/receptionist:
//                Reagendar/Cancelar cita), Atender].
//   - 'attend'   (status = 'in_progress'): la ficha de estética o de
//                veterinaria (antes /atender). Botones: [Cerrar, Terminar].
//   - 'readonly' (completed/cancelled/no_show): solo información. Owner/
//                receptionist además ve "Cobrar" si ya se completó.
//
// "Atender" y "Terminar" NO navegan a ningún lado: cambian el estado de la
// cita (igual que hacían las páginas viejas) y cierran el diálogo — la
// agenda de fondo se recarga (evento `changed`) para que el bloque cambie
// de color al instante.
//
// AppointmentDetailPage.vue y AttendPage.vue NO se eliminaron: siguen
// siendo el camino real desde "Próximas citas" de la ficha de una mascota
// y desde el botón de regreso de CheckoutPage — este diálogo solo
// reemplaza la interacción al hacer clic en un bloque de la agenda.
//
// Cobro (pedido explícito del usuario, 2026-09-10): "Cobrar" en la etapa
// 'readonly' YA NO navega a /app/citas/:id/cobrar — desliza (`view`,
// v-window con transición tipo slide) hacia el mismo formulario que tenía
// CheckoutPage.vue, dentro de este mismo diálogo. Ese paso NO tiene botón
// de regreso: la única salida es "Cerrar". Si la cita ya se cobró (ahora
// o en una sesión anterior — `ticket` no nace vacío, load() lo llena si ya
// existe una venta para esta cita, services/checkout.ts#findSaleIdForAppointment),
// el diálogo muestra directo el ticket (TicketView, que ya trae su propio
// botón "Imprimir") en vez de la información editable — sin "Cobrar" y sin
// pasar por el slide, porque no hay nada que cobrar de nuevo.
import { computed, ref, watch } from 'vue'

import * as appointmentsService from '@/services/appointments'
import type { Appointment } from '@/services/appointments'
import * as customersService from '@/services/customers'
import type { Customer } from '@/services/customers'
import * as petsService from '@/services/pets'
import type { Pet } from '@/services/pets'
import * as branchesService from '@/services/branches'
import type { Branch } from '@/services/branches'
import { listBranchEmployees } from '@/services/memberships'
import type { EmployeeSummary } from '@/services/memberships'
import * as recordsService from '@/services/records'
import type { GroomingRecord, MedicalRecord, VaccinationWithName } from '@/services/records'
import * as checkoutService from '@/services/checkout'
import type { PaymentMethod, Ticket } from '@/services/checkout'
import * as invoiceRequestsService from '@/services/invoiceRequests'
import { formatDate, formatTime, fromBranchTime } from '@/lib/datetime'
import { formatMXN, pesosToCents } from '@/lib/money'
import { isFrontDesk } from '@/lib/roles'
import { useSessionStore } from '@/stores/session'
import { useCartStore } from '@/stores/cart'
import GroomingRecordForm from '@/components/GroomingRecordForm.vue'
import MedicalRecordForm from '@/components/MedicalRecordForm.vue'
import VaccinationDialog from '@/components/VaccinationDialog.vue'
import TicketView from '@/components/TicketView.vue'

const props = defineProps<{
  modelValue: boolean
  /** null cuando no hay ninguna cita seleccionada todavía. */
  appointmentId: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** La cita cambió de estado/horario — la agenda debe recargar sus bloques. */
  changed: []
}>()

const session = useSessionStore()
const cart = useCartStore()
const isFrontDeskUser = computed(() => isFrontDesk(session.role))

// 'appointment': el contenido normal por etapa (info/atender/solo lectura).
// 'checkout': el formulario de cobro (antes CheckoutPage.vue), dentro del
// mismo diálogo. Nunca se usa si `ticket` ya tiene valor — ver el
// comentario de cabecera.
const view = ref<'appointment' | 'checkout'>('appointment')

const appointment = ref<Appointment | null>(null)
const branch = ref<Branch | null>(null)
const customer = ref<Customer | null>(null)
const pet = ref<Pet | null>(null)
const lines = ref<import('@/services/appointments').AppointmentService[]>([])
const employees = ref<EmployeeSummary[]>([])
const existingGrooming = ref<GroomingRecord | null>(null)
const existingMedical = ref<MedicalRecord | null>(null)
const appliedVaccines = ref<VaccinationWithName[]>([])

const loading = ref(false)
const errorMessage = ref<string | null>(null)

const showReschedule = ref(false)
const rescheduleDate = ref('')
const rescheduleTime = ref('')
const rescheduling = ref(false)
const cancelling = ref(false)
const attending = ref(false)
const terminando = ref(false)
const showVaccinationDialog = ref(false)

// --- Cobro (etapa 'readonly' de una cita completada) ------------------
// Si no es null, la cita YA se cobró (en esta sesión o antes) — se
// muestra el ticket en vez de cualquier otra cosa (ver comentario de
// cabecera). Mismo objeto que devuelve services/checkout.ts, listo para
// TicketView.
const ticket = ref<Ticket | null>(null)
const discountInPesos = ref<number | null>(null)
const newPaymentMethod = ref<PaymentMethod>('cash')
const newPaymentAmountInPesos = ref<number | null>(null)
const requiresInvoice = ref(false)
const charging = ref(false)
const chargeError = ref<string | null>(null)

const methodLabels: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer_spei: 'Transferencia',
  openpay: 'Openpay',
}

/** El cliente tiene capturados los datos fiscales que pide invoice_requests. */
const customerHasFiscalData = computed(
  () =>
    !!customer.value?.rfc &&
    !!customer.value?.legal_name &&
    !!customer.value?.tax_regime_code &&
    !!customer.value?.cfdi_use &&
    !!customer.value?.postal_code,
)

// La ficha de estética/veterinaria se monta o desmonta según `kind` — no
// hay forma de tipar bien "un ref que a veces apunta a GroomingRecordForm
// y a veces a MedicalRecordForm" sin pelear con los tipos que expone Vue
// para componentes con <script setup>; CLAUDE.md §5.1 acepta `any` con
// TODO en estos casos en vez de perder tiempo en eso.
// TODO: tipar si algún día molesta de verdad.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver el comentario de arriba.
const formRef = ref<any>(null)

const kindLabels: Record<string, string> = { grooming: 'Estética', veterinary: 'Veterinaria' }
const statusLabels: Record<string, string> = {
  scheduled: 'Agendada',
  in_progress: 'En curso',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show: 'No se presentó',
}

const stage = computed<'info' | 'attend' | 'readonly'>(() => {
  if (!appointment.value) return 'info'
  if (appointment.value.status === 'scheduled') return 'info'
  if (appointment.value.status === 'in_progress') return 'attend'
  return 'readonly'
})

function employeeName(userId: string): string {
  return employees.value.find((e) => e.userId === userId)?.fullName ?? '(empleado)'
}

async function load(id: string): Promise<void> {
  const tenantId = session.activeTenantId
  if (!tenantId) return

  // Limpia lo que hubiera de una cita anterior — sin esto, al abrir el
  // diálogo para OTRA cita se alcanza a ver un instante los datos viejos
  // antes de que termine de cargar la nueva.
  appointment.value = null
  existingGrooming.value = null
  existingMedical.value = null
  appliedVaccines.value = []
  view.value = 'appointment'
  ticket.value = null
  chargeError.value = null

  loading.value = true
  errorMessage.value = null
  try {
    const found = await appointmentsService.getById(tenantId, id)
    appointment.value = found
    if (!found) return

    const [foundBranch, foundCustomer, foundPet, foundLines] = await Promise.all([
      branchesService.getById(found.branch_id),
      customersService.getById(tenantId, found.customer_id),
      petsService.getById(tenantId, found.pet_id),
      appointmentsService.listServices(found.id),
    ])
    branch.value = foundBranch
    customer.value = foundCustomer
    pet.value = foundPet
    lines.value = foundLines
    if (foundBranch) {
      employees.value = await listBranchEmployees(tenantId, found.branch_id)
    }

    if (found.status === 'in_progress') {
      if (found.kind === 'grooming') {
        existingGrooming.value = await recordsService.getGroomingRecordByAppointment(found.id)
      } else {
        existingMedical.value = await recordsService.getMedicalRecordByAppointment(found.id)
        appliedVaccines.value = await recordsService.listVaccinationsByPet(tenantId, found.pet_id)
      }
    }

    // ¿Ya se cobró? (de una sesión anterior — si se acaba de cobrar en
    // ESTA apertura del diálogo, `ticket` ya lo tiene handleCharge() sin
    // pasar por aquí). Ver el comentario de cabecera.
    if (found.status === 'completed') {
      const saleId = await checkoutService.findSaleIdForAppointment(found.id)
      if (saleId) ticket.value = await checkoutService.getTicket(saleId)
    }
  } catch {
    errorMessage.value = 'No se pudo cargar la cita. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

// Se dispara al abrir el diálogo (o si, ya abierto, le cambian el id —
// no pasa hoy en la agenda, pero deja el componente correcto de todos
// modos) — nunca mientras está cerrado.
watch(
  () => [props.modelValue, props.appointmentId] as const,
  ([open, id]) => {
    if (open && id) load(id)
  },
  { immediate: true },
)

function close(): void {
  emit('update:modelValue', false)
}

async function handleAttend(): Promise<void> {
  if (!appointment.value || !session.activeTenantId) return
  attending.value = true
  errorMessage.value = null
  try {
    await appointmentsService.changeStatus(session.activeTenantId, appointment.value.id, 'in_progress')
    emit('changed')
    close()
  } catch {
    errorMessage.value = 'No se pudo iniciar la atención de la cita.'
  } finally {
    attending.value = false
  }
}

async function handleCancel(): Promise<void> {
  if (!appointment.value || !session.activeTenantId) return
  cancelling.value = true
  errorMessage.value = null
  try {
    await appointmentsService.cancel(session.activeTenantId, appointment.value.id)
    emit('changed')
    close()
  } catch {
    // Mismo motivo que en AppointmentDetailPage.vue: puede ser un
    // problema de red o una transición que ya no tiene sentido (la cita
    // se completó justo antes de que cancelaras) — lib/appointmentStatus.ts
    // decide qué transiciones existen.
    errorMessage.value = 'No se pudo cancelar la cita.'
  } finally {
    cancelling.value = false
  }
}

function openReschedule(): void {
  if (!appointment.value || !branch.value) return
  rescheduleDate.value = formatDate(appointment.value.starts_at, branch.value.timezone)
  rescheduleTime.value = formatTime(appointment.value.starts_at, branch.value.timezone)
  showReschedule.value = true
}

async function handleReschedule(): Promise<void> {
  if (!appointment.value || !branch.value) return
  rescheduling.value = true
  errorMessage.value = null
  try {
    const durationMs =
      new Date(appointment.value.ends_at).getTime() - new Date(appointment.value.starts_at).getTime()
    const startsAt = fromBranchTime(rescheduleDate.value, rescheduleTime.value, branch.value.timezone)
    const endsAt = new Date(startsAt.getTime() + durationMs)

    await appointmentsService.reschedule(appointment.value.id, startsAt, endsAt)
    showReschedule.value = false
    emit('changed')
    close()
  } catch {
    errorMessage.value =
      'No se pudo reagendar — puede que el empleado ya tenga otra cita en ese horario.'
  } finally {
    rescheduling.value = false
  }
}

// El botón "Terminar" del diálogo no es el submit del formulario — vive
// en el pie del diálogo, fuera del <v-form> de GroomingRecordForm /
// MedicalRecordForm. Por eso dispara el guardado llamando a submit() en
// el ref expuesto (defineExpose en esos componentes); el resultado real
// (¿se guardó?) sigue llegando por el evento @saved de siempre, que es
// handleRecordSaved() aquí abajo.
async function handleTerminar(): Promise<void> {
  terminando.value = true
  try {
    await formRef.value?.submit()
  } finally {
    terminando.value = false
  }
}

async function handleRecordSaved(): Promise<void> {
  if (!appointment.value || !session.activeTenantId) return
  try {
    await appointmentsService.changeStatus(session.activeTenantId, appointment.value.id, 'completed')
    emit('changed')
    close()
  } catch {
    errorMessage.value = 'La ficha se guardó, pero no se pudo marcar la cita como completada.'
  }
}

// Se recarga la lista completa (no se anexa a mano) para mostrar el
// nombre de la vacuna, no el vaccine_id crudo — mismo criterio que
// AttendPage.vue.
async function handleVaccinationSaved(): Promise<void> {
  if (!session.activeTenantId || !pet.value) return
  appliedVaccines.value = await recordsService.listVaccinationsByPet(session.activeTenantId, pet.value.id)
}

// --- Cobro --------------------------------------------------------------
// "Cobrar" en el pie SOLO desliza a este formulario (useCartStore carga
// las partidas) — no cobra nada todavía. El cobro real lo hace
// handleCharge() más abajo, con su propio botón dentro del formulario
// (igual que en CheckoutPage.vue). Pedido explícito del usuario: no hay
// botón de regreso desde aquí — la única salida es "Cerrar".
function startCheckout(): void {
  if (!appointment.value) return
  discountInPesos.value = null
  newPaymentMethod.value = 'cash'
  newPaymentAmountInPesos.value = null
  requiresInvoice.value = customer.value?.requires_invoice ?? false
  chargeError.value = null
  view.value = 'checkout'
  cart.loadAppointment(appointment.value.id)
}

function applyDiscount(): void {
  cart.setDiscount(discountInPesos.value != null ? pesosToCents(discountInPesos.value) : 0)
}

function handleAddPayment(): void {
  if (newPaymentAmountInPesos.value == null || newPaymentAmountInPesos.value <= 0) return
  cart.addPayment({
    method: newPaymentMethod.value,
    amountCents: pesosToCents(newPaymentAmountInPesos.value),
  })
  newPaymentAmountInPesos.value = null
}

/** Prellena el pago con exactamente lo que falta — el caso más común (un solo método). */
function fillRemaining(): void {
  newPaymentAmountInPesos.value = cart.remainingCents / 100
}

async function handleCharge(): Promise<void> {
  if (!session.activeTenantId || !customer.value) return
  charging.value = true
  chargeError.value = null
  try {
    const chargedTicket = await cart.checkout()

    if (requiresInvoice.value && customerHasFiscalData.value) {
      await invoiceRequestsService.create(
        session.activeTenantId,
        chargedTicket.sale.id,
        {
          rfc: customer.value.rfc!,
          legalName: customer.value.legal_name!,
          taxRegimeCode: customer.value.tax_regime_code!,
          cfdiUse: customer.value.cfdi_use!,
          postalCode: customer.value.postal_code!,
        },
        chargedTicket.payments.map((p) => ({ method: p.method, amountCents: p.amount_cents })),
      )
    }

    // No se cierra el diálogo aquí (a diferencia de Atender/Terminar):
    // pedido explícito del usuario — al cobrar se queda en un modal
    // informativo con el ticket y su botón "Imprimir" (TicketView), y el
    // usuario decide cuándo cerrarlo.
    ticket.value = chargedTicket
    emit('changed')
  } catch (err) {
    chargeError.value = checkoutErrorMessage(err)
  } finally {
    charging.value = false
  }
}

/**
 * checkout_appointment() (checkout_rpc.sql) rechaza casos de negocio con un
 * mensaje propio en español — se reconocen aquí por su texto para
 * mostrarlos tal cual, en vez de un genérico "revisa tu conexión" que sería
 * falso (CLAUDE.md §5.4). Mismo criterio que CheckoutPage.vue.
 */
function checkoutErrorMessage(err: unknown): string {
  const message =
    typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message)
      : ''

  if (/no cubre el total/i.test(message)) return 'El monto pagado no cubre el total de la venta.'
  if (/ya fue cobrada/i.test(message)) return 'Esta cita ya fue cobrada.'
  if (/debe estar atendida/i.test(message)) {
    return 'Esta cita todavía no está atendida — no se puede cobrar.'
  }
  if (/no tienes permiso para cobrar/i.test(message)) {
    return 'No tienes permiso para cobrar citas.'
  }
  if (/no perteneces|no tienes acceso/i.test(message)) {
    return 'No tienes acceso para cobrar esta cita.'
  }
  return 'No se pudo cobrar la cita. Revisa tu conexión.'
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="640"
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>
        {{ ticket ? 'Cobro' : view === 'checkout' ? 'Cobrar' : stage === 'attend' ? 'Atender cita' : 'Detalle de la cita' }}
      </v-card-title>

      <v-card-text>
        <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mb-4">
          {{ errorMessage }}
        </v-alert>

        <v-progress-circular v-if="loading && !appointment" indeterminate color="primary" />

        <!-- La cita ya se cobró (ahora o antes): solo el ticket, sin
             pasar por el slide de abajo — no hay nada que cobrar de
             nuevo. TicketView ya trae su propio botón "Imprimir". -->
        <TicketView v-else-if="ticket" :ticket="ticket" />

        <!-- 'appointment' ⇄ 'checkout': el único slide de este diálogo,
             el que pide el usuario al presionar "Cobrar" (v-window con
             transición horizontal). Una vez que existe `ticket` (arriba)
             este v-window deja de usarse por completo. -->
        <v-window v-else-if="appointment && branch" v-model="view">
          <v-window-item value="appointment">
            <!-- Etapas 'info' y 'readonly': mismos datos de solo lectura,
                 solo cambian los botones del pie (más abajo). -->
            <template v-if="stage !== 'attend'">
              <div class="d-flex align-center mb-2">
                <h2 class="text-h6">
                  {{ formatDate(appointment.starts_at, branch.timezone) }} ·
                  {{ formatTime(appointment.starts_at, branch.timezone) }}–{{
                    formatTime(appointment.ends_at, branch.timezone)
                  }}
                </h2>
                <v-spacer />
                <v-chip size="small" variant="tonal">{{ statusLabels[appointment.status] }}</v-chip>
              </div>

              <p class="mb-1">
                <strong>Cliente:</strong> {{ customer?.first_name }} {{ customer?.last_name }}
              </p>
              <p class="mb-1"><strong>Mascota:</strong> {{ pet?.name }}</p>
              <p class="mb-1"><strong>Tipo:</strong> {{ kindLabels[appointment.kind] }}</p>
              <p class="mb-1">
                <strong>Empleado:</strong> {{ employeeName(appointment.employee_user_id) }}
              </p>
              <p v-if="appointment.notes" class="mb-1 text-body-2 text-medium-emphasis">
                {{ appointment.notes }}
              </p>

              <v-divider class="my-3" />

              <p class="text-subtitle-2 mb-1">Servicios</p>
              <v-list density="compact">
                <v-list-item v-for="line in lines" :key="line.id">
                  <template #title>{{ line.name_snapshot }}</template>
                  <template #subtitle>{{ line.duration_minutes_snapshot }} min</template>
                  <template #append>{{ formatMXN(line.unit_price_cents * line.quantity) }}</template>
                </v-list-item>
              </v-list>
            </template>

            <!-- Etapa 'attend': la ficha de estética o veterinaria, igual
                 que antes vivía en AttendPage.vue. -->
            <template v-else-if="pet">
              <h2 class="text-h6 mb-1">{{ pet.name }}</h2>
              <p class="text-body-2 text-medium-emphasis mb-4">
                {{ customer?.first_name }} {{ customer?.last_name }} ·
                {{ kindLabels[appointment.kind] }}
              </p>

              <GroomingRecordForm
                v-if="appointment.kind === 'grooming'"
                ref="formRef"
                :tenant-id="session.activeTenantId!"
                :appointment-id="appointment.id"
                :pet-id="pet.id"
                :initial-record="existingGrooming"
                hide-submit-button
                @saved="handleRecordSaved"
              />

              <template v-else>
                <MedicalRecordForm
                  ref="formRef"
                  :tenant-id="session.activeTenantId!"
                  :appointment-id="appointment.id"
                  :pet-id="pet.id"
                  :initial-record="existingMedical"
                  hide-submit-button
                  @saved="handleRecordSaved"
                />

                <v-divider class="my-4" />

                <div class="d-flex align-center justify-space-between mb-2">
                  <p class="text-subtitle-2">Vacunas aplicadas</p>
                  <v-btn
                    size="small"
                    variant="tonal"
                    prepend-icon="mdi-needle"
                    @click="showVaccinationDialog = true"
                  >
                    Aplicar vacuna
                  </v-btn>
                </div>
                <v-list v-if="appliedVaccines.length" density="compact">
                  <v-list-item
                    v-for="v in appliedVaccines"
                    :key="v.id"
                    :title="v.vaccineName"
                    :subtitle="formatDate(v.applied_at, branch.timezone)"
                  />
                </v-list>
                <p v-else class="text-body-2 text-medium-emphasis">
                  Esta mascota no tiene vacunas registradas.
                </p>

                <VaccinationDialog
                  v-model="showVaccinationDialog"
                  :tenant-id="session.activeTenantId!"
                  :pet-id="pet.id"
                  :pet-species="pet.species"
                  :applied-by-user-id="session.user!.id"
                  :branch-timezone="branch.timezone"
                  :appointment-id="appointment.id"
                  @saved="handleVaccinationSaved"
                />
              </template>
            </template>
          </v-window-item>

          <!-- Etapa de cobro (antes CheckoutPage.vue) — llega aquí SOLO
               al presionar "Cobrar" en el pie de abajo (startCheckout()).
               El botón "Cobrar $total" vive DENTRO de este contenido, no
               en el pie del diálogo (mismo lugar que tenía en la vista
               vieja) — el pie, mientras se está en este slide, solo
               ofrece "Cerrar". -->
          <v-window-item value="checkout">
            <p class="text-body-2 text-medium-emphasis mb-4">
              {{ customer?.first_name }} {{ customer?.last_name }}
            </p>

            <v-list density="compact">
              <v-list-item v-for="item in cart.lineItems" :key="item.serviceId">
                <template #title>
                  {{ item.description }} {{ item.quantity > 1 ? `× ${item.quantity}` : '' }}
                </template>
                <template #append>{{ formatMXN(item.unitPriceCents * item.quantity) }}</template>
              </v-list-item>
            </v-list>

            <v-divider class="my-3" />

            <div class="d-flex justify-space-between text-body-2 mb-1">
              <span>Subtotal</span>
              <span>{{ formatMXN(cart.subtotalCents) }}</span>
            </div>
            <div class="d-flex justify-space-between text-body-2 mb-2">
              <span>IVA</span>
              <span>{{ formatMXN(cart.taxCents) }}</span>
            </div>

            <v-text-field
              v-model.number="discountInPesos"
              label="Descuento (MXN)"
              type="number"
              min="0"
              step="0.01"
              density="compact"
              @update:model-value="applyDiscount"
            />

            <div class="d-flex justify-space-between text-h6 mb-3">
              <span>Total</span>
              <span>{{ formatMXN(cart.totalCents) }}</span>
            </div>

            <v-divider class="my-3" />

            <p class="text-subtitle-2 mb-2">Forma de pago</p>

            <v-list v-if="cart.payments.length > 0" density="compact" class="mb-2">
              <v-list-item v-for="(payment, index) in cart.payments" :key="index">
                <template #title>{{ methodLabels[payment.method] }}</template>
                <template #append>
                  <span class="mr-2">{{ formatMXN(payment.amountCents) }}</span>
                  <v-btn icon="mdi-close" size="x-small" variant="text" @click="cart.removePayment(index)" />
                </template>
              </v-list-item>
            </v-list>

            <div class="d-flex align-end ga-2 mb-2">
              <v-select
                v-model="newPaymentMethod"
                :items="[
                  { title: 'Efectivo', value: 'cash' },
                  { title: 'Tarjeta', value: 'card' },
                  { title: 'Transferencia', value: 'transfer_spei' },
                  { title: 'Openpay', value: 'openpay' },
                ]"
                label="Método"
                density="compact"
                hide-details
              />
              <v-text-field
                v-model.number="newPaymentAmountInPesos"
                label="Monto (MXN)"
                type="number"
                min="0"
                step="0.01"
                density="compact"
                hide-details
              />
              <v-btn variant="text" size="small" @click="fillRemaining">Todo</v-btn>
              <v-btn icon="mdi-plus" color="primary" variant="tonal" @click="handleAddPayment" />
            </div>

            <p class="text-body-2 mb-3">
              Pagado: {{ formatMXN(cart.paidCents) }} · Falta: {{ formatMXN(cart.remainingCents) }}
            </p>

            <v-checkbox
              v-model="requiresInvoice"
              label="Requiere factura"
              density="compact"
              :disabled="!customerHasFiscalData"
            />
            <p v-if="requiresInvoice && !customerHasFiscalData" class="text-caption text-warning mb-2">
              Este cliente no tiene datos fiscales completos — edítalos en su ficha antes de facturar.
            </p>

            <v-alert v-if="chargeError" type="error" density="compact" variant="tonal" class="mb-3">
              {{ chargeError }}
            </v-alert>

            <v-btn
              block
              color="primary"
              size="large"
              :loading="charging"
              :disabled="!cart.isFullyPaid"
              @click="handleCharge"
            >
              Cobrar {{ formatMXN(cart.totalCents) }}
            </v-btn>
          </v-window-item>
        </v-window>
      </v-card-text>

      <v-card-actions v-if="appointment">
        <v-btn variant="text" @click="close">Cerrar</v-btn>
        <v-spacer />

        <!-- Mientras se cobra (o ya se cobró, arriba) el pie no ofrece
             más que "Cerrar" — pedido explícito del usuario: nada de
             volver a "Cobrar" desde aquí. -->
        <template v-if="!ticket && view === 'appointment'">
          <template v-if="stage === 'info'">
            <v-menu v-if="isFrontDeskUser">
              <template #activator="{ props: menuProps }">
                <v-btn variant="text" prepend-icon="mdi-pencil" append-icon="mdi-menu-down" v-bind="menuProps">
                  Editar
                </v-btn>
              </template>
              <v-list density="compact">
                <v-list-item prepend-icon="mdi-calendar-edit" title="Reagendar" @click="openReschedule" />
                <v-list-item
                  prepend-icon="mdi-close"
                  title="Cancelar cita"
                  :disabled="cancelling"
                  @click="handleCancel"
                />
              </v-list>
            </v-menu>
            <v-btn color="primary" :loading="attending" @click="handleAttend">Atender</v-btn>
          </template>

          <v-btn v-else-if="stage === 'attend'" color="primary" :loading="terminando" @click="handleTerminar">
            Terminar
          </v-btn>

          <v-btn
            v-else-if="isFrontDeskUser && appointment.status === 'completed'"
            color="primary"
            prepend-icon="mdi-cash-register"
            @click="startCheckout"
          >
            Cobrar
          </v-btn>
        </template>
      </v-card-actions>
    </v-card>

    <v-dialog v-model="showReschedule" max-width="420">
      <v-card>
        <v-card-title>Reagendar cita</v-card-title>
        <v-card-text>
          <v-text-field v-model="rescheduleDate" type="date" label="Fecha" density="compact" />
          <v-text-field v-model="rescheduleTime" type="time" label="Hora" density="compact" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showReschedule = false">Cancelar</v-btn>
          <v-btn color="primary" :loading="rescheduling" @click="handleReschedule">Guardar</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-dialog>
</template>
