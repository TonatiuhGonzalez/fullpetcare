// Tests de useAgendaStore (tarea 3.15, extendido al rediseño 2026-09-08:
// el rango de fechas visible ahora depende del ROL). Se mockea
// services/appointments.ts y services/branches.ts (lo que este store
// llama directo) y, aunque este archivo no prueba login/membresías,
// TAMBIÉN se mockean auth/profiles/memberships — este store importa
// useSessionStore, que a su vez los importa a ELLOS, que a su vez
// importan services/supabase.ts. Ese archivo revienta al cargarse si
// faltan VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY (services/supabase.ts,
// tarea 1.25) — en la Mac del usuario no se nota porque sí existe un
// .env.local con valores reales, pero en CI ese archivo no existe (está
// en .gitignore) y el test truena al importar, no al correr. Mockear
// auth/profiles/memberships corta la cadena de imports ANTES de llegar
// a supabase.ts, igual que ya hace session.spec.ts.
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAgendaStore } from './agenda'
import { useSessionStore } from './session'
import type { AppointmentWithNames } from '@/services/appointments'
import type { MembershipSummary } from '@/services/memberships'

vi.mock('@/services/appointments', () => ({
  listByDateRange: vi.fn(),
}))
vi.mock('@/services/branches', () => ({
  getById: vi.fn(),
}))
// load() ahora también pregunta cuáles de esas citas ya se cobraron
// (paidAppointmentIds, para pintar "Cobrada" en AgendaPage.vue) — sin
// este mock, listPaidAppointmentIds() intentaría hablar con Supabase de
// verdad y el test truena (test:unit es sin red, CLAUDE.md §9).
vi.mock('@/services/checkout', () => ({
  listPaidAppointmentIds: vi.fn(),
}))
vi.mock('@/services/auth', () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  getCurrentUser: vi.fn(),
}))
vi.mock('@/services/profiles', () => ({
  getProfile: vi.fn(),
}))
vi.mock('@/services/memberships', () => ({
  listMyMemberships: vi.fn(),
}))

import { listByDateRange } from '@/services/appointments'
import { getById as getBranchById } from '@/services/branches'
import { listPaidAppointmentIds } from '@/services/checkout'

const OWNER_MEMBERSHIP: MembershipSummary = {
  membershipId: 'm-1',
  tenantId: 'tenant-1',
  tenantName: 'Patitas Felices',
  tenantTimezone: 'America/Mexico_City',
  role: 'owner',
  branches: [
    { id: 'branch-centro', name: 'Centro', timezone: 'America/Mexico_City' },
    { id: 'branch-tijuana', name: 'Zona Río', timezone: 'America/Tijuana' },
  ],
}

const GROOMER_MEMBERSHIP: MembershipSummary = {
  ...OWNER_MEMBERSHIP,
  membershipId: 'm-2',
  role: 'groomer',
}

function makeAppointment(overrides: Partial<AppointmentWithNames>): AppointmentWithNames {
  return {
    id: 'apt-default',
    tenant_id: 'tenant-1',
    branch_id: 'branch-centro',
    customer_id: 'customer-1',
    pet_id: 'pet-1',
    kind: 'grooming',
    employee_user_id: 'empleado-1',
    starts_at: '2027-01-01T15:00:00Z',
    ends_at: '2027-01-01T16:00:00Z',
    status: 'scheduled',
    notes: null,
    created_by: 'owner-1',
    created_at: '2027-01-01T00:00:00Z',
    updated_at: '2027-01-01T00:00:00Z',
    deleted_at: null,
    customerName: 'Sofía Ramírez',
    petName: 'Rocky',
    ...overrides,
  }
}

