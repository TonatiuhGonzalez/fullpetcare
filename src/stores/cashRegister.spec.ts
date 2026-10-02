// Tests de useCashRegisterStore. Los services se reemplazan por versiones falsas
// (mismo patrón que inventory.spec.ts): aquí se prueban las transiciones del
// store (abrir, registrar movimiento, cerrar) y que NO se llame al servidor con
// datos que ya se sabe que son inválidos; que la base responda lo cubren los
// tests de supabase/tests/.
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCashRegisterStore } from './cashRegister'
import { useSessionStore } from './session'

// useSessionStore importa estos services y todos terminan en services/supabase.ts,
// que lanza error sin VITE_SUPABASE_URL (en el CI no existe): se mockean igual que
// en inventory.spec.ts.
vi.mock('@/services/auth', () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  getCurrentUser: vi.fn(),
  onSessionLost: vi.fn(),
}))
vi.mock('@/services/profiles', () => ({ getProfile: vi.fn() }))
vi.mock('@/services/memberships', () => ({ listMyMemberships: vi.fn() }))
vi.mock('@/services/tenantAccess', () => ({
  listMyTenantNotices: vi.fn(),
  cancelMyTenant: vi.fn(),
}))
vi.mock('@/services/permissions', () => ({ listForTenant: vi.fn() }))
vi.mock('@/services/platform', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@/services/cashRegister', () => ({
  getOpenSession: vi.fn(),
  listClosedSessions: vi.fn(),
  listMovements: vi.fn(),
  getOverview: vi.fn(),
  getNames: vi.fn(),
  openSession: vi.fn(),
  closeSession: vi.fn(),
  addMovement: vi.fn(),
}))

import * as cashService from '@/services/cashRegister'
import type { CashSession } from '@/services/cashRegister'

const OPEN = {
  id: 'sess-1',
  opened_by: 'user-1',
  closed_at: null,
} as unknown as CashSession
const CLOSED = {
  id: 'sess-1',
  opened_by: 'user-1',
  closed_by: 'user-1',
  closed_at: '2026-10-10T20:00:00Z',
  expected_cents: 85000,
  counted_cents: 84000,
  difference_cents: -1000,
} as unknown as CashSession

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  const session = useSessionStore()
  session.activeTenantId = 'tenant-a'
  session.activeBranchId = 'branch-1'
  // @ts-expect-error -- solo hace falta el id del usuario para estos tests.
  session.user = { id: 'user-1' }
  vi.mocked(cashService.getOpenSession).mockResolvedValue(null)
  vi.mocked(cashService.listClosedSessions).mockResolvedValue([])
  vi.mocked(cashService.listMovements).mockResolvedValue([])
  vi.mocked(cashService.getNames).mockResolvedValue({})
})

describe('load', () => {
  it('sin caja abierta deja el resumen y los movimientos vacíos y trae el historial', async () => {
    // La pantalla decide entre "Abrir caja" y "Caja abierta" por `openSession`.
    vi.mocked(cashService.listClosedSessions).mockResolvedValue([CLOSED])
    const store = useCashRegisterStore()

    await store.load()

    expect(store.openSession).toBeNull()
    expect(store.overview).toBeNull()
    expect(store.history).toHaveLength(1)
    expect(cashService.getOverview).not.toHaveBeenCalled()
    expect(store.status).toBe('ready')
  })

  it('con caja abierta trae el resumen del turno y sus movimientos', async () => {
    vi.mocked(cashService.getOpenSession).mockResolvedValue(OPEN)
    vi.mocked(cashService.getOverview).mockResolvedValue({ cashCents: 1000 } as never)
    const store = useCashRegisterStore()

    await store.load()

    expect(store.openSession?.id).toBe('sess-1')
    expect(store.overview?.cashCents).toBe(1000)
    expect(cashService.listMovements).toHaveBeenCalledWith('sess-1')
  })

  it('si falla la conexión deja un mensaje y no se queda cargando', async () => {
    vi.mocked(cashService.getOpenSession).mockRejectedValue(new Error('red'))
    const store = useCashRegisterStore()

    await store.load()

    expect(store.status).toBe('error')
    expect(store.errorMessage).toMatch(/No se pudo cargar la caja/)
  })
})

