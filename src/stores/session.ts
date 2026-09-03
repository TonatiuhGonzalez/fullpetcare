// Estado de "quién soy, en qué negocio y en qué sucursal estoy trabajando
// ahora". Es el único store que sabe de sesión — pages y componentes lo
// consultan, nunca hablan con services/auth.ts directo (CLAUDE.md §4).
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import {
  getCurrentUser,
  signIn as signInRequest,
  signOut as signOutRequest,
  type AuthUser,
} from '@/services/auth'
import { getProfile, type MyProfile } from '@/services/profiles'
import { listMyMemberships, type MembershipSummary } from '@/services/memberships'

const ACTIVE_TENANT_KEY = 'fpc.activeTenantId'
const ACTIVE_BRANCH_KEY = 'fpc.activeBranchId'

// localStorage puede lanzar en algunos navegadores en modo privado muy
// restrictivo. Se envuelve para que, si eso pasa, la app siga
// funcionando — solo se pierde la comodidad de "recordar" la sucursal
// elegida entre recargas, nunca se cae la sesión por esto.
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Se ignora a propósito — ver comentario de arriba.
  }
}

export const useSessionStore = defineStore('session', () => {
  const user = ref<AuthUser | null>(null)
  const profile = ref<MyProfile | null>(null)
  const memberships = ref<MembershipSummary[]>([])
  const activeTenantId = ref<string | null>(null)
  const activeBranchId = ref<string | null>(null)
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const errorMessage = ref<string | null>(null)

  const isAuthenticated = computed(() => user.value !== null)

  const activeMembership = computed<MembershipSummary | null>(
    () => memberships.value.find((m) => m.tenantId === activeTenantId.value) ?? null,
  )
  const role = computed(() => activeMembership.value?.role ?? null)
  const activeBranches = computed(() => activeMembership.value?.branches ?? [])
  const activeBranch = computed(
    () => activeBranches.value.find((b) => b.id === activeBranchId.value) ?? null,
  )

  /** true si ya hay sesión pero todavía falta elegir negocio y/o sucursal. */
  const needsBusinessSelection = computed(
    () => isAuthenticated.value && (!activeTenantId.value || !activeBranchId.value),
  )

  function reset(): void {
    user.value = null
    profile.value = null
    memberships.value = []
    activeTenantId.value = null
    activeBranchId.value = null
    errorMessage.value = null
    writeStorage(ACTIVE_TENANT_KEY, null)
    writeStorage(ACTIVE_BRANCH_KEY, null)
  }

  /**
   * Recalcula qué sucursal queda activa, con el mismo criterio en los tres
   * casos donde hace falta (cargar membresías, elegir tenant, logout no
   * llega aquí porque usa reset()): si lo guardado en localStorage sigue
   * siendo una sucursal válida de la membresía activa, se conserva; si no,
   * y hay una sola opción posible, se elige sola; si hay varias y ninguna
   * coincide con lo guardado, se deja sin elegir.
   */
  function resolveActiveBranch(): void {
    const branches = activeMembership.value?.branches ?? []
    const storedBranchId = readStorage(ACTIVE_BRANCH_KEY)
    const validStoredBranch = branches.find((b) => b.id === storedBranchId)

    if (validStoredBranch) {
      activeBranchId.value = validStoredBranch.id
    } else if (branches.length === 1) {
      activeBranchId.value = branches[0].id
    } else {
      activeBranchId.value = null
    }
    writeStorage(ACTIVE_BRANCH_KEY, activeBranchId.value)
  }

  /**
   * Pide al servidor los negocios del usuario actual y decide la
   * selección activa. Este es el punto donde una membresía guardada que
   * ya no existe (revocada, o de una sesión vieja) se descarta: si
   * `storedTenantId` no aparece en la lista que acaba de llegar del
   * servidor, no se usa — se recalcula desde cero con el mismo criterio
   * de "una sola opción se elige sola" que las sucursales.
   */
  async function loadMemberships(): Promise<void> {
    if (!user.value) return

    memberships.value = await listMyMemberships(user.value.id)

    const storedTenantId = readStorage(ACTIVE_TENANT_KEY)
    const validStoredTenant = memberships.value.find((m) => m.tenantId === storedTenantId)

    if (validStoredTenant) {
      activeTenantId.value = validStoredTenant.tenantId
    } else if (memberships.value.length === 1) {
      activeTenantId.value = memberships.value[0].tenantId
    } else {
      activeTenantId.value = null
    }
    writeStorage(ACTIVE_TENANT_KEY, activeTenantId.value)

    resolveActiveBranch()
  }

  function selectTenant(tenantId: string): void {
    activeTenantId.value = tenantId
    writeStorage(ACTIVE_TENANT_KEY, tenantId)
    // Cambiar de negocio invalida la sucursal elegida anteriormente —
    // podría ni existir en el nuevo tenant.
    activeBranchId.value = null
    writeStorage(ACTIVE_BRANCH_KEY, null)
    resolveActiveBranch()
  }

  function selectBranch(branchId: string): void {
    activeBranchId.value = branchId
    writeStorage(ACTIVE_BRANCH_KEY, branchId)
  }

  async function login(email: string, password: string): Promise<void> {
    status.value = 'loading'
    errorMessage.value = null
    try {
      user.value = await signInRequest(email, password)
      profile.value = await getProfile(user.value.id)
      await loadMemberships()
      status.value = 'ready'
    } catch (e) {
      status.value = 'error'
      errorMessage.value = e instanceof Error ? e.message : 'No se pudo iniciar sesión.'
      throw e
    }
  }

  async function logout(): Promise<void> {
    await signOutRequest()
    reset()
    status.value = 'idle'
  }

  // Evita repetir el arranque si algo dispara ensureInitialized() más de
  // una vez (p. ej. el guard del router en una navegación rápida): la
  // segunda llamada espera la promesa de la primera en vez de repetir el
  // trabajo.
  let initPromise: Promise<void> | null = null

  /** Se llama una vez al arrancar la app: intenta restaurar una sesión ya existente. */
  function ensureInitialized(): Promise<void> {
    if (!initPromise) {
      initPromise = (async () => {
        status.value = 'loading'
        const existingUser = await getCurrentUser()
        if (existingUser) {
          user.value = existingUser
          profile.value = await getProfile(existingUser.id)
          await loadMemberships()
        }
        status.value = 'ready'
      })()
    }
    return initPromise
  }

  return {
    user,
    profile,
    memberships,
    activeTenantId,
    activeBranchId,
    status,
    errorMessage,
    isAuthenticated,
    activeMembership,
    role,
    activeBranches,
    activeBranch,
    needsBusinessSelection,
    login,
    logout,
    loadMemberships,
    selectTenant,
    selectBranch,
    ensureInitialized,
  }
})