function setupSession(membership: MembershipSummary = OWNER_MEMBERSHIP) {
  const session = useSessionStore()
  session.memberships = [membership]
  session.activeTenantId = membership.tenantId
  session.activeBranchId = 'branch-centro'
  return session
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.mocked(listByDateRange).mockReset()
  vi.mocked(getBranchById).mockReset()
  vi.mocked(listPaidAppointmentIds).mockReset()
  // Default razonable: sin sucursal (o sin horario configurado), la
  // grilla cae en el rango por default de lib/calendarGrid.ts — cada
  // test que sí necesite un horario real lo sobreescribe.
  vi.mocked(getBranchById).mockResolvedValue(null)
  vi.mocked(listPaidAppointmentIds).mockResolvedValue(new Set())
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useAgendaStore — dueño/recepción (un solo día, navegable)', () => {
  it('initFromSession arranca en la sucursal activa de la sesión y carga las citas de HOY', async () => {
    setupSession()
    vi.mocked(listByDateRange).mockResolvedValue([makeAppointment({ id: 'apt-1' })])

    const agenda = useAgendaStore()
    agenda.initFromSession()
    await vi.waitFor(() => expect(agenda.status).toBe('ready'))

    expect(agenda.activeBranchId).toBe('branch-centro')
    expect(agenda.appointments).toHaveLength(1)
    expect(agenda.appointments[0].id).toBe('apt-1')
  })

  it('visibleDates es un arreglo de UN solo día: activeDate', async () => {
    // La vista de dueño/recepción es DayPilotScheduler (un día, filas =
    // empleados) — si visibleDates devolviera más de un día, el store
    // pediría citas de más de lo que la pantalla necesita.
    setupSession()
    vi.mocked(listByDateRange).mockResolvedValue([])

    const agenda = useAgendaStore()
    agenda.initFromSession()
    await vi.waitFor(() => expect(agenda.status).toBe('ready'))

    agenda.setDate('2027-06-15')
    await vi.waitFor(() => expect(agenda.visibleDates).toEqual(['2027-06-15']))
  })

  it('cambiar de día vuelve a pedir las citas de ESE día (recarga)', async () => {
    // El caso original de la tarea 3.15: setDate() no solo cambia el
    // valor guardado, dispara una consulta nueva — si no recargara, la
    // agenda seguiría mostrando las citas del día viejo.
    setupSession()
    vi.mocked(listByDateRange).mockResolvedValue([])

    const agenda = useAgendaStore()
    agenda.initFromSession()
    await vi.waitFor(() => expect(agenda.status).toBe('ready'))

    const callsBefore = vi.mocked(listByDateRange).mock.calls.length
    agenda.setDate('2027-06-15')
    await vi.waitFor(() =>
      expect(vi.mocked(listByDateRange).mock.calls.length).toBeGreaterThan(callsBefore),
    )

    const lastCall = vi.mocked(listByDateRange).mock.calls.at(-1)
    expect(lastCall?.[2]).toBe('2027-06-15') // inicio del rango
    expect(lastCall?.[3]).toBe('2027-06-15') // fin del rango: el MISMO día, no una semana
  })

  it('cambiar de sucursal vuelve a cargar en la sucursal nueva', async () => {
    setupSession()
    vi.mocked(listByDateRange).mockResolvedValue([])

    const agenda = useAgendaStore()
    agenda.initFromSession()
    await vi.waitFor(() => expect(agenda.status).toBe('ready'))

    agenda.setBranch('branch-tijuana')
    await vi.waitFor(() => expect(agenda.activeBranchId).toBe('branch-tijuana'))
  })

  it('hourRange usa el horario de la sucursal cargada para ESE día, no el default', async () => {
    // Conecta el store con lib/calendarGrid.ts#visibleHourRange: si el
    // store no leyera branch.opening_hours, la grilla siempre caería en
    // el rango por default (09:00-18:00) sin importar el horario real
    // de la sucursal.
    setupSession()
    vi.mocked(listByDateRange).mockResolvedValue([])
    vi.mocked(getBranchById).mockResolvedValue({
      id: 'branch-centro',
      tenant_id: 'tenant-1',
      name: 'Centro',
      address: '',
      postal_code: '',
      phone: '',
      timezone: 'America/Mexico_City',
      opening_hours: {
        sunday: null,
        monday: { opensAt: '08:00', closesAt: '20:00' },
        tuesday: { opensAt: '08:00', closesAt: '20:00' },
        wednesday: { opensAt: '08:00', closesAt: '20:00' },
        thursday: { opensAt: '08:00', closesAt: '20:00' },
        friday: { opensAt: '08:00', closesAt: '20:00' },
        saturday: null,
      },
      created_at: '2027-01-01T00:00:00Z',
      updated_at: '2027-01-01T00:00:00Z',
      deleted_at: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Branch de prueba, no todos los campos importan aquí.
    } as any)

    const agenda = useAgendaStore()
    agenda.initFromSession()
    agenda.setDate('2027-06-14') // lunes: sí abre en el fixture de arriba
    await vi.waitFor(() => expect(agenda.status).toBe('ready'))

    expect(agenda.hourRange).toEqual({ startMinutes: 8 * 60, endMinutes: 20 * 60 })
  })
})

describe('useAgendaStore — groomer/vet (ventana fija de 7 días, sin navegación)', () => {
  it('visibleDates SIEMPRE es "hoy + 6 días" en la hora de la sucursal, sin importar activeDate', async () => {
    // Decisión explícita del rediseño: groomer/vet no tienen selector de
    // fecha ni flechas — su ventana es fija. Fijamos el reloj del
    // sistema para que "hoy" sea determinista en el test.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2027-06-15T12:00:00Z')) // 06:00 en CDMX, sigue siendo 15 de junio ahí

    setupSession(GROOMER_MEMBERSHIP)
    vi.mocked(listByDateRange).mockResolvedValue([])

    const agenda = useAgendaStore()
    agenda.initFromSession()
    await vi.waitFor(() => expect(agenda.status).toBe('ready'))

    expect(agenda.visibleDates).toEqual([
      '2027-06-15',
      '2027-06-16',
      '2027-06-17',
      '2027-06-18',
      '2027-06-19',
      '2027-06-20',
      '2027-06-21',
    ])

    // setDate() no debe mover nada para este rol — no hay UI que lo
    // llame, pero si algo lo hiciera por error, no debe romper la regla.
    agenda.setDate('2020-01-01')
    expect(agenda.visibleDates[0]).toBe('2027-06-15')
  })

  it('pide las citas del rango completo de 7 días en una sola consulta', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2027-06-15T12:00:00Z'))

    setupSession(GROOMER_MEMBERSHIP)
    vi.mocked(listByDateRange).mockResolvedValue([])

    const agenda = useAgendaStore()
    agenda.initFromSession()
    await vi.waitFor(() => expect(agenda.status).toBe('ready'))

    const lastCall = vi.mocked(listByDateRange).mock.calls.at(-1)
    expect(lastCall?.[2]).toBe('2027-06-15')
    expect(lastCall?.[3]).toBe('2027-06-21')
  })
})
