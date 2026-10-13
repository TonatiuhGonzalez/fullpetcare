<script setup lang="ts">
// Agenda (rediseño 2026-09-08, pedido explícito tras rechazar la
// versión anterior hecha a mano): dos vistas distintas según el rol,
// ambas con EventCalendar, @event-calendar/core (CLAUDE.md §3).
//
// - Dueño/recepción: EmployeeDayScheduler.vue (resourceTimelineDay) — un
//   solo día navegable, filas = empleados, columnas = horas de ese día.
// - Groomer/vet: EmployeeWeekCalendar.vue (timeGridWeek) — sin
//   navegación, siempre "hoy + 6 días", columnas = días, filas = horas.
//
// stores/agenda.ts decide QUÉ rango de fechas corresponde según el rol
// (visibleDates) — esta página solo arma los bloques a pintar y elige
// qué componente mostrar.
import { computed, onMounted, ref, watch } from 'vue'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

import { useDelayedLoading } from '@/composables/useDelayedLoading'
import { toNaiveLocalIso } from '@/lib/datetime'
import { isFrontDesk } from '@/lib/roles'
import { AGENDA_STATUSES, agendaStatusOf, type AgendaStatus } from '@/lib/agendaStatus'
import { VISIT_KINDS, visitKindInfo } from '@/lib/visitKind'
import { listBranchEmployees } from '@/services/memberships'
import type { EmployeeSummary } from '@/services/memberships'
import { listUpcomingVaccines } from '@/services/records'
import type { UpcomingVaccine } from '@/services/records'
import type { Appointment } from '@/services/appointments'
import type { CalendarBlock } from '@/lib/calendarGrid'
import { useAgendaStore } from '@/stores/agenda'
import { useSessionStore } from '@/stores/session'
import CalendarSkeleton from '@/components/CalendarSkeleton.vue'
import VisitKindChip from '@/components/VisitKindChip.vue'
import NewAppointmentDialog from '@/components/NewAppointmentDialog.vue'
import PageHeader from '@/components/PageHeader.vue'
import WalkInDialog from '@/components/WalkInDialog.vue'
import AppointmentDialog from '@/components/AppointmentDialog.vue'
import PetDetailDialog from '@/components/PetDetailDialog.vue'
import EmployeeDayScheduler, { type SchedulerRow } from '@/components/EmployeeDayScheduler.vue'
import EmployeeWeekCalendar from '@/components/EmployeeWeekCalendar.vue'
import IconButton from '@/components/IconButton.vue'

const session = useSessionStore()
const agenda = useAgendaStore()

const isFrontDeskView = computed(() => isFrontDesk(session.role))
// 'idle' cuenta como cargando (ver el comentario sobre el calendario en el template).
const isAgendaLoading = computed(
  () => agenda.status === 'loading' || agenda.status === 'idle',
)
const showCalendarSkeleton = useDelayedLoading(isAgendaLoading)

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

// El estado que se muestra de una cita (lib/agendaStatus.ts): su estado real, salvo que ya
// se cobró ('paid' no es un valor de appointments.status, CLAUDE.md §6.3/§8.5; viene de
// stores/agenda.ts#paidAppointmentIds, calculado aparte con services/checkout.ts).
function displayStatus(appointment: Appointment): AgendaStatus {
  return agendaStatusOf(appointment.status, agenda.paidAppointmentIds.has(appointment.id))
}

// Para la leyenda: los estados y, aparte, los tipos de visita.
const statusLegend = Object.values(AGENDA_STATUSES)
const kindLegend = Object.values(VISIT_KINDS)

function employeeName(userId: string): string {
  return employees.value.find((e) => e.userId === userId)?.fullName ?? '(empleado)'
}

// Filas del Scheduler (solo dueño/recepción — groomer/vet no ven esta
// dimensión, su calendario ya son solo SUS citas).
const schedulerRows = computed<SchedulerRow[]>(() =>
  employees.value.map((e) => ({ id: e.userId, name: e.fullName })),
)

// Origen de la cita (tarea #1969): el bloque lo pinta como ícono; en el tooltip va su texto.
function appointmentOrigin(appointment: Appointment): CalendarBlock['origin'] {
  if (appointment.is_urgent) return 'urgent'
  if (appointment.is_walk_in) return 'walk_in'
  return null
}

const ORIGIN_LABELS = { urgent: 'Urgente', walk_in: 'Sin cita' } as const

