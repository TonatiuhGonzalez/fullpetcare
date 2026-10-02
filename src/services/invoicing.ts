// Facturación de una venta (fase 11, tareas 11.18 y 11.19). Timbrar, cancelar y
// bajar archivos pasan por la Edge Function `invoicing` (la única que habla con
// el PAC); aquí solo se llama y se leen las solicitudes y archivos, que RLS
// protege. Único archivo que habla con Supabase para esto (CLAUDE.md §4).
import { supabase } from './supabase'
import { pickCurrentInvoice } from '@/lib/invoiceStatus'
import type { Database } from '@/types/database'

export type InvoiceRequest = Database['public']['Tables']['invoice_requests']['Row']

const GENERIC_ERROR =
  'No se pudo completar la operación. Revisa tu conexión e intenta de nuevo.'

export interface InvoiceReceiver {
  rfc: string
  legalName: string
  taxRegimeCode: string
  postalCode: string
  cfdiUse: string
}

/** La factura vigente de una venta (o null si nunca se ha pedido). */
export async function getCurrentBySale(saleId: string): Promise<InvoiceRequest | null> {
  const { data, error } = await supabase
    .from('invoice_requests')
    .select('*')
    .eq('sale_id', saleId)
    .is('deleted_at', null)
  if (error) throw error
  return pickCurrentInvoice(data ?? [])
}

/** La venta pagada de una cita (null si aún no se cobra). */
export async function findPaidSaleIdByAppointment(
  appointmentId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('sale_items')
    .select('sale_id, sales!inner ( status )')
    .eq('appointment_id', appointmentId)
    .eq('sales.status', 'paid')
    .is('deleted_at', null)
    .limit(1)
  if (error) throw error
  return data?.[0]?.sale_id ?? null
}

export async function stamp(
  tenantId: string,
  saleId: string,
  receiver: InvoiceReceiver,
  paymentFormCode: string | null,
): Promise<void> {
  const form = new FormData()
  form.set('action', 'stamp')
  form.set('tenantId', tenantId)
  form.set('saleId', saleId)
  form.set('receiver', JSON.stringify(receiver))
  if (paymentFormCode) form.set('paymentFormCode', paymentFormCode)
  await invoke(form)
}

export async function cancel(
  tenantId: string,
  invoiceRequestId: string,
  motive: string,
): Promise<void> {
  const form = new FormData()
  form.set('action', 'cancel')
  form.set('tenantId', tenantId)
  form.set('invoiceRequestId', invoiceRequestId)
  form.set('motive', motive)
  await invoke(form)
}

/** Vuelve a guardar el XML y el PDF de una factura timbrada (si no se alcanzaron a guardar). */
export async function refetchFiles(
  tenantId: string,
  invoiceRequestId: string,
): Promise<void> {
  const form = new FormData()
  form.set('action', 'download')
  form.set('tenantId', tenantId)
  form.set('invoiceRequestId', invoiceRequestId)
  await invoke(form)
}

/** Liga temporal (5 min) para abrir un archivo del bucket privado `invoices`. */
export async function getFileUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('invoices')
    .createSignedUrl(path, 300)
  if (error || !data) throw new Error('No se pudo abrir el archivo. Intenta de nuevo.')
  return data.signedUrl
}

async function invoke(form: FormData): Promise<void> {
  const { error } = await supabase.functions.invoke('invoicing', { body: form })
  if (error) throw new Error(await functionErrorMessage(error))
}

// supabase-js deja el Response crudo en `.context`; la función responde con un
// `message` ya en español.
async function functionErrorMessage(error: unknown): Promise<string> {
  const response =
    error && typeof error === 'object' && 'context' in error
      ? (error as { context: unknown }).context
      : null
  if (response instanceof Response) {
    try {
      const body = await response.clone().json()
      if (typeof body?.message === 'string') return body.message
    } catch {
      // El cuerpo no era JSON: mensaje genérico.
    }
  }
  return GENERIC_ERROR
}
