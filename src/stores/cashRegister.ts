// Estado de la pantalla de Caja (fase 12, tarea 12.10 / HMH Four #2077): la caja
// abierta de la sucursal activa, lo cobrado en el turno, sus movimientos y el
// historial de cortes. Las reglas de captura viven en lib/cashRegister.ts y el
// cálculo del esperado en la base; este store solo coordina.
//
// Las acciones devuelven el mensaje de error (listo para mostrar, en español) o
// `null` si salió bien, igual que useInventoryStore.
import { ref } from 'vue'
import { defineStore } from 'pinia'

import {
  checkCountedCash,
  checkMovement,
  checkOpeningFloat,
  type CashMovementKind,
} from '@/lib/cashRegister'
import { cashDifference, type CashDifference } from '@/lib/cashCount'
import * as cashService from '@/services/cashRegister'
import type { CashMovement, CashOverview, CashSession } from '@/services/cashRegister'
import { useSessionStore } from './session'

export interface ClosedResult {
  session: CashSession
  difference: CashDifference
}

export const useCashRegisterStore = defineStore('cashRegister', () => {
  const openSession = ref<CashSession | null>(null)
  const overview = ref<CashOverview | null>(null)
  const movements = ref<CashMovement[]>([])
  const history = ref<CashSession[]>([])
  /** id de persona → nombre, para "abrió" / "cerró" / quién hizo cada movimiento. */
  const names = ref<Record<string, string>>({})
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const errorMessage = ref<string | null>(null)

  function reset(): void {
    openSession.value = null
    overview.value = null
    movements.value = []
    history.value = []
    names.value = {}
    status.value = 'idle'
    errorMessage.value = null
  }

  async function load(): Promise<void> {
    const session = useSessionStore()
    if (!session.activeTenantId || !session.activeBranchId) return

    status.value = 'loading'
    errorMessage.value = null
    try {
      const [open, closed] = await Promise.all([
        cashService.getOpenSession(session.activeTenantId, session.activeBranchId),
        cashService.listClosedSessions(session.activeTenantId, session.activeBranchId),
      ])
      openSession.value = open
      history.value = closed

      if (open) {
        ;[overview.value, movements.value] = await Promise.all([
          cashService.getOverview(open.id),
          cashService.listMovements(open.id),
        ])
      } else {
        overview.value = null
        movements.value = []
      }

      const ids = [
        ...closed.flatMap((s) => [s.opened_by, s.closed_by]),
        ...(open ? [open.opened_by] : []),
        ...movements.value.map((m) => m.created_by),
      ].filter((id): id is string => !!id)
      names.value = await cashService.getNames(ids)
      status.value = 'ready'
    } catch {
      status.value = 'error'
      errorMessage.value = 'No se pudo cargar la caja. Revisa tu conexión.'
    }
  }

  /** Abre la caja con el fondo escrito (en pesos). */
  async function open(floatText: string, note: string): Promise<string | null> {
    const session = useSessionStore()
    if (!session.activeBranchId) return 'Elige una sucursal para abrir la caja.'
    const check = checkOpeningFloat(floatText)
    if (check.error || check.cents === null) return check.error

    try {
      await cashService.openSession(
        session.activeBranchId,
        check.cents,
        note.trim() || null,
      )
    } catch (e) {
      return e instanceof Error ? e.message : 'No se pudo abrir la caja.'
    }
    await load()
    return null
  }

  /** Registra un retiro, gasto o ingreso en la caja abierta. */
  async function addMovement(
    type: CashMovementKind,
    amountText: string,
    reason: string,
  ): Promise<string | null> {
    const session = useSessionStore()
    if (
      !openSession.value ||
      !session.activeTenantId ||
      !session.activeBranchId ||
      !session.user
    ) {
      return 'No hay una caja abierta para registrar el movimiento.'
    }
    const check = checkMovement(amountText, reason)
    if (check.error || check.cents === null) return check.error

    try {
      await cashService.addMovement({
        tenantId: session.activeTenantId,
        branchId: session.activeBranchId,
        sessionId: openSession.value.id,
        userId: session.user.id,
        type,
        amountCents: check.cents,
        reason,
      })
    } catch (e) {
      return e instanceof Error ? e.message : 'No se pudo registrar el movimiento.'
    }
    await load()
    return null
  }

  /**
   * Cierra la caja con el efectivo contado. Devuelve el corte ya cerrado con su
   * diferencia (esperado y contado vienen de la base, congelados), o el error.
   */
  async function close(
    countedText: string,
    note: string,
  ): Promise<{ error: string; closed: null } | { error: null; closed: ClosedResult }> {
    if (!openSession.value)
      return { error: 'No hay una caja abierta para cerrar.', closed: null }
    const check = checkCountedCash(countedText)
    if (check.error || check.cents === null)
      return { error: check.error ?? 'Revisa el conteo.', closed: null }

    let session: CashSession
    try {
      session = await cashService.closeSession(
        openSession.value.id,
        check.cents,
        note.trim() || null,
      )
    } catch (e) {
      return {
        error: e instanceof Error ? e.message : 'No se pudo cerrar la caja.',
        closed: null,
      }
    }
    await load()
    return {
      error: null,
      closed: {
        session,
        // La diferencia se vuelve a calcular con lib/cashCount.ts a partir de lo
        // congelado en la base: si no coincidiera con `difference_cents`, algo está mal.
        difference: cashDifference(
          session.counted_cents ?? 0,
          session.expected_cents ?? 0,
        ),
      },
    }
  }

  /** Resumen de un turno ya cerrado, para el comprobante. null si no se pudo leer. */
  async function fetchOverview(sessionId: string): Promise<CashOverview | null> {
    try {
      return await cashService.getOverview(sessionId)
    } catch {
      return null
    }
  }

  return {
    fetchOverview,
    openSession,
    overview,
    movements,
    history,
    names,
    status,
    errorMessage,
    reset,
    load,
    open,
    addMovement,
    close,
  }
})
