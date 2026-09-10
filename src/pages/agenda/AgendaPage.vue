<script setup lang="ts">
// Agenda (rediseño 2026-09-08, pedido explícito tras rechazar la
// versión anterior hecha a mano): dos vistas distintas según el rol,
// ambas con @daypilot/daypilot-lite-vue (CLAUDE.md §3).
//
// - Dueño/recepción: EmployeeDayScheduler.vue (DayPilotScheduler) — un
//   solo día navegable, filas = empleados, columnas = horas de ese día.
// - Groomer/vet: EmployeeWeekCalendar.vue (DayPilotCalendar) — sin
//   navegación, siempre "hoy + 6 días", columnas = días, filas = horas.
//
// stores/agenda.ts decide QUÉ rango de fechas corresponde según el rol
// (visibleDates) — esta página solo arma los bloques a pintar y elige
// qué componente mostrar.
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

import { toNaiveLocalIso } from '@/lib/datetime'
import { isFrontDesk } from '@/lib/roles'
import { listBranchEmployees } from '@/services/memberships'
import type { EmployeeSummary } from '@/services/memberships'
import { listUpcomingVaccines } from '@/services/records'
import type { UpcomingVaccine } from '@/services/records'
import type { Appointment, AppointmentStatus } from '@/services/appointments'
import type { CalendarBlock } from '@/lib/calendarGrid'
import { useAgendaStore } from '@/stores/agenda'
import { useSessionStore } from '@/stores/session'
import NewAppointmentDialog from '@/components/NewAppointmentDialog.vue'
import EmployeeDayScheduler, { type SchedulerRow } from '@/components/EmployeeDayScheduler.vue'
import EmployeeWeekCalendar from '@/components/EmployeeWeekCalendar.vue'

const session = useSessionStore()
const agenda = useAgendaStore()
const router = useRouter()

const isFrontDeskView = computed(() => isFrontDesk(session.role))

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

const statusLabels: Record<AppointmentStatus, string> = {
  scheduled: 'Agendada',
  in_progress: 'En curso',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show: 'No se presentó',
}
// Color por estado, no por tipo de cita — en el calendario lo que más
// importa distinguir de un vistazo es "¿ya se cobró/canceló esto?", no
// si es estética o veterinaria (eso ya va en el texto del bloque).
// rgb(var(--v-theme-xxx)) reutiliza la paleta de plugins/vuetify.ts en
// vez de repetir colores a mano.
const statusColors: Record<AppointmentStatus, string> = {
  scheduled: 'rgb(var(--v-theme-info))',
  in_progress: 'rgb(var(--v-theme-warning))',
  completed: 'rgb(var(--v-theme-success))',
  cancelled: 'rgb(var(--v-theme-error))',
  no_show: 'rgb(var(--v-theme-error))',
}
const kindLabels: Record<string, string> = { grooming: 'Estética', veterinary: 'Veterinaria' }

// Para la leyenda de colores del template.
const statusLegend = computed(() =>
  (Object.keys(statusLabels) as AppointmentStatus[]).map((key) => ({
    key,
    label: statusLabels[key],
    color: statusColors[key],
  })),
)

function employeeName(userId: string): string {
  return employees.value.find((e) => e.userId === userId)?.fullName ?? '(empleado)'
}

// Filas del Scheduler (solo dueño/recepción — groomer/vet no ven esta
// dimensión, su calendario ya son solo SUS citas).
const schedulerRows = computed<SchedulerRow[]>(() =>
  employees.value.map((e) => ({ id: e.userId, name: e.fullName })),
)

// Los bloques que pintan EmployeeDayScheduler.vue / EmployeeWeekCalendar.vue
// — ninguno de los dos sabe nada de citas ni de zonas horarias.
// toNaiveLocalIso (lib/datetime.ts) resuelve la hora de LA SUCURSAL antes
// de dársela a DayPilot (CLAUDE.md §8.3): DayPilot no tiene ningún
// concepto de timezone, toma el string tal cual como "hora de pared".
const calendarBlocks = computed<CalendarBlock[]>(() =>
  agenda.appointments.map((appointment) => ({
    id: appointment.id,
    start: toNaiveLocalIso(appointment.starts_at, branchTimezone.value),
    end: toNaiveLocalIso(appointment.ends_at, branchTimezone.value),
    text: `${appointment.customerName} · ${appointment.petName} — ${kindLabels[appointment.kind]} · ${employeeName(appointment.employee_user_id)}`,
    color: statusColors[appointment.status],
    resource: appointment.employee_user_id,
  })),
)