describe('open', () => {
  it('abre con el fondo en centavos y recarga', async () => {
    // $500.50 debe viajar como 50050, nunca como un flotante.
    vi.mocked(cashService.openSession).mockResolvedValue('sess-1')
    const store = useCashRegisterStore()

    const error = await store.open('$500.50', ' turno de la mañana ')

    expect(error).toBeNull()
    expect(cashService.openSession).toHaveBeenCalledWith(
      'branch-1',
      50050,
      'turno de la mañana',
    )
    expect(cashService.getOpenSession).toHaveBeenCalled()
  })

  it('un fondo inválido no llega al servidor', async () => {
    const store = useCashRegisterStore()

    expect(await store.open('abc', '')).toMatch(/fondo inicial no es válido/)
    expect(await store.open('', '')).toBe('Escribe el fondo inicial.')
    expect(cashService.openSession).not.toHaveBeenCalled()
  })

  it('devuelve el mensaje de la base si ya hay una caja abierta', async () => {
    vi.mocked(cashService.openSession).mockRejectedValue(
      new Error('Ya hay una caja abierta en esta sucursal.'),
    )
    const store = useCashRegisterStore()

    expect(await store.open('0', '')).toBe('Ya hay una caja abierta en esta sucursal.')
  })
})

describe('addMovement', () => {
  it('sin caja abierta no registra nada', async () => {
    const store = useCashRegisterStore()

    expect(await store.addMovement('expense', '30', 'Hielo')).toMatch(
      /No hay una caja abierta/,
    )
    expect(cashService.addMovement).not.toHaveBeenCalled()
  })

  it('exige monto y motivo, y manda el monto en centavos con quien lo registra', async () => {
    vi.mocked(cashService.getOpenSession).mockResolvedValue(OPEN)
    vi.mocked(cashService.getOverview).mockResolvedValue({} as never)
    const store = useCashRegisterStore()
    await store.load()

    expect(await store.addMovement('expense', '0', 'Hielo')).toMatch(/mayor a cero/)
    expect(await store.addMovement('expense', '30', '  ')).toMatch(/motivo/)
    expect(cashService.addMovement).not.toHaveBeenCalled()

    expect(
      await store.addMovement('withdrawal', '200', 'Se guarda en la caja fuerte'),
    ).toBeNull()
    expect(cashService.addMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-1',
        userId: 'user-1',
        type: 'withdrawal',
        amountCents: 20000,
      }),
    )
  })
})

describe('close', () => {
  it('cierra con el conteo y devuelve la diferencia calculada de lo congelado', async () => {
    // Contó $840 y se esperaban $850: faltan $10. Es lo que ve recepción al terminar.
    vi.mocked(cashService.getOpenSession).mockResolvedValue(OPEN)
    vi.mocked(cashService.getOverview).mockResolvedValue({} as never)
    vi.mocked(cashService.closeSession).mockResolvedValue(CLOSED)
    const store = useCashRegisterStore()
    await store.load()

    const result = await store.close('840', 'todo en orden')

    expect(cashService.closeSession).toHaveBeenCalledWith(
      'sess-1',
      84000,
      'todo en orden',
    )
    expect(result.error).toBeNull()
    expect(result.closed?.difference).toEqual({
      differenceCents: -1000,
      kind: 'shortage',
    })
  })

  it('un conteo inválido no llega al servidor, y sin caja abierta no hay qué cerrar', async () => {
    const store = useCashRegisterStore()
    expect((await store.close('840', '')).error).toMatch(/No hay una caja abierta/)

    vi.mocked(cashService.getOpenSession).mockResolvedValue(OPEN)
    vi.mocked(cashService.getOverview).mockResolvedValue({} as never)
    await store.load()
    expect((await store.close('', '')).error).toBe('Escribe el efectivo contado.')
    expect((await store.close('12.345', '')).error).toMatch(/no es válido/)
    expect(cashService.closeSession).not.toHaveBeenCalled()
  })

  it('si la base rechaza el cierre devuelve su mensaje', async () => {
    vi.mocked(cashService.getOpenSession).mockResolvedValue(OPEN)
    vi.mocked(cashService.getOverview).mockResolvedValue({} as never)
    vi.mocked(cashService.closeSession).mockRejectedValue(
      new Error('Esta caja ya está cerrada.'),
    )
    const store = useCashRegisterStore()
    await store.load()

    expect((await store.close('100', '')).error).toBe('Esta caja ya está cerrada.')
  })
})
