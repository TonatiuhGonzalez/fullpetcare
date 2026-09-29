// Acceso a datos de branches. Por ahora solo lo que necesita agendar una
// cita (tarea 3.18): el horario de apertura, para calcular huecos
// disponibles con lib/availability.ts.
import { supabase } from './supabase'
import type { Database } from '@/types/database'

export type Branch = Database['public']['Tables']['branches']['Row']

export async function getById(id: string): Promise<Branch | null> {
  const { data, error } = await supabase
    .from('branches')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw error
  return data
}

/**
 * Las sucursales HABILITADAS de un tenant, por nombre — usado por la pantalla
 * de empleados (fase 9) para armar el selector de sucursales. Una sucursal
 * deshabilitada no se ofrece para asignar gente.
 */
export async function listByTenant(tenantId: string): Promise<Branch[]> {
  const { data, error } = await supabase
    .from('branches')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('name')

  if (error) throw error
  return data ?? []
}

/**
 * TODAS las sucursales de un tenant, habilitadas o no — la pantalla de
 * configuración necesita ver también las deshabilitadas para poder volver a
 * habilitarlas (tarea #1959).
 */
export async function listAllByTenant(tenantId: string): Promise<Branch[]> {
  const { data, error } = await supabase
    .from('branches')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('name')

  if (error) throw error
  return data ?? []
}

/** Datos editables de una sucursal (los mismos al crearla y al editarla). */
export interface BranchInput {
  name: string
  address: string | null
  postalCode: string | null
  phone: string | null
  timezone: string
  openingHours: Record<string, { opensAt: string; closesAt: string } | null>
}

function toRow(input: BranchInput) {
  return {
    name: input.name.trim(),
    address: input.address,
    postal_code: input.postalCode,
    phone: input.phone,
    timezone: input.timezone,
    opening_hours: input.openingHours,
  }
}

/** Alta de una sucursal. Solo el dueño puede (RLS); nace habilitada. */
export async function create(tenantId: string, input: BranchInput): Promise<Branch> {
  const { data, error } = await supabase
    .from('branches')
    .insert({ tenant_id: tenantId, ...toRow(input) })
    .select()
    .single()

  if (error) throw error
  return data
}

/** Edita los datos de una sucursal (no su estado: eso es setActive). */
export async function update(id: string, input: BranchInput): Promise<Branch> {
  const { data, error } = await supabase
    .from('branches')
    .update(toRow(input))
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Habilita o deshabilita una sucursal. Al deshabilitar, la base rechaza el
 * cambio si la sucursal tiene citas pendientes, empleados asignados o es la
 * última activa (trigger de la migración branch_settings.sql); el error trae
 * el motivo en español en `message`.
 */
export async function setActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.from('branches').update({ is_active: isActive }).eq('id', id)
  if (error) {
    // 23514 = check_violation: el código que usa el trigger para decir "esta
    // sucursal todavía se usa". Su mensaje ya está en español y sin jerga.
    if (error.code === '23514') throw new BranchDisableBlockedError(error.message)
    throw error
  }
}

/** La base rechazó deshabilitar la sucursal porque todavía se usa; `message` dice por qué. */
export class BranchDisableBlockedError extends Error {}
