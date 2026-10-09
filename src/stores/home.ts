// Estado de la pantalla Inicio (fase 15): el resumen del día de la sucursal activa.
// Reúne citas de hoy, lo por cobrar, la caja y las ventas del día. Las citas son el
// bloque principal; caja y ventas son opcionales (solo con su permiso) y si fallan no
// tumban el resto de la pantalla: cada una guarda su propio error.
//
// Cada bloque se consulta SOLO si la persona puede verlo (rol/permiso), para no pedir
// a la base lo que de todos modos rechazaría. La regla real sigue en la base (RLS y
// validaciones de las funciones); esto solo evita pantallas con errores falsos.
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { branchToday } from '@/lib/datetime'
import {
  awaitingPayment,
  estimatedPendingCents,
  summarizeDay,
  upcomingAppointments,
} from '@/lib/homeSummary'
import { isFrontDesk } from '@/lib/roles'
import * as appointmentsService from '@/services/appointments'
import type { AppointmentWithNames } from '@/services/appointments'
import * as cashService from '@/services/cashRegister'
import * as checkoutService from '@/services/checkout'
import * as reportsService from '@/services/reports'
import { useSessionStore } from './session'

const UPCOMING_LIMIT = 6

export interface HomeCash {
  openedAt: string
  expectedCents: number
}

export interface HomeSales {
  totalCents: number
  salesCount: number
}

export const useHomeStore = defineStore('home', () => {
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const errorMessage = ref<string | null>(null)

  const appointments = ref<AppointmentWithNames[]>([])
  const paidIds = ref<Set<string>>(new Set())
  const pendingCents = ref(0)

  // null = caja cerrada; undefined = no se pidió (sin permiso) o aún no carga.
  const cash = ref<HomeCash | null | undefined>(undefined)
  const sales = ref<HomeSales | undefined>(undefined)
  const cashFailed = ref(false)
  const salesFailed = ref(false)

  const summary = computed(() => summarizeDay(appointments.value, paidIds.value))
  const upcoming = computed(() =>
    upcomingAppointments(appointments.value, UPCOMING_LIMIT),
  )
  const pending = computed(() => awaitingPayment(appointments.value, paidIds.value))

  /** Fecha de hoy en la sucursal activa ('YYYY-MM-DD'), o null si aún no hay sucursal. */
  function today(): string | null {
    const session = useSessionStore()
    const timezone = session.activeBranch?.timezone
    return timezone ? branchToday(timezone) : null
  }

  async function loadCash(tenantId: string, branchId: string): Promise<void> {
    try {
      const open = await cashService.getOpenSession(tenantId, branchId)
      cash.value = open
        ? {
            openedAt: open.opened_at,
            expectedCents: (await cashService.getOverview(open.id)).expectedCents,
          }
        : null
      cashFailed.value = false
    } catch {
      cash.value = undefined
      cashFailed.value = true
    }
  }

  async function loadSales(
    tenantId: string,
    branchId: string,
    date: string,
  ): Promise<void> {
    try {
      const summaryToday = await reportsService.getSalesSummary(
        tenantId,
        date,
        date,
        branchId,
      )
      sales.value = {
        totalCents: summaryToday.totals.totalCents,
        salesCount: summaryToday.totals.salesCount,
      }
      salesFailed.value = false
    } catch {
      sales.value = undefined
      salesFailed.value = true
    }
  }

  async function load(): Promise<void> {
    const session = useSessionStore()
    const date = today()
    const tenantId = session.activeTenantId
    const branchId = session.activeBranchId
    const timezone = session.activeBranch?.timezone
    if (!tenantId || !branchId || !date || !timezone) return

    status.value = 'loading'
    errorMessage.value = null
    try {
      const todays = await appointmentsService.listByDay(
        tenantId,
        branchId,
        date,
        timezone,
      )
      appointments.value = todays
      paidIds.value = await checkoutService.listPaidAppointmentIds(
        todays.map((a) => a.id),
      )

      // Total estimado por cobrar: solo recepción y dueño cobran.
      if (isFrontDesk(session.role)) {
        const ids = pending.value.map((a) => a.id)
        pendingCents.value = estimatedPendingCents(
          ids,
          await appointmentsService.listServicesForAppointments(ids),
        )
      } else {
        pendingCents.value = 0
      }
      status.value = 'ready'
    } catch {
      status.value = 'error'
      errorMessage.value = 'No se pudo cargar el resumen del día. Revisa tu conexión.'
      return
    }

    // Bloques opcionales, en paralelo y sin que uno tumbe al otro.
    const optional: Promise<void>[] = []
    if (session.canView('cash_register')) optional.push(loadCash(tenantId, branchId))
    else cash.value = undefined
    if (session.canView('reports')) optional.push(loadSales(tenantId, branchId, date))
    else sales.value = undefined
    await Promise.all(optional)
  }

  return {
    status,
    errorMessage,
    appointments,
    summary,
    upcoming,
    pending,
    pendingCents,
    cash,
    sales,
    cashFailed,
    salesFailed,
    load,
  }
})
