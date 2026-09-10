// Estado de la agenda: qué sucursal se está viendo y qué citas hay en el
// rango de fechas visible. Tiene su PROPIO activeBranchId, separado del
// de useSessionStore, aunque hoy (2026-09-10) siempre valen lo mismo: no
// hay ningún control en la UI que los desincronice — AgendaPage.vue solo
// los mantiene alineados con un watcher (ver ese archivo). Se dejan
// separados porque la idea original era dejar a un dueño "asomarse" a la
// agenda de otra sucursal sin cambiar la sucursal de toda su sesión; ese
// selector se quitó de AgendaPage.vue (ahora solo existe el de
// AppLayout.vue, que sí toca la sesión), pero el store no se colapsó en
// uno solo por si esa función vuelve — si termina sin usarse, es candidato
// a simplificarse a futuro.
//
// Rediseño 2026-09-08 (pedido explícito del usuario): el RANGO de fechas
// visible ahora depende del ROL, no solo de un día elegido a mano —
// dueño/recepción navegan un solo día (EmployeeDayScheduler.vue,
// DayPilotScheduler: filas = empleados, columnas = horas de ese día);
// groomer/vet ven siempre una ventana fija de 7 días empezando HOY
// (EmployeeWeekCalendar.vue, DayPilotCalendar: columnas = días, filas =
// horas), sin selector de fecha ni flechas — decisión explícita: su
// agenda ya son solo SUS citas (RLS, role_permission_hardening.sql), no
// tiene caso dejarlos "navegar" a semanas viejas.
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { format } from 'date-fns'

import * as appointmentsService from '@/services/appointments'
import type { AppointmentWithNames } from '@/services/appointments'
import * as checkoutService from '@/services/checkout'
import * as branchesService from '@/services/branches'
import { toBranchTime } from '@/lib/datetime'
import { hoursForDate, type BranchHours } from '@/lib/availability'
import { consecutiveDates, visibleHourRange, type HourRange } from '@/lib/calendarGrid'
import { isFrontDesk } from '@/lib/roles'
import { useSessionStore } from './session'

// "Hoy a 7 días hacia adelante" (tarea del rediseño) = hoy + 6 días más.
const GROOMER_VET_WINDOW_DAYS = 7

export const useAgendaStore = defineStore('agenda', () => {
  // Solo lo usan dueño/recepción (el día que eligieron navegar). Para
  // groomer/vet, visibleDates lo ignora por completo — ver más abajo.
  const activeDate = ref<string | null>(null) // 'YYYY-MM-DD'
  const activeBranchId = ref<string | null>(null)
  // Las citas de TODO el rango visible (visibleDates), no de un solo día
  // — tanto el Scheduler de un día como el Calendar de 7 días las
  // necesitan todas a la vez.
  const appointments = ref<AppointmentWithNames[]>([])
  // IDs de las citas de `appointments` que ya tienen una venta que las
  // cubre — pinta el estado "Cobrada" en AgendaPage.vue. No es parte del
  // estado real de la cita (appointments.status nunca deja 'completed',
  // ver services/checkout.ts#findSaleIdForAppointment), así que se calcula
  // aparte en vez de venir embebido en AppointmentWithNames.
  const paidAppointmentIds = ref<Set<string>>(new Set())
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const errorMessage = ref<string | null>(null)
  // opening_hours (jsonb) de la sucursal activa — hace falta para saber
  // qué rango de horas mostrar como filas/columnas.
  const branchOpeningHours = ref<Record<string, BranchHours | null | undefined>>({})

  function activeBranchTimezone(): string | null {
    const session = useSessionStore()
    return session.activeBranches.find((b) => b.id === activeBranchId.value)?.timezone ?? null
  }

  const visibleDates = computed<string[]>(() => {
    const session = useSessionStore()
    const timezone = activeBranchTimezone()
    if (!timezone) return []

    if (isFrontDesk(session.role)) {
      return activeDate.value ? [activeDate.value] : []
    }

    const today = format(toBranchTime(new Date(), timezone), 'yyyy-MM-dd')
    return consecutiveDates(today, GROOMER_VET_WINDOW_DAYS)
  })

  const hourRange = computed<HourRange>(() =>
    visibleHourRange(
      visibleDates.value.map((dateStr) => hoursForDate(branchOpeningHours.value, dateStr)),
    ),
  )

  async function load(): Promise<void> {
    const session = useSessionStore()
    const timezone = activeBranchTimezone()
    const dates = visibleDates.value
    if (!session.activeTenantId || !activeBranchId.value || dates.length === 0 || !timezone) return

    status.value = 'loading'
    errorMessage.value = null
    try {
      const [branch, rangeAppointments] = await Promise.all([
        branchesService.getById(activeBranchId.value),
        appointmentsService.listByDateRange(
          session.activeTenantId,
          activeBranchId.value,
          dates[0],
          dates[dates.length - 1],
          timezone,
        ),
      ])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opening_hours es un jsonb genérico (Json) en los tipos generados; misma nota que NewAppointmentDialog.vue.
      branchOpeningHours.value = (branch?.opening_hours as any) ?? {}
      appointments.value = rangeAppointments
      paidAppointmentIds.value = await checkoutService.listPaidAppointmentIds(
        rangeAppointments.map((a) => a.id),
      )
      status.value = 'ready'
    } catch {
      status.value = 'error'
      errorMessage.value = 'No se pudo cargar la agenda. Revisa tu conexión.'
    }
  }

  /**
   * Arranca la agenda en la sucursal activa de la sesión y "hoy" en la
   * hora de ESA sucursal (no la del navegador — mismo criterio que todo
   * lib/datetime.ts). Se llama una vez al entrar a AgendaPage. activeDate
   * se fija aunque el rol sea groomer/vet (no lo van a usar, pero no
   * cuesta nada dejarlo consistente).
   */
  function initFromSession(): void {
    const session = useSessionStore()
    if (!session.activeBranchId) return
    activeBranchId.value = session.activeBranchId
    const timezone = activeBranchTimezone()
    activeDate.value = format(toBranchTime(new Date(), timezone ?? 'UTC'), 'yyyy-MM-dd')
    load()
  }

  /** Solo tiene efecto visible para dueño/recepción — ver visibleDates. */
  function setDate(dateStr: string): void {
    activeDate.value = dateStr
    load()
  }

  function setBranch(branchId: string): void {
    activeBranchId.value = branchId
    load()
  }

  return {
    activeDate,
    activeBranchId,
    appointments,
    paidAppointmentIds,
    visibleDates,
    hourRange,
    status,
    errorMessage,
    initFromSession,
    setDate,
    setBranch,
    load,
  }
})
