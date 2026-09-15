<script setup lang="ts">
// Agendar una cita, en un solo formulario (tarea de UX: antes era un
// wizard de 4 pasos en su propia página, NewAppointmentPage.vue — el
// usuario lo consideró demasiados clics para lo que en realidad no
// necesita navegación secuencial). Toda la lógica reactiva es la misma
// que tenía el wizard, solo que ahora vive en un dialog reutilizable:
// como la instancia no se remonta en cada apertura (a diferencia de una
// página, que se creaba de cero por navegación), hace falta reiniciar el
// formulario cada vez que se abre — mismo patrón que CustomerFormDialog.vue.
import { computed, ref, watch } from 'vue'
import { format } from 'date-fns'

import * as customersService from '@/services/customers'
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
import { formatTime, fromBranchTime } from '@/lib/datetime'
import { computeAvailableSlots, hoursForDate, type AvailableSlot } from '@/lib/availability'
import { canAttendKind } from '@/lib/roles'
import { useAgendaStore } from '@/stores/agenda'
import { useSessionStore } from '@/stores/session'
import TimeSlotPicker from '@/components/TimeSlotPicker.vue'

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
const selectedDate = ref(format(new Date(), 'yyyy-MM-dd'))
const availableSlots = ref<AvailableSlot[]>([])
const selectedSlot = ref<AvailableSlot | null>(null)
const loadingSlots = ref(false)

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

    availableSlots.value = computeAvailableSlots({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opening_hours es un jsonb genérico (Json) en los tipos generados; su forma real (una entrada por día de la semana) es una convención del proyecto, no algo que Postgres pueda tipar.
      branchHours: hoursForDate(branch.opening_hours as any, selectedDate.value),
      existingAppointments,
      employeeId: selectedEmployeeId.value,
      durationMinutes: totalDurationMinutes.value,
      // Pedido en el UAT: horarios cada 30 minutos, no 15 — coincide con
      // la duración mínima real de un servicio del catálogo.
      stepMinutes: 30,
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
    selectedDate.value = agenda.activeDate ?? format(new Date(), 'yyyy-MM-dd')
    availableSlots.value = []
    selectedSlot.value = null

    loadEmployees()
    loadServices()
    searchCustomers()
  },
)

// --- Envío -----------------------------------------------------------------
const canSubmit = computed(
  () =>
    selectedCustomer.value != null &&
    selectedPet.value != null &&
    selectedServiceIds.value.length > 0 &&
    selectedEmployeeId.value != null &&
    selectedSlot.value != null,
)

function close(): void {
  emit('update:modelValue', false)
}

async function handleSubmit(): Promise<void> {
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
  } catch {
    errorMessage.value =
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
        <!-- Sucursal DE LA CITA. Con una sola sucursal no hay nada que
             elegir — mismo criterio que el resto de los selectores de
             sucursal de la app. -->
        <v-select
          v-if="session.activeBranches.length > 1"
          v-model="selectedBranchId"
          :items="session.activeBranches"
          item-title="name"
          item-value="id"
          label="Sucursal de la cita"
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
              label="Buscar cliente por nombre o apellido"
              prepend-inner-icon="mdi-magnify"
              density="compact"
              variant="outlined"
              @update:model-value="selectCustomer"
              @update:search="customerSearchTerm = $event"
            />

            <!-- Solo se elige entre las mascotas ya registradas del
                 cliente: dar de alta una mascota nueva desde este
                 dialog quedó fuera de alcance (pedido explícito del
                 usuario) — si no existe, se registra primero desde
                 la ficha del cliente. -->
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
                :color="kind === 'grooming' ? 'primary' : undefined"
                :variant="kind === 'grooming' ? 'flat' : 'outlined'"
                @click="kind = 'grooming'"
              >
                Estética
              </v-btn>
              <v-btn
                :color="kind === 'veterinary' ? 'primary' : undefined"
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
              label="Servicios"
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
              label="Empleado"
              density="compact"
              variant="outlined"
            />
            <p v-if="employeesForKind.length === 0" class="text-medium-emphasis text-body-2 mb-2">
              No hay nadie que pueda atender este tipo de cita en esta sucursal.
            </p>
            <v-text-field
              v-model="selectedDate"
              type="date"
              label="Fecha"
              density="compact"
              variant="outlined"
            />

            <!-- El picker solo se pinta una vez que ya hay con qué buscar
                 huecos (empleado + al menos un servicio). Antes de eso
                 no hay una búsqueda real que haya fallado, así que no
                 corresponde mostrar "no hay huecos disponibles". -->
            <v-progress-circular v-if="loadingSlots" indeterminate color="primary" />
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
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">Cancelar</v-btn>
        <v-btn color="primary" :loading="saving" :disabled="!canSubmit" @click="handleSubmit">
          Agendar
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
