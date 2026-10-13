<script setup lang="ts">
// Agendar una cita, en un solo formulario (tarea de UX: antes era un
// wizard de 4 pasos en su propia página, NewAppointmentPage.vue — el
// usuario lo consideró demasiados clics para lo que en realidad no
// necesita navegación secuencial). Toda la lógica reactiva es la misma
// que tenía el wizard, solo que ahora vive en un dialog reutilizable:
// como la instancia no se remonta en cada apertura (a diferencia de una
// página, que se creaba de cero por navegación), hace falta reiniciar el
// formulario cada vez que se abre — mismo patrón que CustomerFormDialog.vue.
import { useDelayedLoading } from '@/composables/useDelayedLoading'
import { computed, ref, watch } from 'vue'

import * as customersService from '@/services/customers'
import CustomerWithPetDialog from '@/components/CustomerWithPetDialog.vue'
import type { Customer } from '@/services/customers'
import * as petsService from '@/services/pets'
import type { Pet } from '@/services/pets'
import * as servicesService from '@/services/services'
import type { Service, ServiceKind } from '@/services/services'
import * as appointmentsService from '@/services/appointments'
import type { Appointment } from '@/services/appointments'
import * as branchesService from '@/services/branches'
import { listBranchEmployees } from '@/services/memberships'
import type { EmployeeSummary } from '@/services/memberships'
import { formatMXN } from '@/lib/money'
import { branchNow, branchToday, formatTime, fromBranchTime } from '@/lib/datetime'
import { computeSlotStatuses, hoursForDate, type SlotWithStatus } from '@/lib/availability'
import { appointmentRuleMessage } from '@/lib/appointmentErrors'
import { canAttendKind, roleLabel } from '@/lib/roles'
import { visitKindInfo } from '@/lib/visitKind'
import { useAgendaStore } from '@/stores/agenda'
import { useSessionStore } from '@/stores/session'
import TimeSlotPicker from '@/components/TimeSlotPicker.vue'
import { isFormValid, required } from '@/lib/validation'
import type { FormHandle } from '@/lib/validation'

const props = defineProps<{ modelValue: boolean }>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  created: [appointment: Appointment]
}>()

const session = useSessionStore()
const agenda = useAgendaStore()

const errorMessage = ref<string | null>(null)
const saving = ref(false)

// Sucursal DE LA CITA: arranca en la misma que se estaba viendo en la
// agenda, pero es su propio estado — cambiarla aquí no toca
// stores/agenda.ts ni la sesión (un dueño puede agendar en otra
// sucursal sin "moverse" de la que está viendo).
const selectedBranchId = ref<string | null>(null)

// Zona IANA de la sucursal de la cita (§8.3): de ella salen el "hoy" mínimo de la
// fecha y la hora actual con la que se marcan los horarios pasados — nunca la del
// navegador. `activeBranches` ya trae la zona de cada sucursal.
const DEFAULT_TIMEZONE = 'America/Mexico_City'
const branchTimezone = computed(
  () =>
    session.activeBranches.find((b) => b.id === selectedBranchId.value)?.timezone ??
    DEFAULT_TIMEZONE,
)
// Primer día elegible: hoy en la sucursal.
const minDate = computed(() => branchToday(branchTimezone.value))

// --- Cliente y mascota -----------------------------------------------------
const customerSearchTerm = ref('')
const customerResults = ref<Customer[]>([])
const selectedCustomer = ref<Customer | null>(null)
const customerPets = ref<Pet[]>([])
const selectedPet = ref<Pet | null>(null)

function customerLabel(customer: Customer): string {
  return `${customer.first_name} ${customer.last_name}`
}

// Con término vacío, customersService.search() regresa la lista completa
// del tenant (ver services/customers.ts) — así el autocomplete arranca
// con opciones para elegir en vez de aparecer vacío hasta que se escribe.
async function searchCustomers(): Promise<void> {
  if (!session.activeTenantId) return
  customerResults.value = await customersService.search(session.activeTenantId, customerSearchTerm.value)
}

