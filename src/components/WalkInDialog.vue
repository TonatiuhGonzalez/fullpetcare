<script setup lang="ts">
// Registrar una visita sin cita (tarea #1969): alguien llegó directo al
// establecimiento, por emergencia o sin saber del sistema. Pensado para
// hacerse de pie frente al mostrador: sin elegir fecha ni horario (la
// atención empieza ahora, o cuando se libere el empleado elegido) y con el
// alta de cliente y mascota adentro, pidiendo solo lo mínimo: nombre y
// teléfono del cliente, nombre y especie de la mascota. El resto de la
// ficha se completa después desde Clientes.
//
// Crea una cita normal marcada como visita sin cita (appointments.is_walk_in),
// así que atender, cobrar y el historial funcionan sin cambios.
//
// Mismo patrón que NewAppointmentDialog.vue: una sola instancia que se
// reutiliza, por eso el formulario se reinicia cada vez que se abre.
import { computed, ref, watch } from 'vue'

import * as customersService from '@/services/customers'
import type { Customer } from '@/services/customers'
import * as petsService from '@/services/pets'
import type { Pet } from '@/services/pets'
import * as servicesService from '@/services/services'
import type { Service, ServiceKind } from '@/services/services'
import * as appointmentsService from '@/services/appointments'
import type { Appointment } from '@/services/appointments'
import { listBranchEmployees } from '@/services/memberships'
import type { EmployeeSummary } from '@/services/memberships'
import { formatMXN } from '@/lib/money'
import { branchToday, formatTime, fromBranchTime } from '@/lib/datetime'
import { canAttendKind } from '@/lib/roles'
import { isValidPhone } from '@/lib/validation'
import { speciesLabel } from '@/lib/petLabels'
import { computeEmployeeWaits, waitLabel, type WalkInBusyRange } from '@/lib/walkIn'
import { visitKindInfo } from '@/lib/visitKind'
import { useAgendaStore } from '@/stores/agenda'
import { useSessionStore } from '@/stores/session'

const props = defineProps<{ modelValue: boolean }>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  created: [appointment: Appointment]
}>()

const session = useSessionStore()
const agenda = useAgendaStore()

const errorMessage = ref<string | null>(null)
const saving = ref(false)

// Una visita sin cita es "aquí y ahora": siempre en la sucursal que se está
// viendo en la agenda, sin selector (a diferencia de una cita agendada).
const branchId = computed(() => agenda.activeBranchId)
const branchTimezone = computed(
  () => session.activeBranches.find((b) => b.id === branchId.value)?.timezone ?? 'America/Mexico_City',
)

// --- Cliente ---------------------------------------------------------------
// 'new': alta rápida (nombre, apellido, teléfono). 'existing': ya está
// registrado, se busca. Dos botones independientes en vez de v-btn-toggle,
// mismo criterio que el selector de tipo de NewAppointmentDialog.vue.
const customerMode = ref<'new' | 'existing'>('new')

const newFirstName = ref('')
const newLastName = ref('')
const newPhone = ref('')

const customerSearchTerm = ref('')
const customerResults = ref<Customer[]>([])
const selectedCustomer = ref<Customer | null>(null)

// Si el alta del cliente sale bien pero algo falla DESPUÉS (por ejemplo, el
// empleado se ocupó en ese instante), al reintentar se reutiliza este
// cliente en vez de crear un duplicado.
const createdCustomer = ref<Customer | null>(null)
const createdPet = ref<Pet | null>(null)

const phoneRules = [(v: string) => isValidPhone(v) || 'Debe tener 10 dígitos']
const requiredRules = [(v: string) => v.trim() !== '' || 'Obligatorio']

function customerLabel(customer: Customer): string {
  return `${customer.first_name} ${customer.last_name}`
}

async function searchCustomers(): Promise<void> {
  if (!session.activeTenantId) return
  customerResults.value = await customersService.search(session.activeTenantId, customerSearchTerm.value)
}

// Mismo cuidado que NewAppointmentDialog.vue: al elegir una opción, Vuetify
// deja el nombre completo como texto de búsqueda y no debe disparar otra
// búsqueda (no haría match y vaciaría la lista).
watch(customerSearchTerm, (term) => {
  if (selectedCustomer.value && customerLabel(selectedCustomer.value) === term) return
  searchCustomers()
})

