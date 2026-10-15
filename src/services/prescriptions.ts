// Acceso a datos de la receta médica (fase 28, PLAN.md D30). Único archivo que habla con
// Supabase para esto (CLAUDE.md §4).
//
// La receta NO se escribe con insert/update: la emite la RPC `save_prescription`, que
// revalida quién es, exige su cédula y guarda una copia de ella (migración
// 20261021120000_prescriptions.sql).
import { supabase } from './supabase'
import type { Database, Json } from '@/types/database'
import type { PrescriptionRpcItem } from '@/lib/prescription'

export type Prescription = Database['public']['Tables']['prescriptions']['Row']
export type PrescriptionItem = Database['public']['Tables']['prescription_items']['Row']

export interface PrescriptionWithItems extends Prescription {
  items: PrescriptionItem[]
}

export interface UnregisteredMedication {
  medicationName: string
  timesPrescribed: number
  lastPrescribedAt: string
}

/** La receta de una cita con sus renglones en orden; nulo si todavía no se emite. */
export async function getByAppointment(
  tenantId: string,
  appointmentId: string,
): Promise<PrescriptionWithItems | null> {
  const { data, error } = await supabase
    .from('prescriptions')
    .select('*, prescription_items(*)')
    .eq('tenant_id', tenantId)
    .eq('appointment_id', appointmentId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const { prescription_items: items, ...prescription } = data
  return {
    ...prescription,
    items: [...(items ?? [])].sort((a, b) => a.position - b.position),
  }
}

/** Emite o corrige la receta de una cita. Devuelve el id de la receta. */
export async function save(
  appointmentId: string,
  items: PrescriptionRpcItem[],
): Promise<string> {
  const { data, error } = await supabase.rpc('save_prescription', {
    p_appointment_id: appointmentId,
    p_items: items as unknown as Json,
  })

  if (error) throw error
  return data
}

/** Medicamentos de texto libre sin registrar (solo los ve el dueño del negocio). */
export async function listUnregistered(): Promise<UnregisteredMedication[]> {
  const { data, error } = await supabase.rpc('list_unregistered_medications')

  if (error) throw error
  return (data ?? []).map((row) => ({
    medicationName: row.medication_name,
    timesPrescribed: row.times_prescribed,
    lastPrescribedAt: row.last_prescribed_at,
  }))
}

/**
 * El dueño resuelve un medicamento sin registrar: con `productId` lo liga a un producto
 * del catálogo; sin él, lo descarta del aviso. Devuelve cuántos renglones se actualizaron.
 */
export async function resolveUnregistered(
  tenantId: string,
  medicationName: string,
  productId: string | null,
): Promise<number> {
  const { data, error } = await supabase.rpc('resolve_unregistered_medication', {
    p_tenant_id: tenantId,
    p_medication_name: medicationName,
    p_product_id: productId ?? undefined,
  })

  if (error) throw error
  return data
}

/** Mensaje en español de un error al emitir la receta (la base ya manda el suyo). */
export function saveErrorMessage(error: unknown): string {
  const fallback = 'No se pudo guardar la receta. Revisa tu conexión.'
  if (error && typeof error === 'object' && 'message' in error) {
    const { message, code } = error as { message: string; code?: string }
    // Las excepciones de la función llevan un mensaje ya en español; los errores de red
    // o de PostgREST no, y esos no deben mostrarse tal cual (§5.4).
    // 23514 check_violation, 42501 insufficient_privilege, P0002 no_data_found.
    if (code === '23514' || code === '42501' || code === 'P0002') return message
  }
  return fallback
}
