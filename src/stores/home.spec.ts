// Tests de useHomeStore (pantalla Inicio). Los services se reemplazan por versiones
// falsas (mismo patrón que cashRegister.spec.ts): aquí se prueba QUÉ pide cada rol y
// cómo se arma el resumen, no la base de datos. Lo que se rompería en producción si
// fallaran: un groomer pidiendo la caja (y viendo un error de permisos), o una caja
// que no responde dejando toda la pantalla de Inicio en blanco.
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useHomeStore } from './home'
import { useSessionStore } from './session'

// useSessionStore importa estos services y todos terminan en services/supabase.ts,
// que lanza error sin VITE_SUPABASE_URL (en el CI no existe): se mockean.
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
vi.mock('@/services/appointments', () => ({
  listByDay: vi.fn(),
  listServicesForAppointments: vi.fn(),
}))
vi.mock('@/services/checkout', () => ({ listPaidAppointmentIds: vi.fn() }))
vi.mock('@/services/cashRegister', () => ({
  getOpenSession: vi.fn(),
  getOverview: vi.fn(),
}))
vi.mock('@/services/reports', () => ({ getSalesSummary: vi.fn() }))

import * as appointmentsService from '@/services/appointments'
import * as cashService from '@/services/cashRegister'
import * as checkoutService from '@/services/checkout'
import * as reportsService from '@/services/reports'
import type { MemberRole } from '@/services/memberships'

const appt = (id: string, status: string, starts_at = '2026-10-08T16:00:00Z') =>
  ({ id, status, starts_at, customerName: 'Sofía', petName: 'Rocky' }) as never

function setSession(role: MemberRole, views: ('cash_register' | 'reports')[] = []): void {
  const session = useSessionStore()
  session.activeTenantId = 'tenant-a'
  session.activeBranchId = 'branch-1'
  session.memberships = [
    {
      membershipId: 'm1',
      tenantId: 'tenant-a',
      tenantName: 'Patitas',
      tenantTimezone: 'America/Mexico_City',
      role,
      branches: [{ id: 'branch-1', name: 'Centro', timezone: 'America/Mexico_City' }],
    },
  ]
  session.permissions = views.map((module) => ({
    role,
    module,
    canView: true,
    canEdit: true,
  }))
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.mocked(appointmentsService.listByDay).mockResolvedValue([
    appt('a', 'scheduled'),
    appt('b', 'completed'),
    appt('c', 'completed'),
  ])
  vi.mocked(checkoutService.listPaidAppointmentIds).mockResolvedValue(new Set(['c']))
  vi.mocked(appointmentsService.listServicesForAppointments).mockResolvedValue([
    { appointment_id: 'b', unit_price_cents: 25000, quantity: 2 },
  ] as never)
  vi.mocked(cashService.getOpenSession).mockResolvedValue(null)
  vi.mocked(reportsService.getSalesSummary).mockResolvedValue({
    totals: { salesCount: 3, totalCents: 120000 },
  } as never)
})

describe('load', () => {
  // Qué prueba: el caso de recepción. Arma el resumen del día, detecta lo por cobrar
  // y calcula su total estimado con los servicios de ESA cita (la "b", no la cobrada).
  it('recepción: resume el día y estima el total por cobrar', async () => {
    setSession('receptionist')
    const store = useHomeStore()

    await store.load()

    expect(store.status).toBe('ready')
    expect(store.summary.total).toBe(3)
    expect(store.summary.awaitingPayment).toBe(1)
    expect(store.pending.map((a) => a.id)).toEqual(['b'])
    expect(appointmentsService.listServicesForAppointments).toHaveBeenCalledWith(['b'])
    expect(store.pendingCents).toBe(50000)
  })

  // Qué prueba: que un groomer NO consulta cobros, caja ni ventas. Esas consultas la
  // base las rechazaría y la pantalla mostraría errores falsos a quien no le tocan.
  it('groomer: solo pide sus citas, nada de cobro, caja ni ventas', async () => {
    setSession('groomer')
    const store = useHomeStore()

    await store.load()

    expect(store.status).toBe('ready')
    expect(store.pendingCents).toBe(0)
    expect(appointmentsService.listServicesForAppointments).not.toHaveBeenCalled()
    expect(cashService.getOpenSession).not.toHaveBeenCalled()
    expect(reportsService.getSalesSummary).not.toHaveBeenCalled()
    expect(store.cash).toBeUndefined()
    expect(store.sales).toBeUndefined()
  })

  // Qué prueba: el dueño con caja abierta y ventas: trae el efectivo esperado y el
  // total del día, y pide las ventas de HOY de la sucursal activa (no un periodo ajeno).
  it('dueño: trae caja abierta y ventas de hoy de la sucursal activa', async () => {
    setSession('owner')
    vi.mocked(cashService.getOpenSession).mockResolvedValue({
      id: 'sess-1',
      opened_at: '2026-10-08T14:00:00Z',
    } as never)
    vi.mocked(cashService.getOverview).mockResolvedValue({
      expectedCents: 150000,
    } as never)
    const store = useHomeStore()

    await store.load()

    expect(store.cash).toEqual({
      openedAt: '2026-10-08T14:00:00Z',
      expectedCents: 150000,
    })
    expect(store.sales).toEqual({ totalCents: 120000, salesCount: 3 })
    const [tenant, from, to, branch] = vi.mocked(reportsService.getSalesSummary).mock
      .calls[0]
    expect(tenant).toBe('tenant-a')
    expect(from).toBe(to)
    expect(branch).toBe('branch-1')
  })

  // Qué prueba: caja cerrada es un estado válido (null), distinto de "no se pidió"
  // (undefined). La pantalla muestra "Caja cerrada" en un caso y nada en el otro.
  it('con la caja cerrada deja cash en null, no en undefined', async () => {
    setSession('owner')
    const store = useHomeStore()
    await store.load()
    expect(store.cash).toBeNull()
  })

  // Qué prueba: que una falla de la caja NO tumba el resto. Es el caso "la caja no
  // responde y toda la pantalla de Inicio se queda en blanco" que se quiere evitar.
  it('si falla la caja, las citas y las ventas se siguen mostrando', async () => {
    setSession('owner')
    vi.mocked(cashService.getOpenSession).mockRejectedValue(new Error('red'))
    const store = useHomeStore()

    await store.load()

    expect(store.status).toBe('ready')
    expect(store.cashFailed).toBe(true)
    expect(store.summary.total).toBe(3)
    expect(store.sales?.salesCount).toBe(3)
  })

  // Qué prueba: que si fallan las CITAS (lo principal) sí se avisa con un mensaje en
  // español y no se queda cargando para siempre.
  it('si fallan las citas deja un mensaje y no se queda cargando', async () => {
    setSession('receptionist')
    vi.mocked(appointmentsService.listByDay).mockRejectedValue(new Error('red'))
    const store = useHomeStore()

    await store.load()

    expect(store.status).toBe('error')
    expect(store.errorMessage).toMatch(/No se pudo cargar el resumen/)
  })

  // Qué prueba: sin sucursal activa (instante entre login y selección) no se llama
  // a la base con ids vacíos.
  it('sin sucursal activa no consulta nada', async () => {
    const session = useSessionStore()
    session.activeTenantId = 'tenant-a'
    const store = useHomeStore()

    await store.load()

    expect(appointmentsService.listByDay).not.toHaveBeenCalled()
    expect(store.status).toBe('idle')
  })
})