// --- Mascota ---------------------------------------------------------------
// Con cliente nuevo la mascota siempre es nueva. Con cliente existente se
// elige una de las suyas o se da de alta otra ('new').
const customerPets = ref<Pet[]>([])
const petChoice = ref<Pet | 'new' | null>(null)
const newPetName = ref('')
const newPetSpecies = ref<Pet['species']>('dog')

const speciesOptions = (['dog', 'cat', 'other'] as Pet['species'][]).map((value) => ({
  value,
  title: speciesLabel(value),
}))

async function selectCustomer(customer: Customer | null): Promise<void> {
  selectedCustomer.value = customer
  petChoice.value = null
  customerPets.value = customer
    ? await petsService.listByCustomer(session.activeTenantId ?? '', customer.id)
    : []
  // Sin mascotas registradas, no hay nada que elegir: directo al alta.
  if (customer && customerPets.value.length === 0) petChoice.value = 'new'

  if (!customer) {
    customerSearchTerm.value = ''
    await searchCustomers()
  }
}

const isNewPet = computed(() => customerMode.value === 'new' || petChoice.value === 'new')

// --- Tipo y servicios ------------------------------------------------------
const kind = ref<ServiceKind>('grooming')
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

const isUrgent = ref(false)
const notes = ref('')

// --- Empleado: quién está libre ya y a quién le toca esperar ---------------
const employees = ref<EmployeeSummary[]>([])
const busyRanges = ref<WalkInBusyRange[]>([])
const nowTime = ref('00:00')
const selectedEmployeeId = ref<string | null>(null)

const employeesForKind = computed(() =>
  employees.value.filter((e) => canAttendKind(e.role, kind.value)),
)

const employeeWaits = computed(() =>
  computeEmployeeWaits({
    employeeIds: employeesForKind.value.map((e) => e.userId),
    busyRanges: busyRanges.value,
    nowTime: nowTime.value,
    durationMinutes: totalDurationMinutes.value,
  }),
)

const employeeOptions = computed(() =>
  employeeWaits.value.map((wait) => ({
    userId: wait.employeeId,
    name: employees.value.find((e) => e.userId === wait.employeeId)?.fullName ?? '(empleado)',
    label: waitLabel(wait.waitMinutes),
  })),
)

const selectedWait = computed(
  () => employeeWaits.value.find((w) => w.employeeId === selectedEmployeeId.value) ?? null,
)

// Preselecciona a quien menos espera (la lista ya viene ordenada así); si el
// empleado elegido deja de ser opción (cambió el tipo, por ejemplo), se
// reemplaza.
watch(employeeWaits, (waits) => {
  if (!waits.some((w) => w.employeeId === selectedEmployeeId.value)) {
    selectedEmployeeId.value = waits[0]?.employeeId ?? null
  }
})

/** Vuelve a pedir la agenda de hoy y toma la hora actual de la sucursal. */
async function refreshBusy(): Promise<void> {
  if (!session.activeTenantId || !branchId.value) return
  nowTime.value = formatTime(new Date(), branchTimezone.value)

  const today = await appointmentsService.listByDay(
    session.activeTenantId,
    branchId.value,
    branchToday(branchTimezone.value),
    branchTimezone.value,
  )
  // Canceladas y "no se presentó" dejan el horario libre de verdad;
  // las completadas ya pasaron (mismo criterio que la base al validar traslape).
  busyRanges.value = today
    .filter((a) => a.status === 'scheduled' || a.status === 'in_progress')
    .map((a) => ({
      employeeId: a.employee_user_id,
      startsAt: formatTime(a.starts_at, branchTimezone.value),
      endsAt: formatTime(a.ends_at, branchTimezone.value),
    }))
}

async function loadEmployees(): Promise<void> {
  if (!session.activeTenantId || !branchId.value) return
  employees.value = await listBranchEmployees(session.activeTenantId, branchId.value)
}

// Reinicia el formulario cada vez que se abre.
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return

    errorMessage.value = null
    saving.value = false

    customerMode.value = 'new'
    newFirstName.value = ''
    newLastName.value = ''
    newPhone.value = ''
    customerSearchTerm.value = ''
    customerResults.value = []
    selectedCustomer.value = null
    createdCustomer.value = null
    createdPet.value = null

    customerPets.value = []
    petChoice.value = null
    newPetName.value = ''
    newPetSpecies.value = 'dog'

    kind.value = 'grooming'
    selectedServiceIds.value = []
    isUrgent.value = false
    notes.value = ''
    selectedEmployeeId.value = null

    loadEmployees()
    loadServices()
    refreshBusy()
  },
)