// Al elegir una opción del autocomplete (sin borrar antes, ahora que el
// campo se queda montado siempre — pedido explícito del usuario), Vuetify
// deja el texto de búsqueda como el nombre completo del cliente elegido y
// dispara @update:search con eso. Si eso disparara una búsqueda real, el
// término (nombre + apellido juntos) no hace match ni por nombre ni por
// apellido por separado (customers.search busca "empieza con" en un solo
// campo), y customerResults quedaba vacío al reabrir el menú. El watcher
// corre en el siguiente "tick" reactivo de Vue (después de que termine el
// código síncrono que disparó el cambio), así que para cuando se evalúa
// esta condición, selectCustomer ya alcanzó a actualizar selectedCustomer
// — sin importar si Vuetify emitió el evento de búsqueda antes o después
// del de selección.
watch(customerSearchTerm, (term) => {
  if (selectedCustomer.value && customerLabel(selectedCustomer.value) === term) return
  searchCustomers()
})

async function selectCustomer(customer: Customer | null): Promise<void> {
  selectedCustomer.value = customer
  selectedPet.value = null
  customerPets.value = customer
    ? await petsService.listByCustomer(session.activeTenantId ?? '', customer.id)
    : []

  // Al limpiar la selección, se regresa el buscador a su estado inicial:
  // término vacío y la lista completa del tenant, en vez de dejar lo que
  // haya quedado de la búsqueda anterior.
  if (!customer) {
    customerSearchTerm.value = ''
    await searchCustomers()
  }
}

// Alta de un cliente nuevo con su mascota (C1.11): al guardar, la cita queda con el
// cliente y la mascota ya elegidos, lista para elegir servicios.
const showNewCustomer = ref(false)

async function handleCustomerCreated(result: { customer: Customer; pet: Pet }): Promise<void> {
  customerResults.value = [result.customer, ...customerResults.value]
  customerSearchTerm.value = customerLabel(result.customer)
  await selectCustomer(result.customer)
  selectedPet.value = customerPets.value.find((p) => p.id === result.pet.id) ?? null
}

// --- Tipo --------------------------------------------------------------
const kind = ref<ServiceKind>('grooming')

// --- Servicios -----------------------------------------------------------
const availableServices = ref<Service[]>([])
const selectedServiceIds = ref<string[]>([])

async function loadServices(): Promise<void> {
  if (!session.activeTenantId) return
  const all = await servicesService.listByKind(session.activeTenantId, kind.value)
  availableServices.value = all.filter((s) => s.is_active)
}
watch(kind, () => {
  selectedServiceIds.value = []
  loadServices()
})

const selectedServices = computed(() =>
  availableServices.value.filter((s) => selectedServiceIds.value.includes(s.id)),
)
const totalDurationMinutes = computed(() =>
  selectedServices.value.reduce((sum, s) => sum + s.duration_minutes, 0),
)
const totalPriceCents = computed(() =>
  selectedServices.value.reduce((sum, s) => sum + s.price_cents, 0),
)

// --- Empleado y horario -----------------------------------------------------
const employees = ref<EmployeeSummary[]>([])
const selectedEmployeeId = ref<string | null>(null)
const selectedDate = ref(branchToday(DEFAULT_TIMEZONE))
const availableSlots = ref<SlotWithStatus[]>([])
const selectedSlot = ref<SlotWithStatus | null>(null)
const loadingSlots = ref(false)
const showSlotsSkeleton = useDelayedLoading(loadingSlots)

// Solo quien de verdad puede ATENDER este tipo de cita aparece como
// opción — mismo criterio que valida create_appointment() en la base
// (role_permission_hardening.sql): el rol específico del tipo, u owner.
// Sin esto, se podía elegir a un groomer para una cita de veterinaria (o
// a recepción para cualquiera) y enterarse del rechazo hasta agendar.
const employeesForKind = computed(() =>
  employees.value.filter((e) => canAttendKind(e.role, kind.value)),
)

async function loadEmployees(): Promise<void> {
  if (!session.activeTenantId || !selectedBranchId.value) return
  employees.value = await listBranchEmployees(session.activeTenantId, selectedBranchId.value)
}

