// Acceso a datos del panel de superadmin (fase 10, CLAUDE.md §6/§7 y
// PLAN.md D14). Todo lo que la pantalla /superadmin lee o escribe pasa por
// aquí; ningún componente habla con supabase directo (regla de capas, §4).
//
// Dos caminos, según lo que se necesite:
//   - RPC `platform_*` (llamadas con la sesión del superadmin): listar,
//     métricas, estado, notas, superadmins. Revalidan `is_platform_admin()`
//     en la base — lo que se oculte en la interfaz es solo comodidad.
//   - Edge Function `platform-admin`: lo que exige la llave service_role
//     (crear el usuario del dueño, cambiar contraseñas). Devuelve la
//     contraseña temporal, que la UI muestra UNA sola vez: este archivo no
//     la guarda ni la registra.
import { supabase } from './supabase'
import type { Database } from '@/types/database'

export type TenantStatus = Database['public']['Enums']['tenant_status']

// El generador de tipos marca como `string` a secas las columnas que en
// Postgres pueden ser NULL (mismo motivo que explica employees.ts). Aquí se
// declaran los tipos de dominio a mano, con `| null` donde de verdad puede
// serlo, y las funciones de abajo convierten de una forma a la otra.

export interface PlatformTenant {
  id: string
  name: string
  /** Fecha de alta de la empresa (ISO). */
  createdAt: string
  plan: string
  /** null = vigencia indefinida (todas las empresas hoy). */
  planExpiresAt: string | null
  status: TenantStatus
  statusReason: string | null
  internalNotes: string | null
  ownerUserId: string | null
  ownerName: string | null
  ownerEmail: string | null
  ownerPhone: string | null
}

export interface TenantMetrics {
  branches: number
  activeEmployees: number
  customers: number
  pets: number
  appointmentsThisMonth: number
  /** Último inicio de sesión de cualquier miembro activo; null si nadie ha entrado. */
  lastAccessAt: string | null
}

export interface PlatformAdminUser {
  userId: string
  email: string
  fullName: string | null
  createdAt: string
}

export interface PlatformAuditEntry {
  id: string
  action: 'INSERT' | 'UPDATE' | 'DELETE'
  tableName: string
  /** Solo en eventos que no son un cambio de fila (p. ej. `password_reset`). */
  event: string | null
  actorUserId: string | null
  changedAt: string
  oldData: Record<string, unknown> | null
  newData: Record<string, unknown> | null
}

export interface NewTenantInput {
  tenantName: string
  branchName: string
  ownerFullName: string
  ownerEmail: string
  ownerPhone: string | null
}

export interface NewTenantResult {
  tenantId: string
  ownerUserId: string
  /** Se muestra una sola vez al superadmin; nunca se vuelve a poder leer. */
  temporaryPassword: string
}

export interface ResetPasswordResult {
  ownerEmail: string
  temporaryPassword: string
  /** false si la contraseña cambió pero no se pudieron cerrar las sesiones abiertas. */
  sessionsRevoked: boolean
}

export interface NewAdminResult {
  userId: string
  temporaryPassword: string
}

// -----------------------------------------------------------------------------
// Errores
// -----------------------------------------------------------------------------

const GENERIC_ERROR = 'No se pudo completar la operación. Revisa tu conexión.'
const UNAVAILABLE_ERROR =
  'El servicio de administración no está disponible en este momento. Intenta más tarde.'

/**
 * Los errores de las RPC `platform_*` que la persona sí puede corregir
 * ("Indica el motivo.", "No se puede quitar al único superadmin.") los
 * escribimos nosotros con `raise exception` y ya vienen en español (códigos
 * 23514, 23503, 23505, 42501, P0002). Un error técnico de Postgres o
 * PostgREST ("permission denied for function...", "row-level security")
 * está en inglés y no se muestra (CLAUDE.md §5.4).
 */
function friendlyRpcMessage(error: { code?: string; message: string }): string {
  const isOurs = ['23514', '23503', '23505', '42501', 'P0002'].includes(error.code ?? '')
  const isTechnical = /permission denied|row-level security/i.test(error.message)
  return isOurs && !isTechnical ? error.message : GENERIC_ERROR
}

/**
 * supabase-js no expone el JSON de una respuesta de error de una Edge
 * Function: deja el Response crudo en `.context`. Se intenta leer el
 * `message` que puso `platform-admin` (ya en español). 404/503/504 no los
 * manda nuestra función sino el gateway (función apagada o sin desplegar) y
 * su cuerpo es texto técnico: se reemplazan.
 */
async function functionErrorMessage(error: unknown): Promise<string> {
  if (
    error &&
    typeof error === 'object' &&
    'context' in error &&
    (error as { context: unknown }).context instanceof Response
  ) {
    const response = (error as { context: Response }).context
    if ([404, 503, 504].includes(response.status) && !(await hasJsonMessage(response))) {
      return UNAVAILABLE_ERROR
    }
    try {
      const body = await response.clone().json()
      if (typeof body?.message === 'string') return body.message
    } catch {
      // El cuerpo no era JSON — se usa el mensaje genérico de abajo.
    }
  }
  return GENERIC_ERROR
}

// La propia función responde 404 cuando una empresa no tiene dueño activo,
// con un `message` útil; el 404 del gateway no lo trae. Se distingue por el
// cuerpo.
async function hasJsonMessage(response: Response): Promise<boolean> {
  try {
    const body = await response.clone().json()
    return typeof body?.message === 'string'
  } catch {
    return false
  }
}

async function invokePlatformAdmin<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('platform-admin', { body })
  if (error || !data) throw new Error(await functionErrorMessage(error))
  return data
}

