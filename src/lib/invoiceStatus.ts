// Estado de la factura de una venta, para la pantalla (fase 11, tarea 11.19).
// Una venta puede tener varias solicitudes a lo largo del tiempo (un intento
// fallido que sigue 'pending', una factura cancelada y su sustituta): la
// pantalla muestra UNA, la vigente. Función pura.

export type InvoiceStatus = 'pending' | 'stamping' | 'stamped' | 'cancelled'

export interface InvoiceSummary {
  id: string
  status: string
  created_at: string
}

// Más importante primero: una timbrada manda sobre todo lo demás.
const PRIORITY: InvoiceStatus[] = ['stamped', 'stamping', 'pending', 'cancelled']

/**
 * La solicitud que se muestra: la timbrada o en proceso si existe (solo puede
 * haber una viva por venta, lo garantiza la base); si no, la pendiente más
 * reciente (con su último error, para reintentar); si no, la cancelada más
 * reciente. null si la venta nunca se ha querido facturar.
 */
export function pickCurrentInvoice<T extends InvoiceSummary>(rows: T[]): T | null {
  for (const status of PRIORITY) {
    const matches = rows
      .filter((row) => row.status === status)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
    if (matches.length > 0) return matches[0]
  }
  return null
}

export const INVOICE_STATUS_LABELS: Record<
  InvoiceStatus,
  { title: string; color: string }
> = {
  pending: { title: 'Por facturar', color: 'warning' },
  stamping: { title: 'Facturando…', color: 'info' },
  stamped: { title: 'Facturada', color: 'success' },
  cancelled: { title: 'Cancelada', color: 'error' },
}

// Motivos de cancelación del SAT que se ofrecen hoy. El 01 exige indicar la
// factura que sustituye y el 04 es solo de la factura global: llegan después.
export const CANCEL_MOTIVES = [
  { code: '02', title: 'Se emitió con errores, sin sustituirla' },
  { code: '03', title: 'La operación no se llevó a cabo' },
] as const

// Formas de pago del SAT que maneja el proyecto (CLAUDE.md §8.4).
export const PAYMENT_FORMS = [
  { code: '01', title: 'Efectivo' },
  { code: '03', title: 'Transferencia electrónica' },
  { code: '04', title: 'Tarjeta de crédito' },
  { code: '28', title: 'Tarjeta de débito' },
] as const

/** Texto del motivo de cancelación del SAT a partir de su código (catálogo completo). */
export function cancelMotiveLabel(code: string | null): string {
  const labels: Record<string, string> = {
    '01': 'Se emitió con errores y se sustituyó con otra factura',
    '02': 'Se emitió con errores, sin sustituirla',
    '03': 'La operación no se llevó a cabo',
    '04': 'Operación nominativa en una factura global',
  }
  return (code && labels[code]) || 'Motivo no registrado'
}
