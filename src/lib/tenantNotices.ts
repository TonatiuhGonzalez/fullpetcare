// Textos de los avisos de acceso de un negocio (tarea #1905): por vencer,
// periodo de gracia, solo lectura y baja. Pura: recibe el aviso que devolvió
// la base y la zona horaria del negocio, y devuelve el texto en español.
// Vive en lib/ para poder probar cada frase sin pantalla ni red.
import { formatDate } from './datetime'

export type TenantNoticeKind = 'expiring' | 'grace' | 'read_only' | 'blocked'

export interface TenantNoticeInput {
  notice: TenantNoticeKind
  /** Motivo público del catálogo; null si el aviso es solo por vigencia. */
  publicReason: string | null
  planExpiresAt: string | null
  graceEndsAt: string | null
}

/** Color de v-alert según la gravedad. */
export function noticeSeverity(kind: TenantNoticeKind): 'info' | 'warning' | 'error' {
  if (kind === 'expiring') return 'info'
  if (kind === 'blocked') return 'error'
  return 'warning'
}

/** true si el aviso limita lo que la persona puede hacer (a diferencia de los preventivos). */
export function noticeRestrictsAccess(kind: TenantNoticeKind): boolean {
  return kind === 'read_only' || kind === 'blocked'
}

/** Texto del banner dentro de la aplicación. */
export function noticeText(n: TenantNoticeInput, timezone: string): string {
  const expires = n.planExpiresAt ? formatDate(n.planExpiresAt, timezone) : null
  const graceEnds = n.graceEndsAt ? formatDate(n.graceEndsAt, timezone) : null
  const reason = n.publicReason ? ` (${n.publicReason})` : ''

  switch (n.notice) {
    case 'expiring':
      return `Tu plan vence el ${expires}. Regulariza tu pago para evitar interrupciones.`
    case 'grace':
      return `Tu plan venció el ${expires}. Tienes hasta el ${graceEnds} para regularizar tu pago; después tu cuenta pasará a modo solo lectura.`
    case 'read_only':
      return `Tu negocio está en modo solo lectura${reason}. Puedes consultar tu información, pero no hacer cambios.`
    case 'blocked':
      return `Este negocio fue dado de baja${reason}.`
  }
}
