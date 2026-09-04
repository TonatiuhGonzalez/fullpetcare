<script setup lang="ts">
// Detalle de una cita: reagendar, cancelar (tarea 3.19).
import { onMounted, ref } from 'vue'

import * as appointmentsService from '@/services/appointments'
import type { Appointment, AppointmentService } from '@/services/appointments'
import * as customersService from '@/services/customers'
import type { Customer } from '@/services/customers'
import * as petsService from '@/services/pets'
import type { Pet } from '@/services/pets'
import * as branchesService from '@/services/branches'
import type { Branch } from '@/services/branches'
import { listBranchEmployees } from '@/services/memberships'
import type { EmployeeSummary } from '@/services/memberships'
import { formatDate, formatTime, fromBranchTime } from '@/lib/datetime'
import { formatMXN } from '@/lib/money'
import { useSessionStore } from '@/stores/session'

const props = defineProps<{ id: string }>()

const session = useSessionStore()

const appointment = ref<Appointment | null>(null)
const branch = ref<Branch | null>(null)
const customer = ref<Customer | null>(null)
const pet = ref<Pet | null>(null)
const lines = ref<AppointmentService[]>([])
const employees = ref<EmployeeSummary[]>([])

const loading = ref(false)
const errorMessage = ref<string | null>(null)

const showReschedule = ref(false)
const rescheduleDate = ref('')
const rescheduleTime = ref('')
const rescheduling = ref(false)

const kindLabels: Record<string, string> = { grooming: 'Estética', veterinary: 'Veterinaria' }
const statusLabels: Record<string, string> = {
  scheduled: 'Agendada',
  in_progress: 'En curso',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show: 'No se presentó',
}

function employeeName(userId: string): string {
  return employees.value.find((e) => e.userId === userId)?.fullName ?? '(empleado)'
}

async function load(): Promise<void> {
  if (!session.activeTenantId) return
  loading.value = true
  errorMessage.value = null
  try {
    const found = await appointmentsService.getById(session.activeTenantId, props.id)
    appointment.value = found
    if (!found) return

    const [foundBranch, foundCustomer, foundPet, foundLines] = await Promise.all([
      branchesService.getById(found.branch_id),
      customersService.getById(session.activeTenantId, found.customer_id),
      petsService.getById(session.activeTenantId, found.pet_id),
      appointmentsService.listServices(found.id),
    ])
    branch.value = foundBranch
    customer.value = foundCustomer
    pet.value = foundPet
    lines.value = foundLines
    if (foundBranch) {
      employees.value = await listBranchEmployees(session.activeTenantId, found.branch_id)
    }
  } catch {
    errorMessage.value = 'No se pudo cargar la cita. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function handleCancel(): Promise<void> {
  if (!appointment.value || !session.activeTenantId) return
  try {
    await appointmentsService.cancel(session.activeTenantId, appointment.value.id)
    await load()
  } catch {
    // Cubre tanto un problema de red como una transición inválida (por
    // ejemplo, cancelar una cita que ya se completó) — lib/appointmentStatus.ts
    // decide qué transiciones existen, changeStatus() la valida antes del
    // UPDATE (tarea 4.8-4.9).
    errorMessage.value = 'No se pudo cancelar la cita.'
  }
}

function openReschedule(): void {
  if (!appointment.value || !branch.value) return
  // Prellena con la fecha/hora actual, en la zona de la sucursal.
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
    await load()
  } catch {
    errorMessage.value =
      'No se pudo reagendar — puede que el empleado ya tenga otra cita en ese horario.'
  } finally {
    rescheduling.value = false
  }
}
</script>

<template>
  <v-container class="py-6" style="max-width: 560px">
    <v-btn variant="text" prepend-icon="mdi-arrow-left" class="mb-2" to="/app/agenda">
      Volver a la agenda
    </v-btn>

    <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mb-4">
      {{ errorMessage }}
    </v-alert>

    <v-progress-circular v-if="loading && !appointment" indeterminate color="primary" />

    <v-card v-else-if="appointment && branch" class="pa-4">
      <div class="d-flex align-center mb-2">
        <h1 class="text-h5">
          {{ formatDate(appointment.starts_at, branch.timezone) }} ·
          {{ formatTime(appointment.starts_at, branch.timezone) }}–{{
            formatTime(appointment.ends_at, branch.timezone)
          }}
        </h1>
        <v-spacer />
        <v-chip size="small" variant="tonal">{{ statusLabels[appointment.status] }}</v-chip>
      </div>

      <p class="mb-1">
        <strong>Cliente:</strong> {{ customer?.first_name }} {{ customer?.last_name }}
      </p>
      <p class="mb-1"><strong>Mascota:</strong> {{ pet?.name }}</p>
      <p class="mb-1"><strong>Tipo:</strong> {{ kindLabels[appointment.kind] }}</p>
      <p class="mb-1"><strong>Empleado:</strong> {{ employeeName(appointment.employee_user_id) }}</p>
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

      <v-card-actions v-if="appointment.status !== 'cancelled'">
        <v-btn variant="text" prepend-icon="mdi-calendar-edit" @click="openReschedule">
          Reagendar
        </v-btn>
        <v-spacer />
        <v-btn variant="text" color="error" prepend-icon="mdi-close" @click="handleCancel">
          Cancelar cita
        </v-btn>
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
  </v-container>
</template>
