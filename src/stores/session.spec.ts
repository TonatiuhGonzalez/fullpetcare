// Tests de useSessionStore.
//
// =============================================================================
// Qué es un mock, y por qué esta es la primera vez que aparece
// =============================================================================
//
// Hasta ahora los tests (money.spec.ts, y los de supabase/tests/) probaban
// código que no depende de nada externo, o que hablaba con un Postgres de
// verdad. Este store es distinto: llama a services/auth.ts,
// services/profiles.ts y services/memberships.ts, que a su vez llaman a
// Supabase por HTTP. Un test unitario NO debe necesitar red ni Docker
// corriendo — tiene que poder correr en cualquier lado, en milisegundos.
//
// Un "mock" es reemplazar esas funciones reales por versiones falsas que
// TÚ controlas: "cuando algo llame a listMyMemberships(), no vayas a
// Supabase — devuelve exactamente estos datos que yo digo". Así se prueba
// UNA SOLA COSA a la vez: la lógica del store (¿decide bien qué tenant
// activar? ¿limpia todo en logout?), no si Supabase responde bien — eso
// ya lo cubren los tests de supabase/tests/.
//
// `vi.mock('@/services/auth', () => ({...}))` le dice a Vitest: "cuando
// cualquier archivo importe desde '@/services/auth', dale esta versión
// falsa en vez de la real". Como el store importa exactamente esa ruta,
// nunca toca la implementación real. Después, en cada test,
// `vi.mocked(signIn).mockResolvedValue(...)` configura qué debe
// "responder" esa función falsa para ese caso concreto.
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSessionStore } from './session'
import type { MembershipSummary } from '@/services/memberships'

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

// Se importan DESPUÉS de los vi.mock() de arriba — en este punto ya no
// son las funciones reales, son las versiones falsas (vi.fn()) que se
// configuran abajo con mockResolvedValue().
import { signIn, signOut } from '@/services/auth'
import { getProfile } from '@/services/profiles'
import { listMyMemberships } from '@/services/memberships'

// Dos membresías de prueba, en tenants distintos — a propósito más de
// una, para que "si solo hay una opción se elige sola" nunca se cuele
// como explicación de por qué un test pasa cuando lo que se quiere
// probar es otra cosa (elegir a mano, o descartar una guardada).
const MEMBERSHIP_A: MembershipSummary = {
  membershipId: 'm-a',
  tenantId: 'tenant-a',
  tenantName: 'Patitas Felices',
  tenantTimezone: 'America/Mexico_City',
  role: 'owner',
  branches: [
    { id: 'branch-a1', name: 'Centro' },
    { id: 'branch-a2', name: 'Del Valle' },
  ],
}
const MEMBERSHIP_B: MembershipSummary = {
  membershipId: 'm-b',
  tenantId: 'tenant-b',
  tenantName: 'Huellitas Spa',
  tenantTimezone: 'America/Tijuana',
  role: 'vet',
  branches: [{ id: 'branch-b1', name: 'Zona Río' }],
}

beforeEach(() => {
  // Un Pinia "limpio" por test: sin esto, el estado de un test se
  // arrastraría al siguiente (son el mismo store, si no se resetea).
  setActivePinia(createPinia())
  // Igual con localStorage: jsdom lo mantiene entre tests del mismo
  // archivo si no se limpia a mano.
  localStorage.clear()
  vi.clearAllMocks()
})

describe('login', () => {
  it('al elegir tenant se fija el rol correcto', async () => {
    // Caso central del store: una vez con la sesión iniciada y las
    // membresías cargadas, seleccionar un tenant debe reflejar el rol de
    // ESE tenant — no el de otro, ni uno mezclado. Si esto fallara, un
    // veterinario podría terminar viendo botones de "dueño" en la UI.
    vi.mocked(signIn).mockResolvedValue({
      id: 'user-1',
      email: 'dueno@patitasfelices.mx',
    })
    vi.mocked(getProfile).mockResolvedValue({
      fullName: 'Fernanda Ruiz',
      avatarPath: null,
    })
    vi.mocked(listMyMemberships).mockResolvedValue([MEMBERSHIP_A, MEMBERSHIP_B])

    const store = useSessionStore()
    await store.login('dueno@patitasfelices.mx', 'Demo1234!')

    store.selectTenant('tenant-b')

    expect(store.role).toBe('vet')
    expect(store.activeMembership?.tenantName).toBe('Huellitas Spa')

    store.selectTenant('tenant-a')

    expect(store.role).toBe('owner')
  })

  it('si las credenciales son inválidas, deja status en "error" y no toca memberships', async () => {
    // Borde importante: un login fallido no debe dejar el store en un
    // estado intermedio raro (p. ej. "isAuthenticated" a medias). Se
    // relanza el error para que la pantalla de login pueda mostrarlo.
    vi.mocked(signIn).mockRejectedValue(new Error('Invalid login credentials'))

    const store = useSessionStore()
    await expect(store.login('quien@sea.mx', 'mala-contraseña')).rejects.toThrow()

    expect(store.status).toBe('error')
    expect(store.isAuthenticated).toBe(false)
    expect(store.memberships).toEqual([])
  })
})

