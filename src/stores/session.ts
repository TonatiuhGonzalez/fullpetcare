// Estado de "quién soy, en qué negocio y en qué sucursal estoy trabajando
// ahora". Es el único store que sabe de sesión — pages y componentes lo
// consultan, nunca hablan con services/auth.ts directo (CLAUDE.md §4).
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import {
  getCurrentUser,
  onSessionLost,
  signIn as signInRequest,
  signOut as signOutRequest,
  type AuthUser,
} from '@/services/auth'
import { getProfile, type MyProfile } from '@/services/profiles'
import { listMyMemberships, type MembershipSummary } from '@/services/memberships'
import {
  cancelMyTenant,
  listMyTenantNotices,
  type TenantNotice,
} from '@/services/tenantAccess'
import { noticeRestrictsAccess } from '@/lib/tenantNotices'
import { listForTenant } from '@/services/permissions'
import { isPlatformAdmin as fetchIsPlatformAdmin } from '@/services/platform'
import { hasPermission, type PermissionModule, type RolePermissionRow } from '@/lib/permissions'

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
  // Avisos de acceso de los negocios de la persona: por vencer, en gracia, en
  // solo lectura o dados de baja (estos últimos la base los oculta de
  // `memberships`, así que aquí es la única pista de que existen).
  const tenantNotices = ref<TenantNotice[]>([])
  // Reglas de permisos del tenant ACTIVO únicamente (fase 9) — se
  // recarga cada vez que cambia activeTenantId (loadMemberships,
  // selectTenant). No vive dentro de MembershipSummary porque no es
  // información de "mi membresía": son las mismas filas para cualquier
  // colega con el mismo rol en ese negocio.
  const permissions = ref<RolePermissionRow[]>([])
  // true si la persona es superadmin de plataforma (fase 10). Vive aparte de
  // memberships a propósito: un superadmin no pertenece a ningún negocio
  // (PLAN.md D14). Solo gatea la INTERFAZ (/superadmin); la autoridad real
  // son las RPC, que revalidan en la base.
  const isPlatformAdmin = ref(false)
  const activeTenantId = ref<string | null>(null)
  const activeBranchId = ref<string | null>(null)
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const errorMessage = ref<string | null>(null)

  const isAuthenticated = computed(() => user.value !== null)

  /** Avisos que limitan el acceso (solo lectura o baja): los que abren el diálogo del login. */
  const restrictingNotices = computed(() =>
    tenantNotices.value.filter((n) => noticeRestrictsAccess(n.notice)),
  )

  /**
   * true si la persona ya inició sesión pero TODOS sus negocios están dados de
   * baja: no hay nada que mostrarle salvo el aviso. (Un negocio en solo
   * lectura SÍ se puede abrir; un superadmin nunca cae aquí.)
   */
  const isBlockedOnly = computed(
    () =>
      isAuthenticated.value &&
      !isPlatformAdmin.value &&
      memberships.value.length === 0 &&
      tenantNotices.value.some((n) => n.notice === 'blocked'),
  )

  /**
   * true mientras la persona use una contraseña temporal (dueño o superadmin
   * recién dado de alta, o dueño con contraseña restablecida). El router la
   * manda a /cambiar-contrasena y no la deja salir de ahí; la base además le
   * niega todos los datos de negocio (app.has_pending_password_change()).
   */
  const mustChangePassword = computed(() => profile.value?.mustChangePassword === true)

  const activeMembership = computed<MembershipSummary | null>(
    () => memberships.value.find((m) => m.tenantId === activeTenantId.value) ?? null,
  )
  const role = computed(() => activeMembership.value?.role ?? null)
  /** Aviso del negocio activo (por vencer, gracia o solo lectura), para el banner. */
  const activeNotice = computed<TenantNotice | null>(
    () => tenantNotices.value.find((n) => n.tenantId === activeTenantId.value) ?? null,
  )
  const activeBranches = computed(() => activeMembership.value?.branches ?? [])
  const activeBranch = computed(
    () => activeBranches.value.find((b) => b.id === activeBranchId.value) ?? null,
  )

  /**
   * true si ya hay sesión pero todavía falta elegir negocio y/o sucursal.
   * Un superadmin de plataforma NUNCA lo necesita: no tiene negocio que
   * elegir, y sin esta excepción se quedaría atrapado en una pantalla de
   * selección vacía.
   */
  const needsBusinessSelection = computed(
    () =>
      isAuthenticated.value &&
      !isPlatformAdmin.value &&
      (!activeTenantId.value || !activeBranchId.value),
  )

  /**
   * true si el rol activo puede VER un módulo (p. ej. "employees", la
   * pestaña de empleados de la fase 9). Solo gatea la INTERFAZ — la
   * autoridad real es la política RLS + app.has_permission() en
   * Postgres; si esto y el backend algún día no coincidieran, el peor
   * caso es un botón visible que el backend rechaza, nunca lo contrario.
   */
  function canView(module: PermissionModule): boolean {
    return hasPermission(role.value, permissions.value, module, 'view')
  }

  /** Mismo criterio que canView(), para la acción de EDITAR. */
  function canEdit(module: PermissionModule): boolean {
    return hasPermission(role.value, permissions.value, module, 'edit')
  }

  async function loadPermissionsForActiveTenant(): Promise<void> {
    permissions.value = activeTenantId.value ? await listForTenant(activeTenantId.value) : []
  }

  function reset(): void {
    user.value = null
    profile.value = null
    memberships.value = []
    tenantNotices.value = []
    permissions.value = []
    isPlatformAdmin.value = false
    activeTenantId.value = null
    activeBranchId.value = null
    errorMessage.value = null
    writeStorage(ACTIVE_TENANT_KEY, null)
    writeStorage(ACTIVE_BRANCH_KEY, null)
  }

  /**
   * Recalcula qué sucursal queda activa: si lo guardado en localStorage
   * sigue siendo una sucursal válida de la membresía activa, se conserva;
   * si no, y hay una sola opción posible, se elige sola; si hay varias:
   *
   * - El dueño (`owner`) SIEMPRE ve todas las sucursales del tenant
   *   (CLAUDE.md §6.1), así que para él "varias sucursales" es el caso
   *   normal, no una excepción — obligarlo a elegir una en
   *   SelectBusinessPage en cada login era el problema que se pidió
   *   quitar. Mientras no exista una pantalla de administración donde
   *   marcar una sucursal como "principal", se usa la primera en orden
   *   alfabético (mismo orden que `listAllBranches` en
   *   services/memberships.ts) como default. El dueño puede cambiarla
   *   después con el select de AppLayout.vue.
   * - Para receptionist/groomer/vet, la lista de sucursales la arma un
   *   admin a mano (membership_branches) — si alguna vez tienen más de
   *   una, sigue sin "adivinarse": se deja sin elegir y se pregunta en
   *   SelectBusinessPage, como antes.
   */
  function resolveActiveBranch(): void {
    const branches = activeMembership.value?.branches ?? []
    const storedBranchId = readStorage(ACTIVE_BRANCH_KEY)
    const validStoredBranch = branches.find((b) => b.id === storedBranchId)

    if (validStoredBranch) {
      activeBranchId.value = validStoredBranch.id
    } else if (branches.length === 1) {
      activeBranchId.value = branches[0].id
    } else if (activeMembership.value?.role === 'owner' && branches.length > 1) {
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
    tenantNotices.value = await listMyTenantNotices()

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
    await loadPermissionsForActiveTenant()
  }

  async function selectTenant(tenantId: string): Promise<void> {
    activeTenantId.value = tenantId
    writeStorage(ACTIVE_TENANT_KEY, tenantId)
    // Cambiar de negocio invalida la sucursal elegida anteriormente —
    // podría ni existir en el nuevo tenant.
    activeBranchId.value = null
    writeStorage(ACTIVE_BRANCH_KEY, null)
    resolveActiveBranch()
    await loadPermissionsForActiveTenant()
  }

  function selectBranch(branchId: string): void {
    activeBranchId.value = branchId
    writeStorage(ACTIVE_BRANCH_KEY, branchId)
  }

  /**
   * Carga todo lo que depende de "quién soy" para un usuario ya autenticado.
   * Si debe cambiar su contraseña temporal, se DETIENE tras leer el profile:
   * la base ya le niega su lista de negocios y su rol de plataforma, así que
   * pedirlos solo daría vacíos que la UI confundiría con "sin negocio". Se
   * vuelve a llamar al terminar el cambio (completePasswordChange).
   */
  async function loadAccountContext(userId: string): Promise<void> {
    profile.value = await getProfile(userId)
    if (profile.value?.mustChangePassword) return
    isPlatformAdmin.value = await fetchIsPlatformAdmin(userId)
    await loadMemberships()
  }

  /** Se llama justo después de cambiar la contraseña temporal: ahora sí carga negocios y roles. */
  async function completePasswordChange(): Promise<void> {
    if (!user.value) return
    await loadAccountContext(user.value.id)
  }

  async function login(email: string, password: string): Promise<void> {
    status.value = 'loading'
    errorMessage.value = null
    sessionExpired.value = false
    try {
      user.value = await signInRequest(email, password)
      await loadAccountContext(user.value.id)
      status.value = 'ready'
    } catch (e) {
      status.value = 'error'
      errorMessage.value = e instanceof Error ? e.message : 'No se pudo iniciar sesión.'
      throw e
    }
  }

  /**
   * El dueño da de baja el negocio activo y la sesión se cierra: desde ese
   * momento la base ya no le muestra nada de ese negocio. Solo el superadmin
   * puede reactivarlo.
   */
  async function cancelActiveTenant(comment: string | null): Promise<void> {
    if (!activeTenantId.value) return
    await cancelMyTenant(activeTenantId.value, comment)
    await logout()
  }

  async function logout(): Promise<void> {
    // "finally": aunque el servidor no responda (sin red), la sesión
    // LOCAL se limpia siempre — antes, si signOut() lanzaba, reset()
    // nunca corría y el usuario quedaba "dentro" tras pulsar Salir. El
    // error se sigue propagando para que la UI pueda avisar.
    isLoggingOut = true
    try {
      await signOutRequest()
    } finally {
      isLoggingOut = false
      reset()
      status.value = 'idle'
    }
  }

  /**
   * true si la sesión se perdió SIN que el usuario pulsara "Salir"
   * (token vencido, revocado, timebox, cierre en otra pestaña). Las
   * pantallas lo usan para mandar a /login con un aviso claro.
   */
  const sessionExpired = ref(false)
  let stopWatchingSession: (() => void) | null = null
  // signOut() emite SIGNED_OUT ANTES de que reset() corra; sin esta
  // bandera, un "Salir" normal se confundiría con una sesión vencida.
  let isLoggingOut = false

  function watchSessionLoss(): void {
    if (stopWatchingSession) return
    stopWatchingSession = onSessionLost(() => {
      // logout() también dispara SIGNED_OUT; ahí user ya es null tras
      // reset(), o está por serlo — solo interesa la pérdida inesperada
      // de una sesión que la app creía viva.
      if (isLoggingOut || user.value === null) return
      reset()
      status.value = 'idle'
      sessionExpired.value = true
    })
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
        watchSessionLoss()
        status.value = 'loading'
        const existingUser = await getCurrentUser()
        if (existingUser) {
          user.value = existingUser
          await loadAccountContext(existingUser.id)
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
    tenantNotices,
    restrictingNotices,
    activeNotice,
    isBlockedOnly,
    cancelActiveTenant,
    permissions,
    isPlatformAdmin,
    activeTenantId,
    activeBranchId,
    status,
    errorMessage,
    isAuthenticated,
    mustChangePassword,
    sessionExpired,
    activeMembership,
    role,
    activeBranches,
    activeBranch,
    needsBusinessSelection,
    canView,
    canEdit,
    login,
    logout,
    loadMemberships,
    completePasswordChange,
    selectTenant,
    selectBranch,
    ensureInitialized,
  }
})