// -----------------------------------------------------------------------------
// ¿Soy superadmin?
// -----------------------------------------------------------------------------

/**
 * true si `userId` es un superadmin activo. Lo pregunta useSessionStore al
 * iniciar sesión para decidir si se muestra /superadmin.
 *
 * La política de SELECT de `platform_admins` solo deja ver filas a un
 * superadmin: para cualquier otro usuario la consulta regresa vacía (no da
 * error), así que "no hay fila" y "no soy admin" son lo mismo. El
 * `deleted_at is null` es el mismo filtro que aplica `app.is_platform_admin()`
 * (esta tabla no lo pone en la política, ver la migración).
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('platform_admins')
    .select('id')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw error
  return data !== null
}

// -----------------------------------------------------------------------------
// Empresas
// -----------------------------------------------------------------------------

export async function listTenants(): Promise<PlatformTenant[]> {
  const { data, error } = await supabase.rpc('platform_list_tenants')
  if (error) throw new Error(friendlyRpcMessage(error))

  return data.map((row) => ({
    id: row.tenant_id,
    name: row.name,
    createdAt: row.created_at,
    plan: row.plan,
    planExpiresAt: (row.plan_expires_at as string | null) ?? null,
    status: row.status,
    statusReason: (row.status_reason as string | null) ?? null,
    internalNotes: (row.internal_notes as string | null) ?? null,
    ownerUserId: (row.owner_user_id as string | null) ?? null,
    ownerName: (row.owner_name as string | null) ?? null,
    ownerEmail: (row.owner_email as string | null) ?? null,
    ownerPhone: (row.owner_phone as string | null) ?? null,
  }))
}

export async function getTenantMetrics(tenantId: string): Promise<TenantMetrics> {
  const { data, error } = await supabase.rpc('platform_tenant_metrics', { p_tenant_id: tenantId })
  if (error) throw new Error(friendlyRpcMessage(error))

  // La función devuelve una tabla de una fila. PostgREST entrega los
  // `bigint` como número (caben de sobra: son conteos).
  const row = data[0]
  return {
    branches: Number(row.branches_count),
    activeEmployees: Number(row.active_employees_count),
    customers: Number(row.customers_count),
    pets: Number(row.pets_count),
    appointmentsThisMonth: Number(row.appointments_this_month_count),
    lastAccessAt: (row.last_access_at as string | null) ?? null,
  }
}

/**
 * Suspende, da de baja o reactiva un negocio. El motivo es obligatorio salvo
 * al reactivar (lo valida la base). Es solo una etiqueta: no bloquea el
 * acceso de los usuarios del negocio (decisión de la fase 10).
 */
export async function setTenantStatus(
  tenantId: string,
  status: TenantStatus,
  reason: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('platform_set_tenant_status', {
    p_tenant_id: tenantId,
    p_status: status,
    // El tipo generado no admite null aunque Postgres sí (ver arriba).
    p_reason: reason as string,
  })
  if (error) throw new Error(friendlyRpcMessage(error))
}

export async function updateTenantNotes(tenantId: string, notes: string): Promise<void> {
  const { error } = await supabase.rpc('platform_update_notes', {
    p_tenant_id: tenantId,
    p_notes: notes,
  })
  if (error) throw new Error(friendlyRpcMessage(error))
}

/** Bitácora de plataforma de UNA empresa, la más reciente primero. */
export async function listAuditLog(tenantId: string, limit = 100): Promise<PlatformAuditEntry[]> {
  const { data, error } = await supabase
    .from('platform_audit_log')
    .select('id, action, table_name, event, actor_user_id, changed_at, old_data, new_data')
    .eq('tenant_id', tenantId)
    .order('changed_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(friendlyRpcMessage(error))

  return data.map((row) => ({
    id: row.id,
    action: row.action,
    tableName: row.table_name,
    event: row.event,
    actorUserId: row.actor_user_id,
    changedAt: row.changed_at,
    oldData: (row.old_data as Record<string, unknown> | null) ?? null,
    newData: (row.new_data as Record<string, unknown> | null) ?? null,
  }))
}

// -----------------------------------------------------------------------------
// Edge Function platform-admin
// -----------------------------------------------------------------------------

/** Da de alta una empresa con su sucursal y su dueño. Todo o nada. */
export function createTenant(input: NewTenantInput): Promise<NewTenantResult> {
  return invokePlatformAdmin<NewTenantResult>({ action: 'create_tenant', ...input })
}

/** Genera una contraseña temporal nueva para el dueño de la empresa y cierra sus sesiones. */
export function resetOwnerPassword(tenantId: string): Promise<ResetPasswordResult> {
  return invokePlatformAdmin<ResetPasswordResult>({ action: 'reset_password', tenantId })
}

// -----------------------------------------------------------------------------
// Superadmins
// -----------------------------------------------------------------------------

export async function listAdmins(): Promise<PlatformAdminUser[]> {
  const { data, error } = await supabase.rpc('platform_list_admins')
  if (error) throw new Error(friendlyRpcMessage(error))

  return data.map((row) => ({
    userId: row.user_id,
    email: row.email,
    fullName: (row.full_name as string | null) ?? null,
    createdAt: row.created_at,
  }))
}

export function addAdmin(input: { fullName: string; email: string }): Promise<NewAdminResult> {
  return invokePlatformAdmin<NewAdminResult>({ action: 'add_admin', ...input })
}

/** Quita a un superadmin. La base rechaza quitar al último. */
export async function removeAdmin(userId: string): Promise<void> {
  const { error } = await supabase.rpc('platform_remove_admin', { p_user_id: userId })
  if (error) throw new Error(friendlyRpcMessage(error))
}