// Los bloques que pintan EmployeeDayScheduler.vue / EmployeeWeekCalendar.vue
// — ninguno de los dos sabe nada de citas ni de zonas horarias.
// toNaiveLocalIso (lib/datetime.ts) resuelve la hora de LA SUCURSAL antes
// de dársela al calendario (CLAUDE.md §8.3): EventCalendar lee el string
// sin zona como "hora de pared" del navegador y lo pinta igual.
const calendarBlocks = computed<CalendarBlock[]>(() =>
  agenda.appointments.map((appointment) => {
    const status = displayStatus(appointment)
    const origin = appointmentOrigin(appointment)
    const details = [
      origin ? ORIGIN_LABELS[origin] : null,
      visitKindInfo(appointment.kind).label,
      employeeName(appointment.employee_user_id),
      AGENDA_STATUSES[status].label,
    ].filter(Boolean)
    return {
      id: appointment.id,
      start: toNaiveLocalIso(appointment.starts_at, branchTimezone.value),
      end: toNaiveLocalIso(appointment.ends_at, branchTimezone.value),
      text: `${appointment.customerName} · ${appointment.petName} — ${details.join(' · ')}`,
      customer: appointment.customerName,
      pet: appointment.petName,
      status,
      kind: appointment.kind,
      origin,
      resource: appointment.employee_user_id,
    }
  }),
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

// El selector de fecha (v-date-picker) trabaja con Date; la agenda guarda 'YYYY-MM-DD'.
// Se arma con año, mes y día para que el navegador no la mueva de día por la zona.
function parseDay(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

const showDateMenu = ref(false)
const pickedDate = computed<Date | null>({
  get: () => (agenda.activeDate ? parseDay(agenda.activeDate) : null),
  set: (value) => {
    if (!value) return
    agenda.setDate(format(value, 'yyyy-MM-dd'))
    showDateMenu.value = false
  },
})

// "lunes 12 de octubre" (con año si no es el actual).
const activeDateLabel = computed(() => {
  if (!agenda.activeDate) return ''
  const date = parseDay(agenda.activeDate)
  const pattern =
    date.getFullYear() === new Date().getFullYear()
      ? "EEEE d 'de' MMMM"
      : "EEEE d 'de' MMMM 'de' yyyy"
  const text = format(date, pattern, { locale: es })
  return text.charAt(0).toUpperCase() + text.slice(1)
})

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
const showWalkInDialog = ref(false)

function goToNewAppointment(): void {
  showNewAppointmentDialog.value = true
}

// AppointmentDialog.vue reemplaza la navegación a /app/citas/:id al hacer
// clic en un bloque de la agenda (pedido explícito del usuario,
// 2026-09-10): antes esto navegaba a AppointmentDetailPage.vue, una
// página aparte. Se reutiliza también justo después de agendar una cita
// nueva, para no mezclar "crear" (diálogo) con "ver detalle" (antes
// página, ahora también diálogo).
const showPetDialog = ref(false)
const selectedPetId = ref<string | null>(null)

function openPetDialog(petId: string): void {
  selectedPetId.value = petId
  showPetDialog.value = true
}

const showAppointmentDialog = ref(false)
const selectedAppointmentId = ref<string | null>(null)

function openAppointmentDialog(appointmentId: string): void {
  selectedAppointmentId.value = appointmentId
  showAppointmentDialog.value = true
}

function handleAppointmentCreated(appointment: Appointment): void {
  // NewAppointmentDialog emite la cita "cruda" (Appointment), sin
  // customerName/petName — calendarBlocks necesita un AppointmentWithNames
  // (services/appointments.ts). Recargar el rango es el mismo patrón que ya
  // usa AppointmentDialog (@changed="agenda.load()" más abajo): vuelve a
  // pedir el rango completo al servidor en vez de armar el bloque a mano
  // aquí, así el nombre del cliente/mascota y el "Cobrada" del bloque nuevo
  // salen siempre correctos. No se espera a que termine (no es un await):
  // la cita recién creada se ve en cuanto agenda.load() resuelve, mientras
  // tanto ya se abrió su detalle.
  agenda.load()
  openAppointmentDialog(appointment.id)
}
</script>

<template>
  <!-- null (no undefined) para ignorar el ancho global de VContainer: el calendario usa todo el ancho. El cast es solo para vue-tsc. -->
  <v-container class="py-6" :max-width="null as unknown as undefined">
    <PageHeader title="Agenda">
      <template #actions>
        <!-- Agendar es tarea de recepción (CLAUDE.md §6.1); el backend ya
           lo rechaza para groomer/vet (create_appointment()), esto solo
           evita mostrar un botón que termina en un error. -->
        <v-btn
          v-if="isFrontDeskView"
          variant="outlined"
          color="primary"
          prepend-icon="mdi-walk"
          @click="showWalkInDialog = true"
        >
          Llegada sin cita
        </v-btn>
        <v-btn
          v-if="isFrontDeskView"
          color="primary"
          prepend-icon="mdi-plus"
          @click="goToNewAppointment"
        >
          Nueva cita
        </v-btn>
      </template>
    </PageHeader>

    <v-alert v-if="agenda.errorMessage" type="error" density="compact" variant="tonal" class="mb-4">
      {{ agenda.errorMessage }}
    </v-alert>

    <!-- Marco del calendario (PLAN.md D28): barra, leyenda y cuadrícula en una sola tarjeta. -->
    <v-card class="agenda-card">
      <!-- Navegación por día (recepción y dueño) o el rango visible (groomer/vet). -->
      <div class="agenda-toolbar">
        <template v-if="isFrontDeskView">
          <div class="d-flex align-center ga-1">
            <IconButton icon="mdi-chevron-left" aria-label="Día anterior" variant="text" size="small" @click="shiftDay(-1)" />
            <v-btn variant="tonal" size="small" @click="goToday">Hoy</v-btn>
            <IconButton icon="mdi-chevron-right" aria-label="Día siguiente" variant="text" size="small" @click="shiftDay(1)" />
          </div>
          <v-menu v-model="showDateMenu" :close-on-content-click="false" location="bottom start">
            <template #activator="{ props: menuProps }">
              <v-btn
                v-bind="menuProps"
                variant="text"
                append-icon="mdi-calendar-month-outline"
                class="agenda-date-button"
                aria-label="Elegir fecha"
              >
                {{ activeDateLabel }}
              </v-btn>
            </template>
            <v-date-picker v-model="pickedDate" color="primary" hide-header show-adjacent-months />
          </v-menu>
        </template>
        <span v-else class="text-subtitle-1 font-weight-medium text-capitalize">
          {{ visibleRangeLabel }}
        </span>
      </div>

      <!-- 'idle' cuenta como "todavía cargando" aquí: es el instante entre
           el primer render y que onMounted() dispare initFromSession().
           Sin esto, EmployeeDayScheduler/EmployeeWeekCalendar montaban con
           agenda.activeDate todavía en null (fecha vacía), y el calendario
           tronaba tratando de parsear un string vacío como fecha
           (verificado a mano en el navegador). -->
      <CalendarSkeleton
        v-if="isAgendaLoading && showCalendarSkeleton"
        :variant="isFrontDeskView ? 'timeline' : 'week'"
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
           vacío y el calendario truena igual que antes. agenda.status se queda
           en 'ready' en ese instante (el store de agenda no se resetea al
           cerrar sesión), así que sin este segundo chequeo el de arriba no
           lo detecta. Verificado a mano: sin esto, el logout deja la URL en
           /login pero la pantalla congelada hasta hacer F5. -->
      <template v-else-if="agenda.status === 'ready' && agenda.visibleDates.length > 0">
        <!-- Leyenda en una sola fila: estados (ícono + texto) y tipos de visita. -->
        <div class="agenda-legend" aria-label="Significado de colores e íconos">
          <v-chip
            v-for="item in statusLegend"
            :key="item.status"
            size="x-small"
            variant="tonal"
            :color="item.color"
            :prepend-icon="item.icon"
          >
            {{ item.label }}
          </v-chip>
          <span class="agenda-legend__divider" aria-hidden="true" />
          <VisitKindChip v-for="info in kindLegend" :key="info.kind" :kind="info.kind" size="x-small" />
        </div>

        <EmployeeDayScheduler
          v-if="isFrontDeskView"
          :date="agenda.activeDate ?? ''"
          :hour-range="agenda.hourRange"
          :rows="schedulerRows"
          :blocks="calendarBlocks"
          @select="openAppointmentDialog"
        />
        <EmployeeWeekCalendar
          v-else
          :start-date="agenda.visibleDates[0] ?? ''"
          :days="agenda.visibleDates.length"
          :hour-range="agenda.hourRange"
          :blocks="calendarBlocks"
          @select="openAppointmentDialog"
        />
      </template>
    </v-card>

    <v-card v-if="upcomingVaccines.length > 0" class="pa-4 mt-6">
      <p class="text-subtitle-1 mb-2">Próximas vacunas</p>
      <v-list density="compact">
        <v-list-item
          v-for="vaccine in upcomingVaccines"
          :key="vaccine.vaccinationId"
          link
          @click="openPetDialog(vaccine.petId)"
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
    <!-- Mismo manejador: recargar el rango y abrir el detalle de la cita
         recién creada (para una visita en curso, ahí mismo se pasa a atender). -->
    <WalkInDialog v-model="showWalkInDialog" @created="handleAppointmentCreated" />
    <PetDetailDialog v-model="showPetDialog" :pet-id="selectedPetId" />
    <AppointmentDialog
      v-model="showAppointmentDialog"
      :appointment-id="selectedAppointmentId"
      :is-paid="!!selectedAppointmentId && agenda.paidAppointmentIds.has(selectedAppointmentId)"
      @changed="agenda.load()"
    />
  </v-container>
</template>

<style scoped lang="scss">
// El calendario pinta su propio DOM con esquinas rectas: la tarjeta las recorta.
.agenda-card {
  overflow: hidden;
}

.agenda-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  padding: 8px 12px;
  border-bottom: thin solid rgba(var(--v-border-color), var(--v-border-opacity));
}

// Primera letra en mayúscula ya viene del texto; sin tope de ancho para que no se corte.
.agenda-date-button {
  font-weight: 600;
  letter-spacing: 0;
}

.agenda-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: thin solid rgba(var(--v-border-color), var(--v-border-opacity));

  &__divider {
    width: 1px;
    height: 16px;
    margin-inline: 4px;
    background: rgba(var(--v-border-color), var(--v-border-opacity));
  }
}
</style>
