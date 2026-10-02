// Acceso a datos de la Caja (fase 12): turnos (`cash_sessions`), movimientos
// (`cash_movements`) y el resumen del turno. Único archivo que habla con Supabase
// para esto (CLAUDE.md §4).
//
// Los turnos NO se escriben directo: abrir y cerrar son RPC (open_cash_session /
// close_cash_session) que revalidan permiso y sucursal en la base. Los movimientos
// sí se insertan directo (política + trigger de caja abierta). Los mensajes de la
// base que escribimos con `raise exception` ya vienen en español.
import { supabase } from './supabase'
import type { CashMovementKind } from '@/lib/cashRegister'
import type { Database } from '@/types/database'

export type CashSession = Database['public']['Tables']['cash_sessions']['Row']
export type CashMovement = Database['public']['Tables']['cash_movements']['Row']

/** Cobrado en un turno (ver cash_session_overview): por método, cambio y esperado. */
export interface CashOverview {
  cashCents: number
  cardCents: number
  transferCents: number
  openpayCents: number
  changeGivenCents: number
  incomeCents: number
  outflowCents: number
  expectedCents: number
}

const GENERIC_ERROR =
  'No se pudo completar la operación. Revisa tu conexión e intenta de nuevo.'

// Errores de la base que escribimos nosotros (código de `raise exception`): se
// muestran tal cual. Cualquier otro (permisos de Postgres, red) es genérico.
function friendly(error: { code?: string; message: string }): Error {
  const isOurs = ['42501', '22023', '23505', '23514'].includes(error.code ?? '')
  const isTechnical = /row-level security|permission denied|violates/i.test(error.message)
  return new Error(isOurs && !isTechnical ? error.message : GENERIC_ERROR)
}

/** La caja abierta de una sucursal, o null si está cerrada. */
export async function getOpenSession(
  tenantId: string,
  branchId: string,
): Promise<CashSession | null> {
  const { data, error } = await supabase
    .from('cash_sessions')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId)
    .is('closed_at', null)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw error
  return data
}

/** Últimos cortes cerrados de una sucursal, del más reciente al más antiguo. */
export async function listClosedSessions(
  tenantId: string,
  branchId: string,
  limit = 20,
): Promise<CashSession[]> {
  const { data, error } = await supabase
    .from('cash_sessions')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId)
    .not('closed_at', 'is', null)
    .is('deleted_at', null)
    .order('closed_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

export async function listMovements(sessionId: string): Promise<CashMovement[]> {
  const { data, error } = await supabase
    .from('cash_movements')
    .select('*')
    .eq('cash_session_id', sessionId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function getOverview(sessionId: string): Promise<CashOverview> {
  const { data, error } = await supabase.rpc('cash_session_overview', {
    p_session_id: sessionId,
  })
  if (error) throw friendly(error)
  const row = data?.[0]
  if (!row) throw new Error(GENERIC_ERROR)
  // PostgREST entrega los `bigint` como número (caben de sobra: son centavos).
  return {
    cashCents: Number(row.cash_cents),
    cardCents: Number(row.card_cents),
    transferCents: Number(row.transfer_cents),
    openpayCents: Number(row.openpay_cents),
    changeGivenCents: Number(row.change_given_cents),
    incomeCents: Number(row.income_cents),
    outflowCents: Number(row.outflow_cents),
    expectedCents: Number(row.expected_cents),
  }
}

export async function openSession(
  branchId: string,
  openingFloatCents: number,
  note: string | null,
): Promise<string> {
  const { data, error } = await supabase.rpc('open_cash_session', {
    p_branch_id: branchId,
    p_opening_float_cents: openingFloatCents,
    p_note: note ?? undefined,
  })
  if (error) throw friendly(error)
  return data
}

export async function closeSession(
  sessionId: string,
  countedCents: number,
  note: string | null,
): Promise<CashSession> {
  const { data, error } = await supabase.rpc('close_cash_session', {
    p_session_id: sessionId,
    p_counted_cents: countedCents,
    p_note: note ?? undefined,
  })
  if (error) throw friendly(error)
  return data
}

export interface NewCashMovement {
  tenantId: string
  branchId: string
  sessionId: string
  /** Quien lo registra: la política exige que sea el usuario autenticado. */
  userId: string
  type: CashMovementKind
  amountCents: number
  reason: string
}

export async function addMovement(movement: NewCashMovement): Promise<void> {
  const { error } = await supabase.from('cash_movements').insert({
    tenant_id: movement.tenantId,
    branch_id: movement.branchId,
    cash_session_id: movement.sessionId,
    movement_type: movement.type,
    amount_cents: movement.amountCents,
    reason: movement.reason.trim(),
    created_by: movement.userId,
  })
  if (error) {
    // El trigger de "caja cerrada" y los checks escriben en español (23514).
    throw friendly(error)
  }
}

/** Nombres de las personas indicadas (los miembros del negocio se ven entre sí). */
export async function getNames(userIds: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(userIds)]
  if (unique.length === 0) return {}
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', unique)
  if (error) throw error
  return Object.fromEntries((data ?? []).map((p) => [p.id, p.full_name]))
}
