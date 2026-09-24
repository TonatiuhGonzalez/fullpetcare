// Lógica pura del panel de superadmin (fase 10): etiquetas, filtro de la
// lista y traducción de la bitácora a frases. Sin red y sin Supabase — por
// eso vive en lib/ y por eso tiene tests (CLAUDE.md §4 y §9).
//
// Los tipos se declaran aquí a propósito, sin importar los de
// services/platform.ts: lib/ no importa nada del proyecto salvo otros lib/.
// Son compatibles por estructura, así que la pantalla pasa los objetos del
// servicio directo.
import { formatDate, formatTime } from './datetime'

export type TenantStatus = 'active' | 'suspended' | 'closed'

// El panel no tiene una sucursal cuya zona horaria usar (CLAUDE.md §8.3
// pide mostrar en la zona de la sucursal), así que las fechas de
// plataforma se muestran en hora de México Centro — la misma que usa el
// alta de una empresa nueva (platform_create_tenant).
export const PLATFORM_TIMEZONE = 'America/Mexico_City'

const STATUS_LABELS: Record<TenantStatus, string> = {
  active: 'Activa',
  suspended: 'Suspendida',
  closed: 'De baja',
}

const STATUS_COLORS: Record<TenantStatus, string> = {
  active: 'success',
  suspended: 'warning',
  closed: 'error',
}

export function tenantStatusLabel(status: TenantStatus): string {
  return STATUS_LABELS[status]
}

/** Color de Vuetify para el chip de estado. */
export function tenantStatusColor(status: TenantStatus): string {
  return STATUS_COLORS[status]
}

/** "15 de julio de 2026", en hora de México Centro. */
export function formatPlatformDate(isoInstant: string): string {
  return formatDate(isoInstant, PLATFORM_TIMEZONE)
}

/** "15 de julio de 2026, 14:30", en hora de México Centro. */
export function formatPlatformDateTime(isoInstant: string): string {
  return `${formatPlatformDate(isoInstant)}, ${formatTime(isoInstant, PLATFORM_TIMEZONE)}`
}

/** Vigencia del plan: `null` significa indefinida (todas las empresas hoy). */
export function formatPlanExpiry(expiresAt: string | null): string {
  return expiresAt === null ? 'Indefinida' : formatPlatformDate(expiresAt)
}

// -----------------------------------------------------------------------------
// Filtro de la lista de empresas
// -----------------------------------------------------------------------------

interface FilterableTenant {
  name: string
  ownerName: string | null
  status: TenantStatus
}

/**
 * Minúsculas y sin acentos: quien busca "estetica" debe encontrar
 * "Estética Canina". `normalize('NFD')` separa cada letra acentuada en
 * letra + marca de acento, y la expresión regular quita solo las marcas.
 */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Filtra la lista por texto (nombre de la empresa o del dueño) y por estado.
 * Texto vacío = no filtra por texto; `status` null = todos los estados.
 */
export function filterTenants<T extends FilterableTenant>(
  tenants: T[],
  query: string,
  status: TenantStatus | null,
): T[] {
  const needle = normalize(query)
  return tenants.filter((tenant) => {
    if (status !== null && tenant.status !== status) return false
    if (needle === '') return true
    return (
      normalize(tenant.name).includes(needle) ||
      (tenant.ownerName !== null && normalize(tenant.ownerName).includes(needle))
    )
  })
}

// -----------------------------------------------------------------------------
// Bitácora: de filas de auditoría a frases
// -----------------------------------------------------------------------------

interface AuditEntryLike {
  action: 'INSERT' | 'UPDATE' | 'DELETE'
  tableName: string
  event: string | null
  oldData: Record<string, unknown> | null
  newData: Record<string, unknown> | null
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function asStatus(value: unknown): TenantStatus | null {
  return value === 'active' || value === 'suspended' || value === 'closed' ? value : null
}

/**
 * Describe en español qué hizo una entrada de la bitácora de plataforma.
 * Una fila UPDATE puede traer varios cambios a la vez (estado y notas), y
 * cada uno se lista por separado.
 *
 * Por qué se calcula aquí y no se guarda ya escrito: la bitácora guarda
 * datos (antes/después) porque son la evidencia; la redacción puede
 * mejorar mañana sin tocar lo ya registrado. Nunca menciona contraseñas:
 * ni siquiera existen en estos datos (platform_log_event no las recibe).
 */
export function describeAuditEntry(entry: AuditEntryLike): string[] {
  if (entry.event === 'password_reset') return ['Restableció la contraseña del dueño.']
  if (entry.event === 'password_reset_failed') {
    return ['Intentó restablecer la contraseña del dueño, pero no se pudo.']
  }
  if (entry.event !== null) return [`Evento: ${entry.event}.`]

  if (entry.tableName === 'tenant_platform_info') {
    if (entry.action === 'INSERT') return ['Dio de alta la empresa.']
    if (entry.action === 'UPDATE') return describeInfoUpdate(entry.oldData, entry.newData)
  }

  if (entry.tableName === 'platform_admins') {
    if (entry.action === 'INSERT') return ['Agregó a un superadmin.']
    if (entry.action === 'UPDATE') {
      return entry.newData?.deleted_at ? ['Quitó a un superadmin.'] : ['Reactivó a un superadmin.']
    }
  }

  return ['Realizó un cambio.']
}

function describeInfoUpdate(
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null,
): string[] {
  const before = oldData ?? {}
  const after = newData ?? {}
  const changes: string[] = []

  const oldStatus = asStatus(before.status)
  const newStatus = asStatus(after.status)
  if (newStatus !== null && newStatus !== oldStatus) {
    const reason = asText(after.status_reason)
    const from = oldStatus ? ` (antes: ${tenantStatusLabel(oldStatus)})` : ''
    changes.push(
      `Cambió el estado a ${tenantStatusLabel(newStatus)}${from}${reason ? `. Motivo: ${reason}` : ''}.`,
    )
  }

  // Mismo estado pero otro motivo (suspendida por X → suspendida por Y): sin
  // esto el cambio no se vería en la bitácora.
  const newReason = asText(after.status_reason)
  if (newStatus !== null && newStatus === oldStatus && asText(before.status_reason) !== newReason) {
    changes.push(`Cambió el motivo${newReason ? `: ${newReason}` : ''}.`)
  }

  if (asText(before.internal_notes) !== asText(after.internal_notes)) {
    changes.push('Actualizó las notas internas.')
  }
  if (before.plan !== after.plan) changes.push('Cambió el plan.')
  if (before.plan_expires_at !== after.plan_expires_at) changes.push('Cambió la vigencia del plan.')

  return changes.length > 0 ? changes : ['Actualizó los datos de la empresa.']
}
