// Tests de useReportsStore. Los services se reemplazan por versiones falsas (mismo
// patrón que cashRegister.spec.ts): aquí se prueba que el store pide el periodo
// correcto y maneja los errores; que la base calcule bien lo cubren los tests de
// supabase/tests/.
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useReportsStore } from './reports'
import { useSessionStore } from './session'

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
vi.mock('@/services/reports', () => ({
  getSalesSummary: vi.fn(),
  getTopItems: vi.fn(),
  getStaffActivity: vi.fn(),
}))

import * as reportsService from '@/services/reports'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  // Miércoles 7 de octubre de 2026, 12:00 en la Ciudad de México.
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-07T18:00:00Z'))
  const session = useSessionStore()
  session.activeTenantId = 'tenant-a'
  vi.mocked(reportsService.getSalesSummary).mockResolvedValue({
    totals: { totalCents: 100 },
  } as never)
  vi.mocked(reportsService.getTopItems).mockResolvedValue({ services: [], products: [] })
  vi.mocked(reportsService.getStaffActivity).mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('load', () => {
  it('por defecto pide el mes en curso a hoy, con la fecha local de la sucursal', async () => {
    // Si usara la fecha UTC del navegador, a las 6 pm del último día del mes
    // pediría el mes siguiente.
    const store = useReportsStore()

    await store.load()

    expect(reportsService.getSalesSummary).toHaveBeenCalledWith(
      'tenant-a',
      '2026-10-01',
      '2026-10-07',
      null,
    )
    expect(reportsService.getTopItems).toHaveBeenCalledWith(
      'tenant-a',
      '2026-10-01',
      '2026-10-07',
      null,
    )
    expect(reportsService.getStaffActivity).toHaveBeenCalledWith(
      'tenant-a',
      '2026-10-01',
      '2026-10-07',
      null,
    )
    expect(store.summary?.totals.totalCents).toBe(100)
    expect(store.status).toBe('ready')
  })

  it('cambiar el periodo recarga con el rango nuevo', async () => {
    const store = useReportsStore()

    await store.setPreset('week')

    expect(reportsService.getSalesSummary).toHaveBeenCalledWith(
      'tenant-a',
      '2026-10-05',
      '2026-10-07',
      null,
    )
  })

  it('un rango a mano no carga hasta que se aplica, y uno inválido no llega al servidor', async () => {
    const store = useReportsStore()

    await store.setPreset('range')
    expect(reportsService.getSalesSummary).not.toHaveBeenCalled()

    store.customRange = { from: '2026-10-10', to: '2026-10-01' }
    await store.load()
    expect(reportsService.getSalesSummary).not.toHaveBeenCalled()
    expect(store.status).toBe('error')
    expect(store.errorMessage).toMatch(/posterior/)

    store.customRange = { from: '2026-10-01', to: '2026-10-03' }
    await store.load()
    expect(reportsService.getSalesSummary).toHaveBeenCalledWith(
      'tenant-a',
      '2026-10-01',
      '2026-10-03',
      null,
    )
  })

  it('filtrar por sucursal manda ese id; "todas" manda null', async () => {
    const store = useReportsStore()

    await store.setBranch('branch-2')
    expect(reportsService.getSalesSummary).toHaveBeenLastCalledWith(
      'tenant-a',
      '2026-10-01',
      '2026-10-07',
      'branch-2',
    )

    await store.setBranch(null)
    expect(reportsService.getSalesSummary).toHaveBeenLastCalledWith(
      'tenant-a',
      '2026-10-01',
      '2026-10-07',
      null,
    )
  })

  it('si falla un reporte muestra el mensaje y no deja datos a medias como "listos"', async () => {
    vi.mocked(reportsService.getTopItems).mockRejectedValue(
      new Error('No tienes permiso para ver los reportes.'),
    )
    const store = useReportsStore()

    await store.load()

    expect(store.status).toBe('error')
    expect(store.errorMessage).toBe('No tienes permiso para ver los reportes.')
  })

  it('reset limpia todo para el siguiente negocio o sucursal', async () => {
    const store = useReportsStore()
    await store.setBranch('branch-2')

    store.reset()

    expect(store.summary).toBeNull()
    expect(store.branchId).toBeNull()
    expect(store.preset).toBe('month')
  })
})