describe('logout', () => {
  it('limpia todo: usuario, membresías, selección activa y localStorage', async () => {
    vi.mocked(signIn).mockResolvedValue({
      id: 'user-1',
      email: 'dueno@patitasfelices.mx',
    })
    vi.mocked(getProfile).mockResolvedValue({
      fullName: 'Fernanda Ruiz',
      avatarPath: null,
    })
    vi.mocked(listMyMemberships).mockResolvedValue([MEMBERSHIP_A, MEMBERSHIP_B])
    vi.mocked(signOut).mockResolvedValue(undefined)

    const store = useSessionStore()
    await store.login('dueno@patitasfelices.mx', 'Demo1234!')
    store.selectTenant('tenant-a')
    store.selectBranch('branch-a1')

    // Antes de cerrar sesión, hay algo que limpiar de verdad — si no,
    // el test "pasaría" sin haber probado nada.
    expect(store.isAuthenticated).toBe(true)
    expect(localStorage.getItem('fpc.activeTenantId')).toBe('tenant-a')

    await store.logout()

    expect(store.user).toBeNull()
    expect(store.profile).toBeNull()
    expect(store.memberships).toEqual([])
    expect(store.activeTenantId).toBeNull()
    expect(store.activeBranchId).toBeNull()
    expect(store.isAuthenticated).toBe(false)
    // No basta con que el store en memoria esté limpio: si localStorage
    // conservara el tenant viejo, el siguiente login (de OTRA persona, en
    // el mismo navegador) heredaría esa selección sin querer.
    expect(localStorage.getItem('fpc.activeTenantId')).toBeNull()
    expect(localStorage.getItem('fpc.activeBranchId')).toBeNull()
  })
})

describe('loadMemberships — selección activa', () => {
  it('si la membresía guardada en localStorage ya no existe, se descarta', async () => {
    // Simula el caso real que le da sentido a esta prueba: en una sesión
    // ANTERIOR alguien eligió "tenant-viejo" (guardado en localStorage),
    // pero entre esa sesión y esta, le revocaron el acceso a ese tenant
    // (o nunca perteneció — el localStorage de un navegador compartido
    // puede traer cualquier cosa). Al cargar las membresías de nuevo,
    // ese id ya no aparece en la respuesta del servidor.
    localStorage.setItem('fpc.activeTenantId', 'tenant-viejo-que-ya-no-existe')
    vi.mocked(listMyMemberships).mockResolvedValue([MEMBERSHIP_A, MEMBERSHIP_B])

    const store = useSessionStore()
    // Se fuerza el estado de "hay sesión" sin pasar por login(), para
    // probar loadMemberships() de forma aislada.
    store.user = { id: 'user-1', email: 'x@y.mx' }

    await store.loadMemberships()

    // Como hay DOS membresías (no una), no se "adivina" ninguna — se
    // descarta la guardada y se deja sin elegir, a la espera de que la
    // persona elija en SelectBusinessPage.
    expect(store.activeTenantId).toBeNull()
    expect(localStorage.getItem('fpc.activeTenantId')).toBeNull()
  })

  it('si solo hay una membresía posible, se elige sola', async () => {
    // El otro lado de la misma regla: con una sola opción no tiene
    // sentido obligar a hacer clic. Esto es lo que hace que
    // SelectBusinessPage "salte sola" cuando no hay nada que elegir
    // (tarea 1.30).
    vi.mocked(listMyMemberships).mockResolvedValue([MEMBERSHIP_B])

    const store = useSessionStore()
    store.user = { id: 'user-1', email: 'x@y.mx' }

    await store.loadMemberships()

    expect(store.activeTenantId).toBe('tenant-b')
    // Y como esa membresía también tiene una sola sucursal, esa también
    // se elige sola.
    expect(store.activeBranchId).toBe('branch-b1')
    expect(store.needsBusinessSelection).toBe(false)
  })

  it('la membresía guardada SÍ se conserva si sigue siendo válida', async () => {
    localStorage.setItem('fpc.activeTenantId', 'tenant-a')
    localStorage.setItem('fpc.activeBranchId', 'branch-a2')
    vi.mocked(listMyMemberships).mockResolvedValue([MEMBERSHIP_A, MEMBERSHIP_B])

    const store = useSessionStore()
    store.user = { id: 'user-1', email: 'x@y.mx' }

    await store.loadMemberships()

    expect(store.activeTenantId).toBe('tenant-a')
    expect(store.activeBranchId).toBe('branch-a2')
  })
})
