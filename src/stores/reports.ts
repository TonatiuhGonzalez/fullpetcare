// Estado de la pantalla de Reportes (fase 12, tarea 12.12 / HMH Four #2078): el
// periodo y la sucursal elegidos, y los tres reportes del periodo. El cálculo vive
// en la base; las fechas y la escala, en lib/reports.ts. Este store solo coordina.
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { branchToday } from '@/lib/datetime'
import {
  periodRange,
  rangeProblem,
  type DateRange,
  type PeriodPreset,
} from '@/lib/reports'
import * as reportsService from '@/services/reports'
import type { SalesSummary, StaffRow, TopItems } from '@/services/reports'
import { useSessionStore } from './session'

export const useReportsStore = defineStore('reports', () => {
  const preset = ref<PeriodPreset>('month')
  const customRange = ref<DateRange>({ from: '', to: '' })
  /** null = todas las sucursales a las que se tiene acceso. */
  const branchId = ref<string | null>(null)

  const summary = ref<SalesSummary | null>(null)
  const topItems = ref<TopItems | null>(null)
  const staff = ref<StaffRow[]>([])
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const errorMessage = ref<string | null>(null)

  /** El rango efectivo: el del preajuste (con el "hoy" de la sucursal) o el escrito a mano. */
  const range = computed<DateRange>(() => {
    if (preset.value === 'range') return customRange.value
    const session = useSessionStore()
    const timezone =
      session.activeBranch?.timezone ??
      session.activeMembership?.tenantTimezone ??
      'America/Mexico_City'
    return periodRange(preset.value, branchToday(timezone))
  })

  const rangeError = computed(() =>
    preset.value === 'range' ? rangeProblem(customRange.value) : null,
  )

  async function load(): Promise<void> {
    const session = useSessionStore()
    if (!session.activeTenantId) return
    if (rangeError.value) {
      status.value = 'error'
      errorMessage.value = rangeError.value
      return
    }

    status.value = 'loading'
    errorMessage.value = null
    const { from, to } = range.value
    try {
      // Las tres consultas juntas: la pantalla muestra los tres reportes del mismo periodo.
      const [s, t, st] = await Promise.all([
        reportsService.getSalesSummary(session.activeTenantId, from, to, branchId.value),
        reportsService.getTopItems(session.activeTenantId, from, to, branchId.value),
        reportsService.getStaffActivity(session.activeTenantId, from, to, branchId.value),
      ])
      summary.value = s
      topItems.value = t
      staff.value = st
      status.value = 'ready'
    } catch (e) {
      status.value = 'error'
      errorMessage.value =
        e instanceof Error ? e.message : 'No se pudieron cargar los reportes.'
    }
  }

  function setPreset(value: PeriodPreset): Promise<void> {
    preset.value = value
    // Un rango escrito a mano se carga cuando la persona pulsa "Aplicar", no al elegir la opción.
    return value === 'range' ? Promise.resolve() : load()
  }

  function setBranch(value: string | null): Promise<void> {
    branchId.value = value
    return load()
  }

  function reset(): void {
    summary.value = null
    topItems.value = null
    staff.value = []
    branchId.value = null
    preset.value = 'month'
    customRange.value = { from: '', to: '' }
    status.value = 'idle'
    errorMessage.value = null
  }

  return {
    preset,
    customRange,
    branchId,
    summary,
    topItems,
    staff,
    status,
    errorMessage,
    range,
    rangeError,
    load,
    setPreset,
    setBranch,
    reset,
  }
})
