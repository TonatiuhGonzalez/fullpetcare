// Acceso a datos del catálogo de cirugías y de lo aplicado a una cita (fase 32, PLAN.md D30).
// Único archivo que habla con Supabase para esto (CLAUDE.md §4). Nada se escribe con
// insert/update: lo hacen las RPC `save_surgery_package`, `apply_surgery_lines` y
// `remove_surgery_line`, que mantienen sus reglas (existencia, permisos) en una transacción.
import { supabase } from './supabase'
import type { Database, Json } from '@/types/database'
import type { SurgeryLineDraft, SurgeryRpcLine } from '@/lib/surgery'
import { toRpcLines } from '@/lib/surgery'

export type SurgeryPackage = Database['public']['Tables']['surgery_packages']['Row']
export type SurgeryPackageItem =
  Database['public']['Tables']['surgery_package_items']['Row']
export type AppliedSurgeryLine =
  Database['public']['Tables']['appointment_surgery_lines']['Row']

export interface SurgeryPackageWithItems extends SurgeryPackage {
  items: SurgeryPackageItem[]
}

/** Paquetes del negocio con sus renglones en orden, por nombre (activos e inactivos). */
export async function listPackages(tenantId: string): Promise<SurgeryPackageWithItems[]> {
  const { data, error } = await supabase
    .from('surgery_packages')
    .select('*, surgery_package_items ( * )')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .is('surgery_package_items.deleted_at', null)
    .order('name')

  if (error) throw error
  return (data ?? []).map(({ surgery_package_items, ...pkg }) => ({
    ...pkg,
    items: [...(surgery_package_items ?? [])].sort((a, b) => a.position - b.position),
  }))
}

/** Crea (sin `packageId`) o corrige un paquete con todos sus renglones. Devuelve su id. */
export async function savePackage(
  tenantId: string,
  packageId: string | null,
  name: string,
  notes: string | null,
  lines: SurgeryLineDraft[],
): Promise<string> {
  const { data, error } = await supabase.rpc('save_surgery_package', {
    p_tenant_id: tenantId,
    // La base acepta NULL (paquete nuevo y sin notas); los tipos marcan todo como obligatorio.
    p_package_id: packageId as string,
    p_name: name.trim(),
    p_notes: notes as string,
    p_items: toRpcLines(lines) as unknown as Json,
  })

  if (error) throw error
  return data
}

export async function setPackageActive(
  packageId: string,
  isActive: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('set_surgery_package_active', {
    p_package_id: packageId,
    p_is_active: isActive,
  })

  if (error) throw error
}

/** Renglones de cirugía ya aplicados a una cita, en el orden en que se aplicaron. */
export async function listApplied(
  tenantId: string,
  appointmentId: string,
): Promise<AppliedSurgeryLine[]> {
  const { data, error } = await supabase
    .from('appointment_surgery_lines')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('appointment_id', appointmentId)
    .is('deleted_at', null)
    .order('created_at')

  if (error) throw error
  return data ?? []
}

/** Aplica renglones (de un paquete, ajustados o armados a mano) a una cita veterinaria. */
export async function applyLines(
  appointmentId: string,
  packageId: string | null,
  lines: SurgeryLineDraft[],
): Promise<number> {
  const payload: SurgeryRpcLine[] = toRpcLines(
    lines.filter((l) => l.description.trim() !== ''),
  )
  const { data, error } = await supabase.rpc('apply_surgery_lines', {
    p_appointment_id: appointmentId,
    p_package_id: packageId as string,
    p_lines: payload as unknown as Json,
  })

  if (error) throw error
  return data
}

export async function removeLine(lineId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_surgery_line', { p_line_id: lineId })

  if (error) throw error
}

/** Mensaje en español para un error de las RPC de cirugías (la base ya manda el suyo). */
export function errorMessage(error: unknown): string {
  const fallback = 'No se pudo completar la acción. Revisa tu conexión.'
  if (error && typeof error === 'object' && 'message' in error) {
    const { message, code } = error as { message: string; code?: string }
    // 23514 check_violation, 42501 insufficient_privilege, P0002 no_data_found.
    if (code === '23514' || code === '42501' || code === 'P0002') return message
  }
  return fallback
}