async function loadAvailableSlots(): Promise<void> {
  selectedSlot.value = null
  availableSlots.value = []
  if (
    !session.activeTenantId ||
    !selectedBranchId.value ||
    !selectedEmployeeId.value ||
    totalDurationMinutes.value === 0
  ) {
    return
  }

  loadingSlots.value = true
  try {
    const branch = await branchesService.getById(selectedBranchId.value)
    if (!branch) return

    const dayAppointments = await appointmentsService.listByDay(
      session.activeTenantId,
      selectedBranchId.value,
      selectedDate.value,
      branch.timezone,
    )

    const existingAppointments = dayAppointments.map((a) => ({
      employeeId: a.employee_user_id,
      startsAt: formatTime(a.starts_at, branch.timezone),
      endsAt: formatTime(a.ends_at, branch.timezone),
    }))

    availableSlots.value = computeSlotStatuses({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opening_hours es un jsonb genérico (Json) en los tipos generados; su forma real (una entrada por día de la semana) es una convención del proyecto, no algo que Postgres pueda tipar.
      branchHours: hoursForDate(branch.opening_hours as any, selectedDate.value),
      existingAppointments,
      employeeId: selectedEmployeeId.value,
      durationMinutes: totalDurationMinutes.value,
      // Pedido en el UAT: horarios cada 30 minutos, no 15 — coincide con
      // la duración mínima real de un servicio del catálogo.
      stepMinutes: 30,
      // Los horarios pasados y el traslape se calculan con la hora de la sucursal.
      date: selectedDate.value,
      now: branchNow(branch.timezone),
    })
  } finally {
    loadingSlots.value = false
  }
}
watch([selectedEmployeeId, selectedDate, totalDurationMinutes], loadAvailableSlots)

// Cambiar de sucursal invalida al empleado y horario ya elegidos —
// probablemente ni siquiera trabajan ahí (mismo criterio que
// stores/agenda.ts#setBranch con su filtro de empleado).
watch(selectedBranchId, () => {
  selectedEmployeeId.value = null
  loadEmployees()
})

// Reinicia el formulario cada vez que se abre: el dialog es una sola
// instancia que se reutiliza (no se vuelve a montar como hacía la
// página con cada navegación a /citas/nueva).
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return

    errorMessage.value = null
    saving.value = false

    selectedBranchId.value = agenda.activeBranchId

    customerSearchTerm.value = ''
    customerResults.value = []
    selectedCustomer.value = null
    customerPets.value = []
    selectedPet.value = null

    kind.value = 'grooming'
    selectedServiceIds.value = []

    selectedEmployeeId.value = null
    // Nunca antes de hoy en la sucursal: si la agenda estaba en un día pasado, se
    // arranca en hoy.
    const today = branchToday(branchTimezone.value)
    selectedDate.value =
      agenda.activeDate && agenda.activeDate > today ? agenda.activeDate : today
    availableSlots.value = []
    selectedSlot.value = null

    loadEmployees()
    loadServices()
    searchCustomers()
  },
)

// --- Envío -----------------------------------------------------------------
// Los campos obligatorios se marcan con * y los revisa el formulario al agendar (no se
// desactiva el botón: la persona vería "Agendar" apagado sin saber qué falta).
const formRef = ref<FormHandle | null>(null)

function close(): void {
  emit('update:modelValue', false)
}

