<script setup lang="ts">
// Agendar una cita, paso a paso (tarea 3.18): cliente y mascota (con
// alta rápida) → tipo → servicios → empleado y horario, usando los
// huecos calculados por lib/availability.ts.
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { format } from 'date-fns'

import * as customersService from '@/services/customers'
import type { Customer } from '@/services/customers'
import * as petsService from '@/services/pets'
import type { Pet } from '@/services/pets'
import * as servicesService from '@/services/services'
import type { Service, ServiceKind } from '@/services/services'
import * as appointmentsService from '@/services/appointments'
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

const session = useSessionStore()
const agenda = useAgendaStore()
const router = useRouter()

const step = ref(1)
const errorMessage = ref<string | null>(null)
const saving = ref(false)

// Sucursal de LA CITA (UAT: antes no había forma de elegirla — se usaba
// siempre la de la agenda sin decírselo a quien agenda). Arranca en la
// misma sucursal que se estaba viendo en la agenda, pero es su propio
// estado: cambiarla aquí no toca stores/agenda.ts ni la sesión.
const selectedBranchId = ref<string | null>(agenda.activeBranchId)

// --- Paso 1: cliente y mascota -------------------------------------------
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

// --- Paso 2: tipo ----------------------------------------------------------
const kind = ref<ServiceKind>('grooming')

// --- Paso 3: servicios -------------------------------------------------
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

// --- Paso 4: empleado y horario -----------------------------------------
const employees = ref<EmployeeSummary[]>([])
const selectedEmployeeId = ref<string | null>(null)
const selectedDate = ref(agenda.activeDate ?? format(new Date(), 'yyyy-MM-dd'))
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

onMounted(() => {
  if (!agenda.activeBranchId) agenda.initFromSession()
  if (!selectedBranchId.value) selectedBranchId.value = agenda.activeBranchId
  loadEmployees()
})

// --- Envío -----------------------------------------------------------------
const canGoToStep2 = computed(() => selectedCustomer.value != null && selectedPet.value != null)
const canGoToStep3 = computed(() => true)
const canSubmit = computed(
  () => selectedServiceIds.value.length > 0 && selectedEmployeeId.value != null && selectedSlot.value != null,
)

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

    router.push(`/app/citas/${appointment.id}`)
  } catch {
    errorMessage.value =
      'No se pudo agendar la cita. Puede que el horario ya no esté disponible — revisa e intenta de nuevo.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-container class="py-6" style="max-width: 640px">
    <h1 class="text-h5 mb-2">Nueva cita</h1>

    <!-- Sucursal DE LA CITA (UAT: antes no se podía elegir, se usaba
         siempre la de la agenda sin decirlo). Con una sola sucursal no
         hay nada que elegir — mismo criterio que el resto de los
         selectores de sucursal de la app. -->
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

    <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mb-4">
      {{ errorMessage }}
    </v-alert>

    <!-- Paso 1: cliente y mascota -->
    <v-card v-if="step === 1" class="pa-4 mb-4">
      <h2 class="text-subtitle-1 mb-2">1. Cliente y mascota</h2>

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

      <v-card-actions>
        <v-spacer />
        <v-btn color="primary" :disabled="!canGoToStep2" @click="step = 2">Siguiente</v-btn>
      </v-card-actions>
    </v-card>

    <!-- Paso 2: tipo -->
    <v-card v-if="step === 2" class="pa-4 mb-4">
      <h2 class="text-subtitle-1 mb-2">2. Tipo de cita</h2>
      <v-btn-toggle v-model="kind" mandatory color="primary">
        <v-btn value="grooming">Estética</v-btn>
        <v-btn value="veterinary">Veterinaria</v-btn>
      </v-btn-toggle>

      <v-card-actions>
        <v-btn variant="text" @click="step = 1">Atrás</v-btn>
        <v-spacer />
        <v-btn
          color="primary"
          :disabled="!canGoToStep3"
          @click=";(step = 3), loadServices()"
        >
          Siguiente
        </v-btn>
      </v-card-actions>
    </v-card>

    <!-- Paso 3: servicios -->
    <v-card v-if="step === 3" class="pa-4 mb-4">
      <h2 class="text-subtitle-1 mb-2">3. Servicios</h2>
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

      <v-card-actions>
        <v-btn variant="text" @click="step = 2">Atrás</v-btn>
        <v-spacer />
        <v-btn color="primary" :disabled="selectedServiceIds.length === 0" @click="step = 4">
          Siguiente
        </v-btn>
      </v-card-actions>
    </v-card>

    <!-- Paso 4: empleado y horario -->
    <v-card v-if="step === 4" class="pa-4 mb-4">
      <h2 class="text-subtitle-1 mb-2">4. Empleado y horario</h2>

      <!-- Solo empleados que pueden ATENDER este tipo de cita
           (employeesForKind: su rol, u owner) — el backend igual lo
           revalida (create_appointment()), esto solo evita ofrecer una
           opción que se va a rechazar. -->
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
      <v-text-field v-model="selectedDate" type="date" label="Fecha" density="compact" variant="outlined" />

      <v-progress-circular v-if="loadingSlots" indeterminate color="primary" />
      <TimeSlotPicker v-else v-model="selectedSlot" :slots="availableSlots" />

      <v-card-actions>
        <v-btn variant="text" @click="step = 3">Atrás</v-btn>
        <v-spacer />
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
  </v-container>
</template>
