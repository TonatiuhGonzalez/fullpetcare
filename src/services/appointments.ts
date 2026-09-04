// Acceso a datos de appointments y appointment_services. Único archivo
// que habla con Supabase para esto (CLAUDE.md §4).
//
// create() y reschedule() NO hacen `.from('appointments').insert(...)`
// directo — llaman a las funciones de base de datos `create_appointment`
// / `reschedule_appointment` (migración `appointment_booking_rpc.sql`)
// vía `.rpc(...)`. Ahí vive la explicación completa de por qué: en
// resumen, agendar toca dos tablas relacionadas (la cita y sus
// servicios, con snapshots) y necesita quedar en una sola transacción,
// algo que dos llamadas sueltas desde aquí no podrían garantizar.
import { supabase } from './supabase'
import { dayRangeUtc } from '@/lib/datetime'
import type { Database } from '@/types/database'

export type Appointment = Database['public']['Tables']['appointments']['Row']
export type AppointmentService = Database['public']['Tables']['appointment_services']['Row']
export type AppointmentStatus = Database['public']['Enums']['appointment_status']
export type ServiceKind = Database['public']['Enums']['service_kind']

/**
 * Una cita más el nombre del cliente y de la mascota — lo que necesita
 * mostrarse en una lista (AgendaPage, tarea 3.17) sin obligar a quien la
 * pinta a hacer una consulta aparte por cada fila.
 */
export interface AppointmentWithNames extends Appointment {
  customerName: string
  petName: string
}

export interface NewAppointmentService {
  serviceId: string
  quantity?: number
}

export interface NewAppointmentArgs {
  tenantId: string
  branchId: string
  customerId: string
  petId: string
  kind: ServiceKind
  employeeUserId: string
  startsAt: Date
  endsAt: Date
  notes?: string | null
  services: NewAppointmentService[]
}

/** Las citas de una sucursal en un día calendario (hora local de esa sucursal). */
export async function listByDay(
  tenantId: string,
  branchId: string,
  dateStr: string,
  branchTimezone: string,
): Promise<AppointmentWithNames[]> {
  const { startUtc, endUtc } = dayRangeUtc(dateStr, branchTimezone)

  const { data, error } = await supabase
    .from('appointments')
    .select('*, customers ( first_name, last_name ), pets ( name )')
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId)
    .is('deleted_at', null)
    .gte('starts_at', startUtc.toISOString())
    .lt('starts_at', endUtc.toISOString())
    .order('starts_at')

  if (error) throw error

  return (data ?? []).map(({ customers, pets, ...appointment }) => ({
    ...appointment,
    customerName: customers ? `${customers.first_name} ${customers.last_name}` : '',
    petName: pets?.name ?? '',
  }))
}

export async function getById(tenantId: string, id: string): Promise<Appointment | null> {
  const { data, error } = await supabase
    .from('appointments')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw error
  return data
}

/** Los servicios (con sus snapshots) de una cita — para el detalle (tarea 3.19). */
export async function listServices(appointmentId: string): Promise<AppointmentService[]> {
  const { data, error } = await supabase
    .from('appointment_services')
    .select('*')
    .eq('appointment_id', appointmentId)
    .is('deleted_at', null)

  if (error) throw error
  return data ?? []
}

export async function create(args: NewAppointmentArgs): Promise<Appointment> {
  const { data, error } = await supabase.rpc('create_appointment', {
    p_tenant_id: args.tenantId,
    p_branch_id: args.branchId,
    p_customer_id: args.customerId,
    p_pet_id: args.petId,
    p_kind: args.kind,
    p_employee_user_id: args.employeeUserId,
    p_starts_at: args.startsAt.toISOString(),
    p_ends_at: args.endsAt.toISOString(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- el tipo generado marca p_notes como string no-nulable; Postgres sí acepta null para un parámetro `text` sin default.
    p_notes: (args.notes ?? null) as any,
    p_services: args.services.map((s) => ({
      service_id: s.serviceId,
      quantity: s.quantity ?? 1,
    })),
  })

  if (error) throw error
  return data
}

export async function reschedule(id: string, startsAt: Date, endsAt: Date): Promise<Appointment> {
  const { data, error } = await supabase.rpc('reschedule_appointment', {
    p_appointment_id: id,
    p_starts_at: startsAt.toISOString(),
    p_ends_at: endsAt.toISOString(),
  })

  if (error) throw error
  return data
}

export async function cancel(id: string): Promise<void> {
  const { error } = await supabase
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', id)

  if (error) throw error
}

export async function changeStatus(id: string, status: AppointmentStatus): Promise<void> {
  const { error } = await supabase.from('appointments').update({ status }).eq('id', id)

  if (error) throw error
}
