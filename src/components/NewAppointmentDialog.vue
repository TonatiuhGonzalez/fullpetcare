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
import CustomerFormDialog from '@/components/CustomerFormDialog.vue'
import PetFormDialog from '@/components/PetFormDialog.vue'
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
const showNewCustomerDialog = ref(false)
const showNewPetDialog = ref(false)

async function searchCustomers(): Promise<void> {
  if (!session.activeTenantId) return
  customerResults.value = await customersService.search(session.activeTenantId, customerSearchTerm.value)
}
watch(customerSearchTerm, searchCustomers)

async function selectCustomer(customer: Customer): Promise<void> {
  selectedCustomer.value = customer
  selectedPet.value = null
  customerPets.value = await petsService.listByCustomer(session.activeTenantId ?? '', customer.id)
}

function handleNewCustomerSaved(customer: Customer): void {
  selectCustomer(customer)
}
function handleNewPetSaved(pet: Pet): void {
  selectedPet.value = pet
  customerPets.value.push(pet)
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

            <div v-if="!selectedCustomer">
              <v-text-field
                v-model="customerSearchTerm"
                label="Buscar cliente por nombre o apellido"
                prepend-inner-icon="mdi-magnify"
                density="compact"
                variant="outlined"
              />
              <v-list>
                <v-list-item
                  v-for="customer in customerResults"
                  :key="customer.id"
                  :title="`${customer.first_name} ${customer.last_name}`"
                  @click="selectCustomer(customer)"
                />
              </v-list>
              <v-btn variant="text" prepend-icon="mdi-plus" @click="showNewCustomerDialog = true">
                Cliente nuevo
              </v-btn>
            </div>

            <div v-else>
              <p class="mb-2">
                <strong>Cliente:</strong> {{ selectedCustomer.first_name }} {{ selectedCustomer.last_name }}
                <v-btn variant="text" size="small" @click="selectedCustomer = null">Cambiar</v-btn>
              </p>

              <p class="mb-1"><strong>Mascota:</strong></p>
              <v-chip-group v-model="selectedPet" mandatory column>
                <v-chip v-for="pet in customerPets" :key="pet.id" :value="pet" filter>
                  {{ pet.name }}
                </v-chip>
              </v-chip-group>
              <v-btn variant="text" prepend-icon="mdi-plus" @click="showNewPetDialog = true">
                Mascota nueva
              </v-btn>
            </div>

            <v-divider class="my-4" />

            <!-- Tipo -->
            <p class="text-overline text-medium-emphasis">Tipo de cita</p>
            <v-btn-toggle v-model="kind" mandatory color="primary" class="mb-2">
              <v-btn value="grooming">Estética</v-btn>
              <v-btn value="veterinary">Veterinaria</v-btn>
            </v-btn-toggle>

            <v-divider class="my-4" />

            <!-- Servicios -->
            <p class="text-overline text-medium-emphasis">Servicios</p>
            <v-checkbox
              v-for="service in availableServices"
              :key="service.id"
              v-model="selectedServiceIds"
              :value="service.id"
              :label="`${service.name} — ${service.duration_minutes} min — ${formatMXN(service.price_cents)}`"
              density="compact"
              hide-details
            />
            <p v-if="availableServices.length === 0" class="text-medium-emphasis">
              No hay servicios activos en esta categoría.
            </p>
            <p v-if="selectedServices.length > 0" class="mt-2 text-body-2">
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

            <v-progress-circular v-if="loadingSlots" indeterminate color="primary" />
            <TimeSlotPicker v-else v-model="selectedSlot" :slots="availableSlots" />
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

    <CustomerFormDialog
      v-model="showNewCustomerDialog"
      :tenant-id="session.activeTenantId ?? ''"
      @saved="handleNewCustomerSaved"
    />
    <PetFormDialog
      v-if="selectedCustomer"
      v-model="showNewPetDialog"
      :tenant-id="session.activeTenantId ?? ''"
      :customer-id="selectedCustomer.id"
      @saved="handleNewPetSaved"
    />
  </v-dialog>
</template>
