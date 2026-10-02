// Acceso a datos de Reportes (fase 12, tarea 12.12): llama a las funciones
// `report_sales_summary`, `report_top_items` y `report_staff_activity`, que
// agregan EN LA BASE (no se traen filas al navegador: el API corta a 1 000 y los
// totales saldrían mal sin avisar). Único archivo que habla con Supabase para
// esto (CLAUDE.md §4). Los mensajes que la base escribe con `raise exception` ya
// vienen en español.
import { supabase } from './supabase'

export interface SalesTotals {
  salesCount: number
  subtotalCents: number
  ivaCents: number
  discountCents: number
  totalCents: number
}

export interface DayRow extends SalesTotals {
  day: string
}

export interface BranchRow extends SalesTotals {
  branchId: string
  branchName: string
}

export interface MethodTotals {
  cashCents: number
  cardCents: number
  transferCents: number
  openpayCents: number
  changeGivenCents: number
}

export interface SalesSummary {
  totals: SalesTotals
  byDay: DayRow[]
  byBranch: BranchRow[]
  byMethod: MethodTotals
  cancelled: { salesCount: number; totalCents: number }
}

export interface TopItem {
  itemId: string
  name: string
  quantity: number
  revenueCents: number
  ivaCents: number
  salesCount: number
}

export interface TopItems {
  services: TopItem[]
  products: TopItem[]
}

export interface StaffRow {
  /** null = "Sin asignar". */
  userId: string | null
  fullName: string
  appointmentsCompleted: number
  servicesCents: number
  productsCents: number
  totalCents: number
}

const GENERIC_ERROR =
  'No se pudieron cargar los reportes. Revisa tu conexión e intenta de nuevo.'

// Errores de la base que escribimos nosotros (permiso, periodo inválido): se
// muestran tal cual; cualquier otro (red, permisos de Postgres) es genérico.
function friendly(error: { code?: string; message: string }): Error {
  const isOurs = ['42501', '22023'].includes(error.code ?? '')
  const isTechnical = /row-level security|permission denied/i.test(error.message)
  return new Error(isOurs && !isTechnical ? error.message : GENERIC_ERROR)
}

// Los jsonb llegan con claves en snake_case y números; se mapean a camelCase.
type Json = Record<string, unknown>
const n = (value: unknown): number => Number(value ?? 0)
const s = (value: unknown): string => String(value ?? '')

function totals(row: Json): SalesTotals {
  return {
    salesCount: n(row.sales_count),
    subtotalCents: n(row.subtotal_cents),
    ivaCents: n(row.iva_cents),
    discountCents: n(row.discount_cents),
    totalCents: n(row.total_cents),
  }
}

export async function getSalesSummary(
  tenantId: string,
  from: string,
  to: string,
  branchId: string | null,
): Promise<SalesSummary> {
  const { data, error } = await supabase.rpc('report_sales_summary', {
    p_tenant_id: tenantId,
    p_from: from,
    p_to: to,
    p_branch_id: branchId ?? undefined,
  })
  if (error) throw friendly(error)

  const r = data as Json
  const method = r.by_method as Json
  const cancelled = r.cancelled as Json
  return {
    totals: totals(r.totals as Json),
    byDay: (r.by_day as Json[]).map((d) => ({ day: s(d.day), ...totals(d) })),
    byBranch: (r.by_branch as Json[]).map((b) => ({
      branchId: s(b.branch_id),
      branchName: s(b.branch_name),
      ...totals(b),
    })),
    byMethod: {
      cashCents: n(method.cash_cents),
      cardCents: n(method.card_cents),
      transferCents: n(method.transfer_cents),
      openpayCents: n(method.openpay_cents),
      changeGivenCents: n(method.change_given_cents),
    },
    cancelled: {
      salesCount: n(cancelled.sales_count),
      totalCents: n(cancelled.total_cents),
    },
  }
}

function mapItems(rows: Json[]): TopItem[] {
  return rows.map((i) => ({
    itemId: s(i.item_id),
    name: s(i.name),
    quantity: n(i.quantity),
    revenueCents: n(i.revenue_cents),
    ivaCents: n(i.iva_cents),
    salesCount: n(i.sales_count),
  }))
}

export async function getTopItems(
  tenantId: string,
  from: string,
  to: string,
  branchId: string | null,
  limit = 20,
): Promise<TopItems> {
  const { data, error } = await supabase.rpc('report_top_items', {
    p_tenant_id: tenantId,
    p_from: from,
    p_to: to,
    p_branch_id: branchId ?? undefined,
    p_limit: limit,
  })
  if (error) throw friendly(error)
  const r = data as Json
  return {
    services: mapItems(r.services as Json[]),
    products: mapItems(r.products as Json[]),
  }
}

export async function getStaffActivity(
  tenantId: string,
  from: string,
  to: string,
  branchId: string | null,
): Promise<StaffRow[]> {
  const { data, error } = await supabase.rpc('report_staff_activity', {
    p_tenant_id: tenantId,
    p_from: from,
    p_to: to,
    p_branch_id: branchId ?? undefined,
  })
  if (error) throw friendly(error)
  return (data as Json[]).map((r) => ({
    userId: (r.user_id as string | null) ?? null,
    fullName: s(r.full_name),
    appointmentsCompleted: n(r.appointments_completed),
    servicesCents: n(r.services_cents),
    productsCents: n(r.products_cents),
    totalCents: n(r.total_cents),
  }))
}
