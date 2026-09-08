<script setup lang="ts">
// Agenda del día por empleado, con navegación de fechas (tarea 3.17).
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { format } from 'date-fns'

import { formatTime } from '@/lib/datetime'
import { isFrontDesk } from '@/lib/roles'
import { listBranchEmployees } from '@/services/memberships'
import type { EmployeeSummary } from '@/services/memberships'
import { listUpcomingVaccines } from '@/services/records'
import type { UpcomingVaccine } from '@/services/records'
import type { Appointment } from '@/services/appointments'
import { useAgendaStore } from '@/stores/agenda'
import { useSessionStore } from '@/stores/session'
import NewAppointmentDialog from '@/components/NewAppointmentDialog.vue'

const session = useSessionStore()
const agenda = useAgendaStore()
const router = useRouter()

const employees = ref<EmployeeSummary[]>([])
// Vacunas por reforzar, del negocio COMPLETO — no llevan sucursal (una
// vacunación no tiene branch_id, CLAUDE.md §6.4), así que esta lista es
// independiente de qué sucursal esté viendo la agenda ahora mismo.
const upcomingVaccines = ref<UpcomingVaccine[]>([])

const vaccineStatusLabels: Record<UpcomingVaccine['status'], string> = {
  due_soon: 'Por vencer',
  overdue: 'Vencida',
}
const vaccineStatusColors: Record<UpcomingVaccine['status'], string> = {
  due_soon: 'warning',
  overdue: 'error',
}

const branchTimezone = computed(
  () => session.activeBranches.find((b) => b.id === agenda.activeBranchId)?.timezone ?? 'UTC',
)

const statusLabels: Record<string, string> = {
  scheduled: 'Agendada',
  in_progress: 'En curso',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show: 'No se presentó',
}
const kindLabels: Record<string, string> = { grooming: 'Estética', veterinary: 'Veterinaria' }

function employeeName(userId: string): string {
  return employees.value.find((e) => e.userId === userId)?.fullName ?? '(empleado)'
}

async function loadEmployees(): Promise<void> {
  if (!session.activeTenantId || !agenda.activeBranchId) return
  employees.value = await listBranchEmployees(session.activeTenantId, agenda.activeBranchId)
}

watch(() => agenda.activeBranchId, loadEmployees)

// Bug reportado en el UAT: cambiar de sucursal en el selector de la
// barra superior (AppLayout.vue, que solo toca useSessionStore) no movía
// nada aquí — la agenda tiene su PROPIA sucursal activa a propósito
// (stores/agenda.ts: un dueño puede "asomarse" a otra sucursal sin
// cambiar su sesión completa), pero eso significa que nada la mantenía
// sincronizada con la de arriba tampoco. Este watcher hace que, si la
// sucursal de la SESIÓN cambia mientras la agenda está abierta, la
// agenda la siga — sin quitarle al selector propio de esta página la
// posibilidad de ver otra sucursal sin tocar la sesión.
watch(
  () => session.activeBranchId,
  (branchId) => {
    if (branchId && branchId !== agenda.activeBranchId) agenda.setBranch(branchId)
  },
)

async function loadUpcomingVaccines(): Promise<void> {
  if (!session.activeTenantId) return
  const today = format(new Date(), 'yyyy-MM-dd')
  upcomingVaccines.value = await listUpcomingVaccines(session.activeTenantId, today)
}

onMounted(() => {
  agenda.initFromSession()
  loadEmployees()
  loadUpcomingVaccines()
})

function goToday(): void {
  if (!agenda.activeBranchId) return
  agenda.setDate(format(new Date(), 'yyyy-MM-dd'))
}

function shiftDay(deltaDays: number): void {
  if (!agenda.activeDate) return
  const [year, month, day] = agenda.activeDate.split('-').map(Number)
  const next = new Date(year, month - 1, day + deltaDays)
  agenda.setDate(format(next, 'yyyy-MM-dd'))
}

function handleDateInput(value: unknown): void {
  if (typeof value === 'string' && value) agenda.setDate(value)
}

function handleBranchChange(branchId: unknown): void {
  if (typeof branchId === 'string') agenda.setBranch(branchId)
}

function handleEmployeeFilterChange(userId: unknown): void {
  agenda.setEmployeeFilter(typeof userId === 'string' ? userId : null)
}

const showNewAppointmentDialog = ref(false)

function goToNewAppointment(): void {
  showNewAppointmentDialog.value = true
}

