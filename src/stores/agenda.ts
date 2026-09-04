// Estado de la agenda: qué día y qué sucursal se están viendo, las citas
// de ese día, y un filtro opcional por empleado. Separado de
// useSessionStore a propósito: la sucursal de la AGENDA puede ser
// distinta de la sucursal "activa" de la sesión — CLAUDE.md §8.3 pone
// el ejemplo de un dueño en CDMX revisando la agenda de la sucursal de
// Tijuana sin cambiar su sesión completa a ese negocio/sucursal.
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { format } from 'date-fns'

import * as appointmentsService from '@/services/appointments'
import type { AppointmentWithNames } from '@/services/appointments'
import { toBranchTime } from '@/lib/datetime'
import { useSessionStore } from './session'

export const useAgendaStore = defineStore('agenda', () => {
  const activeDate = ref<string | null>(null) // 'YYYY-MM-DD'
  const activeBranchId = ref<string | null>(null)
  const appointments = ref<AppointmentWithNames[]>([])
  const employeeFilter = ref<string | null>(null)
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const errorMessage = ref<string | null>(null)

  const filteredAppointments = computed(() =>
    employeeFilter.value
      ? appointments.value.filter((a) => a.employee_user_id === employeeFilter.value)
      : appointments.value,
  )

  function activeBranchTimezone(): string | null {
    const session = useSessionStore()
    return session.activeBranches.find((b) => b.id === activeBranchId.value)?.timezone ?? null
  }

  async function load(): Promise<void> {
    const session = useSessionStore()
    const timezone = activeBranchTimezone()
    if (!session.activeTenantId || !activeBranchId.value || !activeDate.value || !timezone) return

    status.value = 'loading'
    errorMessage.value = null
    try {
      appointments.value = await appointmentsService.listByDay(
        session.activeTenantId,
        activeBranchId.value,
        activeDate.value,
        timezone,
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
   * lib/datetime.ts). Se llama una vez al entrar a AgendaPage.
   */
  function initFromSession(): void {
    const session = useSessionStore()
    if (!session.activeBranchId) return
    activeBranchId.value = session.activeBranchId
    const timezone = activeBranchTimezone()
    activeDate.value = format(toBranchTime(new Date(), timezone ?? 'UTC'), 'yyyy-MM-dd')
    load()
  }

  function setDate(dateStr: string): void {
    activeDate.value = dateStr
    load()
  }

  function setBranch(branchId: string): void {
    activeBranchId.value = branchId
    // Cambiar de sucursal invalida el filtro de empleado — el empleado
    // elegido probablemente ni siquiera trabaja en la sucursal nueva.
    employeeFilter.value = null
    load()
  }

  function setEmployeeFilter(employeeId: string | null): void {
    employeeFilter.value = employeeId
  }

  return {
    activeDate,
    activeBranchId,
    appointments,
    employeeFilter,
    filteredAppointments,
    status,
    errorMessage,
    initFromSession,
    setDate,
    setBranch,
    setEmployeeFilter,
    load,
  }
})
