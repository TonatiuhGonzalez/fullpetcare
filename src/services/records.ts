// Acceso a datos del expediente: grooming_records, medical_records y
// vaccinations. Único archivo que habla con Supabase para esto
// (CLAUDE.md §4). `addWeight` para pesar una mascota vive en
// services/pets.ts (ahí nació en Fase 2, con la mascota) — aquí solo se
// re-exporta para que AttendPage.vue no tenga que importar de dos
// servicios distintos al guardar la ficha de veterinaria.
import { supabase } from './supabase'
import type { Database } from '@/types/database'

export { addWeight } from './pets'

export type GroomingRecord = Database['public']['Tables']['grooming_records']['Row']
export type MedicalRecord = Database['public']['Tables']['medical_records']['Row']
export type Vaccination = Database['public']['Tables']['vaccinations']['Row']

export interface GroomingRecordInput {
  tenantId: string
  appointmentId: string
  petId: string
  cutStyle?: string | null
  bladeUsed?: string | null
  shampooUsed?: string | null
  behaviorNotes?: string | null
  groomerNotes?: string | null
  conditionObservations?: string | null
}

/**
 * Guarda la ficha de estética de una cita. Es un `upsert` sobre
 * `appointment_id` (que en la tabla es `unique`, migración
 * `grooming_records.sql`) y no un `insert` liso: si se abre la misma
 * cita dos veces (por ejemplo, se guarda y luego se corrige algo antes
 * de completar), la segunda llamada actualiza el mismo registro en vez
 * de chocar con la restricción `unique` o crear un duplicado.
 */
export async function saveGroomingRecord(input: GroomingRecordInput): Promise<GroomingRecord> {
  const { data, error } = await supabase
    .from('grooming_records')
    .upsert(
      {
        tenant_id: input.tenantId,
        appointment_id: input.appointmentId,
        pet_id: input.petId,
        cut_style: input.cutStyle ?? null,
        blade_used: input.bladeUsed ?? null,
        shampoo_used: input.shampooUsed ?? null,
        behavior_notes: input.behaviorNotes ?? null,
        groomer_notes: input.groomerNotes ?? null,
        condition_observations: input.conditionObservations ?? null,
      },
      { onConflict: 'appointment_id' },
    )
    .select()
    .single()

  if (error) throw error
  return data
}

export interface MedicalRecordInput {
  tenantId: string
  appointmentId: string
  petId: string
  reason?: string | null
  history?: string | null
  examination?: string | null
  diagnosis?: string | null
  treatment?: string | null
  indications?: string | null
  temperatureDeciC?: number | null
  nextVisitDate?: string | null
}

/** Guarda la ficha de veterinaria de una cita. Mismo `upsert` que grooming. */
export async function saveMedicalRecord(input: MedicalRecordInput): Promise<MedicalRecord> {
  const { data, error } = await supabase
    .from('medical_records')
    .upsert(
      {
        tenant_id: input.tenantId,
        appointment_id: input.appointmentId,
        pet_id: input.petId,
        reason: input.reason ?? null,
        history: input.history ?? null,
        examination: input.examination ?? null,
        diagnosis: input.diagnosis ?? null,
        treatment: input.treatment ?? null,
        indications: input.indications ?? null,
        temperature_deci_c: input.temperatureDeciC ?? null,
        next_visit_date: input.nextVisitDate ?? null,
      },
      { onConflict: 'appointment_id' },
    )
    .select()
    .single()

  if (error) throw error
  return data
}

export interface NewVaccination {
  tenantId: string
  petId: string
  vaccineId: string
  appliedByUserId: string
  appliedAt?: string
  batchNumber?: string | null
  nextDueDate?: string | null
  appointmentId?: string | null
  notes?: string | null
}

/**
 * Aplica una vacuna. Es siempre un `insert`, nunca un `upsert`: a
 * diferencia de la ficha de la cita, una mascota puede recibir la misma
 * vacuna muchas veces en su vida y cada aplicación es un hecho propio
 * con su propia fecha y lote — no algo que se "corrige" sobreescribiendo
 * la anterior.
 */
export async function addVaccination(input: NewVaccination): Promise<Vaccination> {
  const { data, error } = await supabase
    .from('vaccinations')
    .insert({
      tenant_id: input.tenantId,
      pet_id: input.petId,
      vaccine_id: input.vaccineId,
      applied_by_user_id: input.appliedByUserId,
      applied_at: input.appliedAt ?? new Date().toISOString(),
      batch_number: input.batchNumber ?? null,
      next_due_date: input.nextDueDate ?? null,
      appointment_id: input.appointmentId ?? null,
      notes: input.notes ?? null,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

/** Una vacunación más el nombre de la vacuna — lo que necesita mostrarse en una lista. */
export interface VaccinationWithName extends Vaccination {
  vaccineName: string
}

/** Cartilla de vacunación de una mascota, de la más reciente a la más vieja. */
export async function listVaccinationsByPet(
  tenantId: string,
  petId: string,
): Promise<VaccinationWithName[]> {
  const { data, error } = await supabase
    .from('vaccinations')
    .select('*, vaccines ( name )')
    .eq('tenant_id', tenantId)
    .eq('pet_id', petId)
    .order('applied_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map(({ vaccines, ...vaccination }) => ({
    ...vaccination,
    vaccineName: vaccines?.name ?? '',
  }))
}

export async function getGroomingRecordByAppointment(
  appointmentId: string,
): Promise<GroomingRecord | null> {
  const { data, error } = await supabase
    .from('grooming_records')
    .select('*')
    .eq('appointment_id', appointmentId)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function getMedicalRecordByAppointment(
  appointmentId: string,
): Promise<MedicalRecord | null> {
  const { data, error } = await supabase
    .from('medical_records')
    .select('*')
    .eq('appointment_id', appointmentId)
    .maybeSingle()

  if (error) throw error
  return data
}