function handleAppointmentCreated(appointment: Appointment): void {
  router.push(`/app/citas/${appointment.id}`)
}

function goToDetail(appointmentId: string): void {
  router.push(`/app/citas/${appointmentId}`)
}
</script>

<template>
  <v-container class="py-6">
    <div class="d-flex align-center flex-wrap ga-2 mb-4">
      <h1 class="text-h5 mr-4">Agenda</h1>

      <v-btn icon="mdi-chevron-left" variant="text" size="small" @click="shiftDay(-1)" />
      <v-text-field
        :model-value="agenda.activeDate"
        type="date"
        density="compact"
        variant="outlined"
        hide-details
        style="max-width: 170px"
        @update:model-value="handleDateInput"
      />
      <v-btn icon="mdi-chevron-right" variant="text" size="small" @click="shiftDay(1)" />
      <v-btn variant="text" size="small" @click="goToday">Hoy</v-btn>

      <v-select
        v-if="session.activeBranches.length > 1"
        :model-value="agenda.activeBranchId"
        :items="session.activeBranches"
        item-title="name"
        item-value="id"
        label="Sucursal"
        density="compact"
        variant="outlined"
        hide-details
        style="max-width: 200px"
        @update:model-value="handleBranchChange"
      />

      <!-- groomer/vet: su agenda ya son solo SUS citas (RLS,
           role_permission_hardening.sql) — no tiene caso ofrecerles un
           filtro para ver las de otros empleados, que de todos modos el
           backend no les va a devolver. -->
      <v-select
        v-if="isFrontDesk(session.role)"
        :model-value="agenda.employeeFilter"
        :items="[{ userId: null, fullName: 'Todos los empleados' }, ...employees]"
        item-title="fullName"
        item-value="userId"
        label="Empleado"
        density="compact"
        variant="outlined"
        hide-details
        style="max-width: 220px"
        @update:model-value="handleEmployeeFilterChange"
      />

      <v-spacer />
      <!-- Agendar es tarea de recepción (CLAUDE.md §6.1); el backend ya
           lo rechaza para groomer/vet (create_appointment()), esto solo
           evita mostrar un botón que termina en un error. -->
      <v-btn
        v-if="isFrontDesk(session.role)"
        color="primary"
        prepend-icon="mdi-plus"
        @click="goToNewAppointment"
      >
        Nueva cita
      </v-btn>
    </div>

    <v-alert v-if="agenda.errorMessage" type="error" density="compact" variant="tonal" class="mb-4">
      {{ agenda.errorMessage }}
    </v-alert>

    <v-progress-circular v-if="agenda.status === 'loading'" indeterminate color="primary" />

    <v-list v-else lines="two">
      <v-list-item
        v-for="appointment in agenda.filteredAppointments"
        :key="appointment.id"
        link
        @click="goToDetail(appointment.id)"
      >
        <template #title>
          {{ formatTime(appointment.starts_at, branchTimezone) }}–{{
            formatTime(appointment.ends_at, branchTimezone)
          }}
          — {{ appointment.customerName }} · {{ appointment.petName }}
        </template>
        <template #subtitle>
          {{ kindLabels[appointment.kind] }} · {{ employeeName(appointment.employee_user_id) }}
        </template>
        <template #append>
          <v-chip size="small" variant="tonal">{{ statusLabels[appointment.status] }}</v-chip>
        </template>
      </v-list-item>

      <v-list-item v-if="agenda.filteredAppointments.length === 0">
        <template #title>No hay citas agendadas para este día.</template>
      </v-list-item>
    </v-list>

    <v-card v-if="upcomingVaccines.length > 0" class="pa-4 mt-6">
      <p class="text-subtitle-1 mb-2">Próximas vacunas</p>
      <v-list density="compact">
        <v-list-item
          v-for="vaccine in upcomingVaccines"
          :key="vaccine.vaccinationId"
          :to="`/app/mascotas/${vaccine.petId}`"
        >
          <template #title>{{ vaccine.petName }} · {{ vaccine.vaccineName }}</template>
          <template #subtitle>Próxima dosis: {{ vaccine.nextDueDate }}</template>
          <template #append>
            <v-chip size="small" :color="vaccineStatusColors[vaccine.status]" variant="tonal">
              {{ vaccineStatusLabels[vaccine.status] }}
            </v-chip>
          </template>
        </v-list-item>
      </v-list>
    </v-card>

    <NewAppointmentDialog v-model="showNewAppointmentDialog" @created="handleAppointmentCreated" />
  </v-container>
</template>
