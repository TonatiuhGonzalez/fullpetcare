// Historial completo de una mascota (CLAUDE.md §1, punto 6 del alcance):
// junta citas de estética y veterinaria (solo las YA atendidas —
// `status = 'completed'`, con su ficha), vacunas aplicadas, y pesadas, en
// una sola línea de tiempo. Único archivo que habla con Supabase para
// esto (CLAUDE.md §4); el ORDEN lo decide lib/timeline.ts (función pura),
// esto solo trae los datos.
import { supabase } from './supabase'
import { buildTimeline, type TimelineEntry } from '@/lib/timeline'

/**
 * Trae los cuatro tipos de evento de esta mascota y los mezcla en una
 * sola línea de tiempo (más reciente primero). `tenantId` filtra cada
 * consulta explícitamente — RLS ya lo garantiza por sí solo (CLAUDE.md
 * §7), pero filtrar aquí además evita un viaje a la base con un
 * `tenant_id` ajeno que de todas formas iba a volver vacío.
 *
 * grooming_records/medical_records se piden con `embed` sobre
 * appointments en vez de en consultas separadas: appointment_id es
 * `unique` en ambas tablas (migraciones de fase 4), así que PostgREST
 * los trae como un solo objeto (o null), no un arreglo.
 */
export async function getTimeline(tenantId: string, petId: string): Promise<TimelineEntry[]> {
  const [appointmentsResult, vaccinationsResult, weightsResult] = await Promise.all([
    supabase
      .from('appointments')
      .select(
        'id, kind, starts_at, grooming_records ( cut_style, groomer_notes ), medical_records ( reason, diagnosis )',
      )
      .eq('tenant_id', tenantId)
      .eq('pet_id', petId)
      .eq('status', 'completed')
      .is('deleted_at', null),
    supabase
      .from('vaccinations')
      .select('id, applied_at, vaccines ( name )')
      .eq('tenant_id', tenantId)
      .eq('pet_id', petId),
    supabase
      .from('pet_weights')
      .select('id, measured_at, weight_grams')
      .eq('tenant_id', tenantId)
      .eq('pet_id', petId)
      .is('deleted_at', null),
  ])

  if (appointmentsResult.error) throw appointmentsResult.error
  if (vaccinationsResult.error) throw vaccinationsResult.error
  if (weightsResult.error) throw weightsResult.error

  const visitEntries: TimelineEntry[] = (appointmentsResult.data ?? []).map((appointment) =>
    appointment.kind === 'grooming'
      ? {
          type: 'grooming' as const,
          at: appointment.starts_at,
          appointmentId: appointment.id,
          cutStyle: appointment.grooming_records?.cut_style ?? null,
          groomerNotes: appointment.grooming_records?.groomer_notes ?? null,
        }
      : {
          type: 'veterinary' as const,
          at: appointment.starts_at,
          appointmentId: appointment.id,
          reason: appointment.medical_records?.reason ?? null,
          diagnosis: appointment.medical_records?.diagnosis ?? null,
        },
  )

  const vaccinationEntries: TimelineEntry[] = (vaccinationsResult.data ?? []).map(
    (vaccination) => ({
      type: 'vaccination' as const,
      at: vaccination.applied_at,
      vaccinationId: vaccination.id,
      vaccineName: vaccination.vaccines?.name ?? '',
    }),
  )

  const weightEntries: TimelineEntry[] = (weightsResult.data ?? []).map((weight) => ({
    type: 'weight' as const,
    at: weight.measured_at,
    weightId: weight.id,
    weightGrams: weight.weight_grams,
  }))

  return buildTimeline([...visitEntries, ...vaccinationEntries, ...weightEntries])
}