async function handleSubmit(): Promise<void> {
  if (!(await isFormValid(formRef.value))) return
  if (!selectedSlot.value) {
    errorMessage.value = 'Elige un horario disponible.'
    return
  }
  if (
    !session.activeTenantId ||
    !selectedBranchId.value ||
    !selectedCustomer.value ||
    !selectedPet.value ||
    !selectedEmployeeId.value ||
    !selectedSlot.value
  ) {
    return
  }

  saving.value = true
  errorMessage.value = null
  try {
    const branch = await branchesService.getById(selectedBranchId.value)
    if (!branch) throw new Error('sucursal no encontrada')

    const startsAt = fromBranchTime(selectedDate.value, selectedSlot.value.startsAt, branch.timezone)
    const endsAt = fromBranchTime(selectedDate.value, selectedSlot.value.endsAt, branch.timezone)

    const appointment = await appointmentsService.create({
      tenantId: session.activeTenantId,
      branchId: selectedBranchId.value,
      customerId: selectedCustomer.value.id,
      petId: selectedPet.value.id,
      kind: kind.value,
      employeeUserId: selectedEmployeeId.value,
      startsAt,
      endsAt,
      services: selectedServiceIds.value.map((serviceId) => ({ serviceId })),
    })

    close()
    emit('created', appointment)
  } catch (error) {
    // Pasado, fuera de horario o día cerrado traen su propio mensaje; el resto,
    // el genérico de siempre.
    errorMessage.value =
      appointmentRuleMessage(error) ??
      'No se pudo agendar la cita. Puede que el horario ya no esté disponible — revisa e intenta de nuevo.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="900"
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>Nueva cita</v-card-title>

      <v-card-text>
        <!-- Sin manejador de envío: Enter dentro de la búsqueda de clientes no debe agendar. -->
        <v-form ref="formRef" @submit.prevent>
          <!-- Sucursal DE LA CITA. Con una sola sucursal no hay nada que
               elegir — mismo criterio que el resto de los selectores de
               sucursal de la app. -->
          <v-select
            v-if="session.activeBranches.length > 1"
            v-model="selectedBranchId"
            :items="session.activeBranches"
            item-title="name"
            item-value="id"
            label="Sucursal de la cita*"
            :rules="[required]"
            density="compact"
            variant="outlined"
            class="mb-2"
            style="max-width: 280px"
          />

          <v-row>
            <v-col cols="12" md="6">
              <!-- Cliente y mascota -->
              <p class="text-overline text-medium-emphasis">Cliente y mascota</p>

              <!-- El autocomplete se queda montado siempre, seleccionado o
                   no (pedido explícito del usuario: nada de cambiar a un
                   texto + botón "Cambiar"). Con no-filter, Vuetify no
                   filtra del lado del cliente, así que aunque el cuadro
                   muestre el nombre ya elegido, el menú sigue ofreciendo
                   toda customerResults — elegir otro cliente es un solo
                   clic, directo. -->
              <v-autocomplete
                :model-value="selectedCustomer"
                :items="customerResults"
                :item-title="customerLabel"
                no-filter
                return-object
                label="Buscar cliente por nombre o apellido*"
                :rules="[required]"
                prepend-inner-icon="mdi-magnify"
                density="compact"
                variant="outlined"
                @update:model-value="selectCustomer"
                @update:search="customerSearchTerm = $event"
              />

              <v-btn
                variant="text"
                size="small"
                prepend-icon="mdi-account-plus"
                class="mt-1"
                @click="showNewCustomer = true"
              >
                Cliente nuevo
              </v-btn>

              <!-- Solo se elige entre las mascotas ya registradas del cliente; una
                   mascota más se agrega desde la página del cliente. -->
              <div v-if="selectedCustomer" class="d-flex align-center flex-wrap ga-2 mt-2">
                <span class="font-weight-bold">Mascota:</span>
                <v-chip-group v-model="selectedPet" mandatory>
                  <v-chip
                    v-for="pet in customerPets"
                    :key="pet.id"
                    :value="pet"
                    :prepend-icon="pet.species === 'cat' ? 'mdi-cat' : 'mdi-dog'"
                    filter
                  >
                    {{ pet.name }}
                  </v-chip>
                </v-chip-group>
              </div>

              <v-divider class="my-4" />

              <!-- Tipo: dos botones independientes, no v-btn-toggle (pedido
                   explícito del usuario). El resaltado del elegido se hace
                   a mano con :color/:variant, pero el comportamiento sigue
                   siendo "uno u otro": kind siempre tiene un valor, y
                   hacer clic en un botón solo lo reemplaza por el otro. -->
              <p class="text-overline text-medium-emphasis">Tipo de cita</p>
              <div class="d-flex ga-2 mb-2">
                <v-btn
                  :color="visitKindInfo('grooming').color"
                  :prepend-icon="visitKindInfo('grooming').icon"
                  :variant="kind === 'grooming' ? 'flat' : 'outlined'"
                  @click="kind = 'grooming'"
                >
                  Estética
                </v-btn>
                <v-btn
                  :color="visitKindInfo('veterinary').color"
                  :prepend-icon="visitKindInfo('veterinary').icon"
                  :variant="kind === 'veterinary' ? 'flat' : 'outlined'"
                  @click="kind = 'veterinary'"
                >
                  Veterinaria
                </v-btn>
              </div>

              <v-divider class="my-4" />

              <!-- Servicios -->
              <p class="text-overline text-medium-emphasis">Servicios</p>
              <v-select
                v-model="selectedServiceIds"
                :items="availableServices"
                item-title="name"
                item-value="id"
                multiple
                chips
                label="Servicios*"
                :rules="[required]"
                density="compact"
                variant="outlined"
              >
                <!-- En la lista desplegada, la info completa (nombre,
                     duración, precio) — pedido explícito del usuario. -->
                <template #item="{ item, props: itemProps }">
                  <v-list-item
                    v-bind="itemProps"
                    :title="item.raw.name"
                    :subtitle="`${item.raw.duration_minutes} min — ${formatMXN(item.raw.price_cents)}`"
                  />
                </template>
                <!-- En el chip ya elegido, solo el nombre. -->
                <template #chip="{ item, props: chipProps }">
                  <v-chip v-bind="chipProps" :text="item.raw.name" />
                </template>
              </v-select>
              <p v-if="availableServices.length === 0" class="text-medium-emphasis">
                No hay servicios activos en esta categoría.
              </p>
              <p class="mt-2 text-body-2">
                Total: {{ totalDurationMinutes }} min · {{ formatMXN(totalPriceCents) }}
              </p>
            </v-col>

            <v-col cols="12" md="6">
              <!-- Empleado y horario -->
              <p class="text-overline text-medium-emphasis">Empleado y horario</p>

              <!-- Solo empleados que pueden ATENDER este tipo de cita
                   (employeesForKind: su rol, u owner) — el backend igual lo
                   revalida (create_appointment()), esto solo evita ofrecer
                   una opción que se va a rechazar. -->
              <v-select
                v-model="selectedEmployeeId"
                :items="employeesForKind"
                item-title="fullName"
                item-value="userId"
                label="Empleado*"
                :rules="[required]"
                density="compact"
                variant="outlined"
              >
                <!-- Cada empleado con su puesto (D26 punto 3): chip con texto,
                     nunca solo un color. -->
                <template #item="{ item, props: itemProps }">
                  <v-list-item v-bind="itemProps" :title="item.raw.fullName">
                    <template #append>
                      <v-chip size="small" variant="tonal">{{ roleLabel(item.raw.role) }}</v-chip>
                    </template>
                  </v-list-item>
                </template>
                <template #selection="{ item }">
                  <span class="mr-2">{{ item.raw.fullName }}</span>
                  <v-chip size="small" variant="tonal">{{ roleLabel(item.raw.role) }}</v-chip>
                </template>
              </v-select>
              <p v-if="employeesForKind.length === 0" class="text-medium-emphasis text-body-2 mb-2">
                No hay nadie que pueda atender este tipo de cita en esta sucursal.
              </p>
              <v-text-field
                v-model="selectedDate"
                type="date"
                :min="minDate"
                label="Fecha*"
                :rules="[required]"
                density="compact"
                variant="outlined"
              />

              <!-- El picker solo se pinta una vez que ya hay con qué buscar
                   huecos (empleado + al menos un servicio). Antes de eso
                   no hay una búsqueda real que haya fallado, así que no
                   corresponde mostrar "no hay huecos disponibles". -->
              <p class="text-body-2 mb-1">Horario*</p>
              <div v-if="loadingSlots" style="min-height: 48px">
                <v-skeleton-loader v-if="showSlotsSkeleton" type="chip@6" />
              </div>
              <TimeSlotPicker
                v-else-if="selectedEmployeeId && totalDurationMinutes > 0"
                v-model="selectedSlot"
                :slots="availableSlots"
              />
              <p v-else class="text-medium-emphasis text-body-2">
                Elige empleado y al menos un servicio para ver los horarios disponibles.
              </p>
            </v-col>
          </v-row>

          <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mt-4">
            {{ errorMessage }}
          </v-alert>
        </v-form>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">Cancelar</v-btn>
        <v-btn color="primary" :loading="saving" @click="handleSubmit">
          Agendar
        </v-btn>
      </v-card-actions>

      <CustomerWithPetDialog
        v-model="showNewCustomer"
        :tenant-id="session.activeTenantId ?? ''"
        phone-required
        @saved="handleCustomerCreated"
      />
    </v-card>
  </v-dialog>
</template>
