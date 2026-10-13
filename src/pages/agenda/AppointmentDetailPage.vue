<script setup lang="ts">
// Detalle de una cita: reagendar, cancelar (tarea 3.19).
import { CONTENT_WIDTH } from '@/lib/contentWidth'
import PageSkeleton from '@/components/PageSkeleton.vue'
import { useDelayedLoading } from '@/composables/useDelayedLoading'
import { computed, onMounted, ref, watch } from 'vue'

import * as appointmentsService from '@/services/appointments'
import type { Appointment, AppointmentService } from '@/services/appointments'
import * as customersService from '@/services/customers'
import type { Customer } from '@/services/customers'
import * as petsService from '@/services/pets'
import type { Pet } from '@/services/pets'
import * as branchesService from '@/services/branches'
import type { Branch } from '@/services/branches'
import { findPaidSaleIdByAppointment } from '@/services/invoicing'
import { listBranchEmployees } from '@/services/memberships'
import type { EmployeeSummary } from '@/services/memberships'
import {
  branchToday,
  formatDate,
  formatTime,
  fromBranchTime,
  toNaiveLocalIso,
} from '@/lib/datetime'
import { appointmentRuleMessage, overlapNoticeText } from '@/lib/appointmentErrors'
import { findOverlap, hoursForDate, type BranchHours } from '@/lib/availability'
import { overlapCandidates, rescheduleProblem, type DayAppointment } from '@/lib/rescheduleRules'
import { formatMXN } from '@/lib/money'
import { isFrontDesk } from '@/lib/roles'
import VisitKindChip from '@/components/VisitKindChip.vue'
import { useSessionStore } from '@/stores/session'
import { required } from '@/lib/validation'

const props = defineProps<{ id: string }>()

const session = useSessionStore()

const appointment = ref<Appointment | null>(null)
const branch = ref<Branch | null>(null)
// Horario por día de la semana, aparte de `branch` porque `opening_hours` es un jsonb genérico
// (Json) y leerlo desde `branch.value` hace que TS expanda un tipo recursivo (TS2589).
const branchOpeningHours = ref<Record<string, BranchHours | null>>({})
const customer = ref<Customer | null>(null)
const pet = ref<Pet | null>(null)
const lines = ref<AppointmentService[]>([])
const employees = ref<EmployeeSummary[]>([])

// Venta ya cobrada de esta cita (si la hay): desde ahí se factura (tarea 11.19).
const paidSaleId = ref<string | null>(null)
const loading = ref(false)
const showSkeleton = useDelayedLoading(loading)
const errorMessage = ref<string | null>(null)

const showReschedule = ref(false)
const rescheduleDate = ref('')
const rescheduleTime = ref('')
const rescheduling = ref(false)
// Error del intento de guardar, dentro del propio diálogo de reagendar (el `errorMessage`
// de la pantalla queda detrás de él).
const rescheduleError = ref<string | null>(null)
// Citas del día elegido (de la sucursal), para avisar de un traslape con el mismo empleado.
const rescheduleDayAppointments = ref<DayAppointment[]>([])
// Evita que una respuesta lenta de otro día pise a la del día que ya se eligió.
let rescheduleDayRequest = 0

// "Hoy" y "ahora" son los de la sucursal de la cita, no los del navegador (§8.3).
const rescheduleMinDate = computed(() =>
  branch.value ? branchToday(branch.value.timezone) : '',
)
const appointmentDurationMinutes = computed(() =>
  appointment.value
    ? Math.round(
        (new Date(appointment.value.ends_at).getTime() -
          new Date(appointment.value.starts_at).getTime()) /
          60000,
      )
    : 0,
)

// Mismas reglas que agendar (C1.13), vivas mientras se escribe. La base las repite.
const rescheduleIssue = computed<string | null>(() => {
  if (!branch.value || !showReschedule.value) return null
  const tz = branch.value.timezone
  return rescheduleProblem({
    date: rescheduleDate.value,
    time: rescheduleTime.value,
    durationMinutes: appointmentDurationMinutes.value,
    branchHours: rescheduleDate.value
      ? hoursForDate(
          branchOpeningHours.value,
          rescheduleDate.value,
        )
      : null,
    now: { date: branchToday(tz), time: formatTime(new Date(), tz) },
  })
})

// Traslape con otra cita del mismo empleado: solo informa, no bloquea (D26 punto 1).
const rescheduleOverlapNotice = computed<string | null>(() => {
  if (!branch.value || !appointment.value || rescheduleIssue.value) return null
  const tz = branch.value.timezone
  const startsAt = fromBranchTime(rescheduleDate.value, rescheduleTime.value, tz)
  const endsAt = new Date(startsAt.getTime() + appointmentDurationMinutes.value * 60000)
  const conflict = findOverlap({
    existingAppointments: overlapCandidates(
      rescheduleDayAppointments.value,
      appointment.value.id,
      tz,
    ),
    employeeId: appointment.value.employee_user_id,
    startsAt: rescheduleTime.value,
    endsAt: formatTime(endsAt, tz),
  })
  return conflict ? overlapNoticeText(conflict) : null
})

async function loadRescheduleDay(): Promise<void> {
  const request = ++rescheduleDayRequest
  if (!showReschedule.value || !session.activeTenantId || !branch.value || !appointment.value) {
    return
  }
  if (!rescheduleDate.value) {
    rescheduleDayAppointments.value = []
    return
  }
  try {
    const day = await appointmentsService.listByDay(
      session.activeTenantId,
      appointment.value.branch_id,
      rescheduleDate.value,
      branch.value.timezone,
    )
    if (request === rescheduleDayRequest) rescheduleDayAppointments.value = day
  } catch {
    // El aviso de traslape es informativo: si no se pudo consultar, simplemente no sale.
    // Guardar sigue funcionando y la base valida lo que sí es obligatorio.
    if (request === rescheduleDayRequest) rescheduleDayAppointments.value = []
  }
}

