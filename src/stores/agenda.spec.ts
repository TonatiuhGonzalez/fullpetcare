// Tests de useAgendaStore (tarea 3.15). Se mockea services/appointments.ts
// (lo que este store llama directo) y, aunque este archivo no prueba
// login/membresías, TAMBIÉN se mockean auth/profiles/memberships — este
// store importa useSessionStore, que a su vez los importa a ELLOS, que a
// su vez importan services/supabase.ts. Ese archivo revienta al cargarse
// si faltan VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY (services/supabase.ts,
// tarea 1.25) — en la Mac del usuario no se nota porque sí existe un
// .env.local con valores reales, pero en CI ese archivo no existe (está
// en .gitignore) y el test truena al importar, no al correr. Mockear
// auth/profiles/memberships corta la cadena de imports ANTES de llegar
// a supabase.ts, igual que ya hace session.spec.ts.
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAgendaStore } from './agenda'
import { useSessionStore } from './session'
import type { AppointmentWithNames } from '@/services/appointments'
import type { MembershipSummary } from '@/services/memberships'

vi.mock('@/services/appointments', () => ({
  listByDay: vi.fn(),
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

import { listByDay } from '@/services/appointments'

const MEMBERSHIP: MembershipSummary = {
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

function setupSession() {
  const session = useSessionStore()
  session.memberships = [MEMBERSHIP]
  session.activeTenantId = MEMBERSHIP.tenantId
  session.activeBranchId = 'branch-centro'
  return session
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.mocked(listByDay).mockReset()
})

describe('useAgendaStore', () => {
  it('initFromSession arranca en la sucursal activa de la sesión y carga sus citas', async () => {
    setupSession()
    vi.mocked(listByDay).mockResolvedValue([makeAppointment({ id: 'apt-1' })])

    const agenda = useAgendaStore()
    agenda.initFromSession()
    await vi.waitFor(() => expect(agenda.status).toBe('ready'))

    expect(agenda.activeBranchId).toBe('branch-centro')
    expect(agenda.appointments).toHaveLength(1)
    expect(agenda.appointments[0].id).toBe('apt-1')
  })

  it('cambiar de día vuelve a pedir las citas (recarga)', async () => {
    // El caso pedido explícitamente por la tarea 3.15: setDate() no solo
    // cambia el valor guardado, dispara una consulta nueva — si no
    // recargara, la agenda seguiría mostrando las citas del día viejo.
    setupSession()
    vi.mocked(listByDay).mockResolvedValue([])

    const agenda = useAgendaStore()
    agenda.initFromSession()
    await vi.waitFor(() => expect(agenda.status).toBe('ready'))

    const callsBefore = vi.mocked(listByDay).mock.calls.length
    agenda.setDate('2027-06-15')
    await vi.waitFor(() => expect(vi.mocked(listByDay).mock.calls.length).toBeGreaterThan(callsBefore))

    const lastCall = vi.mocked(listByDay).mock.calls.at(-1)
    expect(lastCall?.[2]).toBe('2027-06-15') // el tercer argumento es la fecha
  })

  it('cambiar de sucursal limpia el filtro de empleado', async () => {
    // El otro caso pedido por la tarea 3.15: un filtro de empleado
    // elegido en la sucursal anterior no tiene por qué seguir siendo
    // válido en la nueva — ese empleado podría ni trabajar ahí.
    setupSession()
    vi.mocked(listByDay).mockResolvedValue([])

    const agenda = useAgendaStore()
    agenda.initFromSession()
    await vi.waitFor(() => expect(agenda.status).toBe('ready'))

    agenda.setEmployeeFilter('empleado-1')
    expect(agenda.employeeFilter).toBe('empleado-1')

    agenda.setBranch('branch-tijuana')
    expect(agenda.employeeFilter).toBeNull()
    expect(agenda.activeBranchId).toBe('branch-tijuana')
  })

  it('filteredAppointments solo muestra las citas del empleado elegido', async () => {
    setupSession()
    vi.mocked(listByDay).mockResolvedValue([
      makeAppointment({ id: 'apt-1', employee_user_id: 'empleado-1' }),
      makeAppointment({ id: 'apt-2', employee_user_id: 'empleado-2' }),
    ])

    const agenda = useAgendaStore()
    agenda.initFromSession()
    await vi.waitFor(() => expect(agenda.status).toBe('ready'))

    expect(agenda.filteredAppointments).toHaveLength(2)

    agenda.setEmployeeFilter('empleado-1')
    expect(agenda.filteredAppointments).toHaveLength(1)
    expect(agenda.filteredAppointments[0].id).toBe('apt-1')
  })
})