function setCustomerMode(mode: 'new' | 'existing'): void {
  customerMode.value = mode
  if (mode === 'existing' && customerResults.value.length === 0) searchCustomers()
}

// --- Envío -----------------------------------------------------------------
const customerReady = computed(() =>
  customerMode.value === 'new'
    ? newFirstName.value.trim() !== '' &&
      newLastName.value.trim() !== '' &&
      isValidPhone(newPhone.value)
    : selectedCustomer.value != null,
)

const petReady = computed(() =>
  isNewPet.value ? newPetName.value.trim() !== '' : petChoice.value != null,
)

const canSubmit = computed(
  () =>
    customerReady.value &&
    petReady.value &&
    selectedServiceIds.value.length > 0 &&
    selectedWait.value != null,
)

function close(): void {
  emit('update:modelValue', false)
}

async function handleSubmit(): Promise<void> {
  const tenantId = session.activeTenantId
  const wait = selectedWait.value
  if (!tenantId || !branchId.value || !selectedEmployeeId.value || !wait) return

  saving.value = true
  errorMessage.value = null
  try {
    // 1) Cliente: el alta rápida solo pide lo mínimo.
    let customer: Customer
    if (customerMode.value === 'new') {
      createdCustomer.value ??= await customersService.create({
        tenant_id: tenantId,
        first_name: newFirstName.value.trim(),
        last_name: newLastName.value.trim(),
        phone: newPhone.value.trim(),
      })
      customer = createdCustomer.value
    } else if (selectedCustomer.value) {
      customer = selectedCustomer.value
    } else {
      return
    }

    // 2) Mascota: existente, o alta rápida (nombre y especie).
    let pet: Pet
    if (isNewPet.value) {
      createdPet.value ??= await petsService.create({
        tenant_id: tenantId,
        customer_id: customer.id,
        name: newPetName.value.trim(),
        species: newPetSpecies.value,
      })
      pet = createdPet.value
    } else if (petChoice.value && petChoice.value !== 'new') {
      pet = petChoice.value
    } else {
      return
    }

    // 3) La visita. Sin espera → empieza en este instante (no en el minuto
    // redondeado que se mostró). Con espera → empieza cuando el empleado
    // quede libre, y la cita queda "agendada" hasta entonces.
    const duration = totalDurationMinutes.value
    const startsAt =
      wait.waitMinutes === 0
        ? new Date()
        : fromBranchTime(branchToday(branchTimezone.value), wait.startsAt, branchTimezone.value)
    const endsAt = new Date(startsAt.getTime() + duration * 60_000)

    const appointment = await appointmentsService.createWalkIn({
      tenantId,
      branchId: branchId.value,
      customerId: customer.id,
      petId: pet.id,
      kind: kind.value,
      employeeUserId: selectedEmployeeId.value,
      startsAt,
      endsAt,
      isUrgent: isUrgent.value,
      notes: notes.value.trim() || null,
      services: selectedServiceIds.value.map((serviceId) => ({ serviceId })),
    })

    close()
    emit('created', appointment)
  } catch {
    errorMessage.value =
      'No se pudo registrar la visita. Puede que el empleado ya esté ocupado — revisa e intenta de nuevo.'
    // La agenda pudo cambiar mientras se llenaba el formulario.
    refreshBusy()
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
      <v-card-title>Llegada sin cita</v-card-title>

      <v-card-text>
        <v-row>
          <v-col cols="12" md="6">
            <p class="text-overline text-medium-emphasis">Cliente</p>
            <div class="d-flex ga-2 mb-3">
              <v-btn
                :color="customerMode === 'new' ? 'primary' : undefined"
                :variant="customerMode === 'new' ? 'flat' : 'outlined'"
                @click="setCustomerMode('new')"
              >
                Cliente nuevo
              </v-btn>
              <v-btn
                :color="customerMode === 'existing' ? 'primary' : undefined"
                :variant="customerMode === 'existing' ? 'flat' : 'outlined'"
                @click="setCustomerMode('existing')"
              >
                Ya registrado
              </v-btn>
            </div>

            <template v-if="customerMode === 'new'">
              <v-text-field
                v-model="newFirstName"
                label="Nombre"
                density="compact"
                variant="outlined"
                :rules="requiredRules"
              />
              <v-text-field
                v-model="newLastName"
                label="Apellido"
                density="compact"
                variant="outlined"
                :rules="requiredRules"
              />
              <v-text-field
                v-model="newPhone"
                label="Teléfono (10 dígitos)"
                type="tel"
                density="compact"
                variant="outlined"
                :rules="phoneRules"
              />
            </template>

            <template v-else>
              <v-autocomplete
                :model-value="selectedCustomer"
                :items="customerResults"
                :item-title="customerLabel"
                no-filter
                return-object
                label="Buscar por nombre, apellido o teléfono"
                prepend-inner-icon="mdi-magnify"
                density="compact"
                variant="outlined"
                @update:model-value="selectCustomer"
                @update:search="customerSearchTerm = $event"
              />
              <div v-if="selectedCustomer" class="d-flex align-center flex-wrap ga-2 mb-2">
                <span class="font-weight-bold">Mascota:</span>
                <v-chip-group v-model="petChoice" mandatory>
                  <v-chip
                    v-for="pet in customerPets"
                    :key="pet.id"
                    :value="pet"
                    :prepend-icon="pet.species === 'cat' ? 'mdi-cat' : 'mdi-dog'"
                    filter
                  >
                    {{ pet.name }}
                  </v-chip>
                  <v-chip value="new" prepend-icon="mdi-plus" filter>Mascota nueva</v-chip>
                </v-chip-group>
              </div>
            </template>

            <!-- Alta rápida de mascota: cliente nuevo, o cliente existente
                 que eligió "Mascota nueva". -->
            <template v-if="isNewPet && (customerMode === 'new' || selectedCustomer)">
              <p class="text-overline text-medium-emphasis mt-2">Mascota nueva</p>
              <v-text-field
                v-model="newPetName"
                label="Nombre de la mascota"
                density="compact"
                variant="outlined"
                :rules="requiredRules"
              />
              <v-select
                v-model="newPetSpecies"
                :items="speciesOptions"
                item-title="title"
                item-value="value"
                label="Especie"
                density="compact"
                variant="outlined"
              />
            </template>

            <v-divider class="my-4" />

            <p class="text-overline text-medium-emphasis">Tipo de visita</p>
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
          </v-col>

          <v-col cols="12" md="6">
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
              <template #item="{ item, props: itemProps }">
                <v-list-item
                  v-bind="itemProps"
                  :title="item.raw.name"
                  :subtitle="`${item.raw.duration_minutes} min — ${formatMXN(item.raw.price_cents)}`"
                />
              </template>
              <template #chip="{ item, props: chipProps }">
                <v-chip v-bind="chipProps" :text="item.raw.name" />
              </template>
            </v-select>
            <p v-if="availableServices.length === 0" class="text-medium-emphasis">
              No hay servicios activos en esta categoría.
            </p>
            <p class="mb-2 text-body-2">
              Total: {{ totalDurationMinutes }} min · {{ formatMXN(totalPriceCents) }}
            </p>

            <v-switch
              v-model="isUrgent"
              color="error"
              label="Urgente (emergencia)"
              density="compact"
              hide-details
            />
            <v-textarea
              v-model="notes"
              label="Motivo o notas (opcional)"
              rows="2"
              auto-grow
              density="compact"
              variant="outlined"
              class="mt-2"
            />

            <v-divider class="my-4" />

            <p class="text-overline text-medium-emphasis">Quién la atiende</p>
            <p
              v-if="totalDurationMinutes === 0"
              class="text-medium-emphasis text-body-2"
            >
              Elige al menos un servicio para ver quién está libre.
            </p>
            <template v-else>
              <v-select
                v-model="selectedEmployeeId"
                :items="employeeOptions"
                item-title="name"
                item-value="userId"
                label="Empleado"
                density="compact"
                variant="outlined"
              >
                <template #item="{ item, props: itemProps }">
                  <v-list-item
                    v-bind="itemProps"
                    :title="item.raw.name"
                    :subtitle="item.raw.label"
                  />
                </template>
              </v-select>
              <p v-if="employeeOptions.length === 0" class="text-medium-emphasis text-body-2">
                No hay nadie que pueda atender este tipo de visita hoy en esta sucursal.
              </p>
              <v-alert
                v-else-if="selectedWait"
                :type="selectedWait.waitMinutes === 0 ? 'success' : 'warning'"
                density="compact"
                variant="tonal"
              >
                <template v-if="selectedWait.waitMinutes === 0">
                  Puede pasar ahora mismo.
                </template>
                <template v-else>
                  Este empleado está ocupado. La visita quedaría para las
                  {{ selectedWait.startsAt }} ({{ waitLabel(selectedWait.waitMinutes).toLowerCase() }}).
                </template>
              </v-alert>
            </template>
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
          Registrar visita
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
