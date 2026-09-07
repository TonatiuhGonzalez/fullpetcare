// Acceso a datos de invoice_requests: lo que el SAT pediría para facturar
// una venta (CLAUDE.md §6.5, §8.4), aunque v1 no factura de verdad — ver
// el comentario de cabecera de la migración invoice_requests.sql. Único
// archivo que habla con Supabase para esto (CLAUDE.md §4).
import { supabase } from './supabase'
import type { NewPayment } from './checkout'
import type { Database } from '@/types/database'

export type InvoiceRequest = Database['public']['Tables']['invoice_requests']['Row']

export interface InvoiceCustomerData {
  rfc: string
  legalName: string
  taxRegimeCode: string
  cfdiUse: string
  postalCode: string
}

/**
 * c_FormaPago del SAT: 01 efectivo, 03 transferencia, 04 tarjeta (v1 no
 * distingue crédito/débito, así que "card" mapea al código de crédito),
 * 06 cuando la venta se cubrió con MÁS DE UNA forma de pago (CLAUDE.md
 * §8.4 lista los códigos que sí distingue el proyecto; "06" es del mismo
 * catálogo del SAT, para el caso real de un pago mixto efectivo+tarjeta).
 */
function paymentFormCode(payments: NewPayment[]): string {
  const distinctMethods = new Set(payments.map((p) => p.method))
  if (distinctMethods.size > 1) return '06'

  const codeByMethod: Record<string, string> = {
    cash: '01',
    transfer_spei: '03',
    card: '04',
    openpay: '04',
  }
  return codeByMethod[payments[0]?.method ?? 'cash'] ?? '01'
}

/**
 * Crea la solicitud de factura de una venta ya cobrada, con los datos
 * fiscales del cliente capturados al momento de cobrar (tarea 5.16) —
 * status siempre 'pending': v1 no tiene ningún proceso que lo cambie
 * (ver el comentario de la migración).
 */
export async function create(
  tenantId: string,
  saleId: string,
  customer: InvoiceCustomerData,
  payments: NewPayment[],
): Promise<InvoiceRequest> {
  const { data, error } = await supabase
    .from('invoice_requests')
    .insert({
      tenant_id: tenantId,
      sale_id: saleId,
      rfc: customer.rfc,
      legal_name: customer.legalName,
      tax_regime_code: customer.taxRegimeCode,
      cfdi_use: customer.cfdiUse,
      postal_code: customer.postalCode,
      payment_form_code: paymentFormCode(payments),
      // PUE (Pago en Una sola Exhibición): v1 siempre cobra el total de
      // una vez, nunca a crédito ni en parcialidades (CLAUDE.md §1, fuera
      // de alcance).
      payment_method_code: 'PUE',
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getBySale(saleId: string): Promise<InvoiceRequest | null> {
  const { data, error } = await supabase
    .from('invoice_requests')
    .select('*')
    .eq('sale_id', saleId)
    .maybeSingle()

  if (error) throw error
  return data
}