async function loadEmployees(): Promise<void> {
  if (!session.activeTenantId || !agenda.activeBranchId) return
  employees.value = await listBranchEmployees(session.activeTenantId, agenda.activeBranchId)
}

watch(() => agenda.activeBranchId, loadEmployees)

// La agenda tiene su PROPIA sucursal activa en stores/agenda.ts, separada
// de la de la sesión (ver el comentario al inicio de ese archivo) — pero
// el único selector de sucursal que existe ahora es el de AppLayout.vue,
// que solo toca useSessionStore. Sin este watcher, cambiar de sucursal
// ahí arriba no movería nada aquí: este efecto hace que la agenda SIGA
// a la sucursal de la sesión en cuanto cambia.
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

// --- Navegación: SOLO para dueño/recepción. Groomer/vet no tienen
// ningún control de fecha — su ventana es fija ("hoy + 6 días",
// stores/agenda.ts#visibleDates), decisión explícita del rediseño.
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

// Etiqueta informativa para groomer/vet ("8 sep – 14 sep 2026") — no hay
// controles para cambiarla, solo para ubicarse.
const visibleRangeLabel = computed(() => {
  const dates = agenda.visibleDates
  if (dates.length === 0) return ''
  const [firstY, firstM, firstD] = dates[0].split('-').map(Number)
  const [lastY, lastM, lastD] = dates[dates.length - 1].split('-').map(Number)
  const first = new Date(firstY, firstM - 1, firstD)
  const last = new Date(lastY, lastM - 1, lastD)
  return `${format(first, 'd MMM', { locale: es })} – ${format(last, 'd MMM yyyy', { locale: es })}`
})

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

      <template v-if="isFrontDeskView">
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
      </template>
      <span v-else class="text-body-2 text-medium-emphasis text-capitalize">
        {{ visibleRangeLabel }}
      </span>

      <v-spacer />
      <!-- Agendar es tarea de recepción (CLAUDE.md §6.1); el backend ya
           lo rechaza para groomer/vet (create_appointment()), esto solo
           evita mostrar un botón que termina en un error. -->
      <v-btn
        v-if="isFrontDeskView"
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

    <!-- 'idle' cuenta como "todavía cargando" aquí: es el instante entre
         el primer render y que onMounted() dispare initFromSession().
         Sin esto, EmployeeDayScheduler/EmployeeWeekCalendar montaban con
         agenda.activeDate todavía en null (fecha vacía), y DayPilot
         tronaba tratando de parsear un string vacío como fecha
         (verificado a mano en el navegador). -->
    <v-progress-circular
      v-if="agenda.status === 'loading' || agenda.status === 'idle'"
      indeterminate
      color="primary"
    />

    <!-- El "&& agenda.visibleDates.length > 0" de aquí abajo es la misma
         protección que agenda.status === 'idle' de arriba, para OTRO
         momento en el que pasa lo mismo: al cerrar sesión (AppLayout.vue
         handleLogout), session.logout() limpia session.role y
         session.activeBranches ANTES de que el router termine de
         desmontar esta página. Con la sesión ya vacía, isFrontDeskView
         cambia y Vue monta EmployeeWeekCalendar en vez de
         EmployeeDayScheduler con agenda.visibleDates ya en [] (depende
         de session.activeBranches, stores/agenda.ts) — start-date llega
         vacío y DayPilot truena igual que antes. agenda.status se queda
         en 'ready' en ese instante (el store de agenda no se resetea al
         cerrar sesión), así que sin este segundo chequeo el de arriba no
         lo detecta. Verificado a mano: sin esto, el logout deja la URL en
         /login pero la pantalla congelada hasta hacer F5. -->
    <template v-else-if="agenda.status === 'ready' && agenda.visibleDates.length > 0">
      <div class="d-flex flex-wrap ga-3 mb-2">
        <span
          v-for="item in statusLegend"
          :key="item.key"
          class="d-flex align-center ga-1 text-caption text-medium-emphasis"
        >
          <span class="status-dot" :style="{ backgroundColor: item.color }" />
          {{ item.label }}
        </span>
      </div>

      <EmployeeDayScheduler
        v-if="isFrontDeskView"
        :date="agenda.activeDate ?? ''"
        :hour-range="agenda.hourRange"
        :rows="schedulerRows"
        :blocks="calendarBlocks"
        @select="goToDetail"
      />
      <EmployeeWeekCalendar
        v-else
        :start-date="agenda.visibleDates[0] ?? ''"
        :days="agenda.visibleDates.length"
        :hour-range="agenda.hourRange"
        :blocks="calendarBlocks"
        @select="goToDetail"
      />
    </template>

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

<style scoped lang="scss">
.status-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
</style>