watch([showReschedule, rescheduleDate], loadRescheduleDay)

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opening_hours es un jsonb genérico (Json); misma nota que NewAppointmentDialog.vue.
    branchOpeningHours.value = (foundBranch?.opening_hours as any) ?? {}
    customer.value = foundCustomer
    pet.value = foundPet
    lines.value = foundLines
    if (found.status === 'completed' && session.canView('invoicing')) {
      paidSaleId.value = await findPaidSaleIdByAppointment(found.id)
    }
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
  // El input de fecha pide 'YYYY-MM-DD' en hora de la sucursal (formatDate daba texto en español).
  rescheduleDate.value = toNaiveLocalIso(appointment.value.starts_at, branch.value.timezone).slice(0, 10)
  rescheduleTime.value = formatTime(appointment.value.starts_at, branch.value.timezone)
  rescheduleError.value = null
  showReschedule.value = true
}

async function handleReschedule(): Promise<void> {
  if (!appointment.value || !branch.value) return
  // Mismas reglas que agendar, antes de ir a la base.
  if (rescheduleIssue.value) {
    rescheduleError.value = rescheduleIssue.value
    return
  }
  rescheduling.value = true
  rescheduleError.value = null
  try {
    const durationMs =
      new Date(appointment.value.ends_at).getTime() - new Date(appointment.value.starts_at).getTime()
    const startsAt = fromBranchTime(rescheduleDate.value, rescheduleTime.value, branch.value.timezone)
    const endsAt = new Date(startsAt.getTime() + durationMs)

    await appointmentsService.reschedule(appointment.value.id, startsAt, endsAt)
    showReschedule.value = false
    await load()
  } catch (error) {
    // La base rechaza con un `hint` por causa; si es otra cosa (red, permisos), el genérico.
    rescheduleError.value =
      appointmentRuleMessage(error) ?? 'No se pudo reagendar la cita. Revisa tu conexión.'
  } finally {
    rescheduling.value = false
  }
}
</script>

<template>
  <v-container :max-width="CONTENT_WIDTH.narrow" class="py-6">
    <v-btn variant="text" prepend-icon="mdi-arrow-left" class="mb-2" to="/app/agenda">
      Volver a la agenda
    </v-btn>

    <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mb-4">
      {{ errorMessage }}
    </v-alert>

    <PageSkeleton v-if="showSkeleton && !appointment" />

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
      <p class="mb-1 d-flex align-center ga-2">
        <strong>Tipo:</strong> <VisitKindChip :kind="appointment.kind" />
      </p>
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

      <v-card-actions
        v-if="!['cancelled', 'completed', 'no_show'].includes(appointment.status)"
      >
        <v-btn
          color="primary"
          variant="tonal"
          prepend-icon="mdi-clipboard-text"
          :to="`/app/citas/${appointment.id}/atender`"
        >
          Atender
        </v-btn>
        <!-- Reagendar/cancelar es tarea de recepción (CLAUDE.md §6.1) —
             groomer/vet solo atienden lo que recepción ya agendó (pedido
             explícito del usuario, 2026-09-10). Esta página ya casi no se
             usa desde la agenda (eso ahora abre AppointmentDialog.vue),
             pero sigue siendo el destino real de "Próximas citas" en la
             ficha de una mascota, a la que groomer/vet sí tienen acceso. -->
        <template v-if="isFrontDesk(session.role)">
          <v-btn variant="text" prepend-icon="mdi-calendar-edit" @click="openReschedule">
            Reagendar
          </v-btn>
          <v-spacer />
          <v-btn variant="text" color="error" prepend-icon="mdi-close" @click="handleCancel">
            Cancelar cita
          </v-btn>
        </template>
      </v-card-actions>

      <v-card-actions v-else-if="appointment.status === 'completed'">
        <v-btn
          v-if="paidSaleId"
          color="primary"
          prepend-icon="mdi-file-document-outline"
          :to="`/app/ventas/${paidSaleId}`"
        >
          Ver venta y facturar
        </v-btn>
        <v-btn
          v-else
          color="primary"
          prepend-icon="mdi-cash-register"
          :to="`/app/citas/${appointment.id}/cobrar`"
        >
          Cobrar
        </v-btn>
      </v-card-actions>
    </v-card>

    <v-dialog v-model="showReschedule" max-width="420">
      <v-card>
        <v-card-title>Reagendar cita</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="rescheduleDate"
            type="date"
            label="Fecha*"
            density="compact"
            :min="rescheduleMinDate"
            :rules="[required]"
          />
          <v-text-field
            v-model="rescheduleTime"
            type="time"
            label="Hora*"
            density="compact"
            :rules="[required]"
          />
          <v-alert v-if="rescheduleIssue" type="error" variant="tonal" density="compact" class="mb-2">
            {{ rescheduleIssue }}
          </v-alert>
          <v-alert
            v-else-if="rescheduleOverlapNotice"
            color="overlap"
            variant="flat"
            icon="mdi-alert-outline"
            density="compact"
            class="mb-2"
          >
            {{ rescheduleOverlapNotice }}
          </v-alert>
          <v-alert v-if="rescheduleError" type="error" variant="tonal" density="compact">
            {{ rescheduleError }}
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showReschedule = false">Cancelar</v-btn>
          <v-btn
            color="primary"
            :loading="rescheduling"
            :disabled="!!rescheduleIssue"
            @click="handleReschedule"
            >Guardar</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>
