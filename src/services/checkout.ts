// Acceso a datos del cobro: sales, sale_items, payments. Único archivo que
// habla con Supabase para esto (CLAUDE.md §4).
//
// charge() NO hace tres `.insert()` seguidos — llama a la función de base
// de datos `checkout_appointment` (migración `checkout_rpc.sql`) vía
// `.rpc(...)`. Ahí vive la explicación completa de por qué (resumen: cobrar
// toca sales + sale_items + payments a la vez, y necesita quedar en una
// sola transacción — mismo razonamiento que `create_appointment` en
// services/appointments.ts, fase 3).
import { supabase } from './supabase'
import { sumLineItems, applyDiscount, type LineItem } from '@/lib/money'
import type { Database } from '@/types/database'

export type Sale = Database['public']['Tables']['sales']['Row']
export type SaleItem = Database['public']['Tables']['sale_items']['Row']
export type Payment = Database['public']['Tables']['payments']['Row']
export type PaymentMethod = Database['public']['Enums']['payment_method']

export interface CheckoutLineItem extends LineItem {
  serviceId: string
  description: string
}

/**
 * El resumen que ve CheckoutPage (tarea 5.14) ANTES de cobrar: qué
 * partidas trae la cita y cómo se desglosan, calculado del lado del
 * cliente con la misma fórmula que usa checkout_appointment() en la base
 * (lib/money.ts#sumLineItems) — para que lo que el usuario ve en pantalla
 * sea EXACTAMENTE lo que va a quedar guardado (tarea 5.10).
 */
export interface CheckoutSummary {
  lineItems: CheckoutLineItem[]
  subtotalCents: number
  taxCents: number
  discountCents: number
  totalCents: number
}

export interface NewPayment {
  method: PaymentMethod
  amountCents: number
  /** Solo aplica a métodos simulados; si se omite, el RPC genera una. */
  reference?: string
}

export interface ChargeArgs {
  appointmentId: string
  payments: NewPayment[]
  discountCents?: number
}

/** Un ticket completo: la venta, sus partidas y sus pagos, listos para TicketView (tarea 5.15). */
export interface Ticket {
  sale: Sale
  customerName: string
  branchName: string
  branchTimezone: string
  items: SaleItem[]
  payments: Payment[]
}

/**
 * Arma el resumen de cobro de una cita SIN escribir nada todavía — lee los
 * servicios de la cita (con snapshots, tarea 3.11) y la tasa de impuesto
 * ACTUAL del catálogo (appointment_services no la guarda como snapshot,
 * ver el comentario de checkout_rpc.sql), y aplica el mismo desglose de
 * IVA que la base.
 */
export async function buildSummary(
  appointmentId: string,
  discountCents = 0,
): Promise<CheckoutSummary> {
  const { data, error } = await supabase
    .from('appointment_services')
    .select('service_id, name_snapshot, unit_price_cents, quantity, services ( tax_rate_bp )')
    .eq('appointment_id', appointmentId)
    .is('deleted_at', null)

  if (error) throw error

  const lineItems: CheckoutLineItem[] = (data ?? []).map((row) => ({
    serviceId: row.service_id,
    description: row.name_snapshot,
    quantity: row.quantity,
    unitPriceCents: row.unit_price_cents,
    taxRateBp: row.services?.tax_rate_bp ?? 0,
  }))

  const { subtotalCents, taxCents, totalCents: grossTotalCents } = sumLineItems(lineItems)
  const totalCents = applyDiscount(grossTotalCents, discountCents)

  return { lineItems, subtotalCents, taxCents, discountCents, totalCents }
}

/** Cobra una cita atendida y devuelve el ticket completo, listo para imprimir. */
export async function charge(args: ChargeArgs): Promise<Ticket> {
  const { data: saleId, error } = await supabase.rpc('checkout_appointment', {
    p_appointment_id: args.appointmentId,
    p_payments: args.payments.map((p) => ({
      method: p.method,
      amount_cents: p.amountCents,
      reference: p.reference ?? null,
    })),
    p_discount_cents: args.discountCents ?? 0,
  })

  if (error) throw error
  return getTicket(saleId)
}

/** Recupera un ticket ya cobrado (p. ej. al volver a una venta desde el historial). */
export async function getTicket(saleId: string): Promise<Ticket> {
  const [saleResult, itemsResult, paymentsResult] = await Promise.all([
    supabase
      .from('sales')
      .select('*, customers ( first_name, last_name ), branches ( name, timezone )')
      .eq('id', saleId)
      .single(),
    supabase
      .from('sale_items')
      .select('*')
      .eq('sale_id', saleId)
      .is('deleted_at', null)
      .order('created_at'),
    supabase.from('payments').select('*').eq('sale_id', saleId).order('created_at'),
  ])

  if (saleResult.error) throw saleResult.error
  if (itemsResult.error) throw itemsResult.error
  if (paymentsResult.error) throw paymentsResult.error

  const { customers, branches, ...sale } = saleResult.data

  return {
    sale,
    customerName: customers ? `${customers.first_name} ${customers.last_name}` : '',
    branchName: branches?.name ?? '',
    branchTimezone: branches?.timezone ?? 'America/Mexico_City',
    items: itemsResult.data ?? [],
    payments: paymentsResult.data ?? [],
  }
}
