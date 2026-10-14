// Acceso a datos de la hospitalización (fase 33, PLAN.md D30 punto 10). Único archivo que
// habla con Supabase para esto (CLAUDE.md §4). Estancias, notas y medicamentos NO se escriben
// con insert/update: lo hacen las RPC (admit_pet, add_hospital_note, etc.), que revalidan rol
// y sucursal. Espacios y configuración los escribe el dueño directo (RLS).
import { supabase } from './supabase'
import type { Database } from '@/types/database'
import type { DayRule, RateMode } from '@/lib/hospitalization'
import type { SaleUnit } from '@/lib/fractional'

export type HospitalSettings = Database['public']['Tables']['hospital_settings']['Row']
export type HospitalSpace = Database['public']['Tables']['hospital_spaces']['Row']
export type HospitalNote = Database['public']['Tables']['hospital_notes']['Row']
export type HospitalMedication =
  Database['public']['Tables']['hospital_medications']['Row']
export type HospitalStay = Database['public']['Tables']['hospital_stays']['Row']

export interface StayListItem extends HospitalStay {
  petName: string
  petSpecies: Database['public']['Enums']['pet_species']
  ownerName: string
  spaceName: string
}

export interface StayDetail extends StayListItem {
  notes: HospitalNote[]
  medications: HospitalMedication[]
  branchTimezone: string
}

// ── Configuración y espacios ───────────────────────────────────────────────────

export async function getSettings(tenantId: string): Promise<HospitalSettings | null> {
  const { data, error } = await supabase
    .from('hospital_settings')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw error
  return data
}

export interface SettingsInput {
  dayRule: DayRule
  defaultDailyRateCents: number | null
  defaultStayRateCents: number | null
}

/** Crea o actualiza la configuración del negocio (una fila por negocio). */
export async function saveSettings(
  tenantId: string,
  input: SettingsInput,
): Promise<void> {
  const { error } = await supabase.from('hospital_settings').upsert(
    {
      tenant_id: tenantId,
      day_rule: input.dayRule,
      default_daily_rate_cents: input.defaultDailyRateCents,
      default_stay_rate_cents: input.defaultStayRateCents,
    },
    { onConflict: 'tenant_id' },
  )
  if (error) throw error
}

/** Espacios de una sucursal (activos e inactivos), por nombre. */
export async function listSpaces(
  tenantId: string,
  branchId: string,
): Promise<HospitalSpace[]> {
  const { data, error } = await supabase
    .from('hospital_spaces')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId)
    .is('deleted_at', null)
    .order('name')
  if (error) throw error
  return data ?? []
}

export interface SpaceInput {
  name: string
  spaceType: string | null
  dailyRateCents: number | null
  stayRateCents: number | null
}

export async function createSpace(
  tenantId: string,
  branchId: string,
  input: SpaceInput,
): Promise<HospitalSpace> {
  const { data, error } = await supabase
    .from('hospital_spaces')
    .insert({
      tenant_id: tenantId,
      branch_id: branchId,
      name: input.name.trim(),
      space_type: input.spaceType,
      daily_rate_cents: input.dailyRateCents,
      stay_rate_cents: input.stayRateCents,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateSpace(id: string, input: SpaceInput): Promise<void> {
  const { error } = await supabase
    .from('hospital_spaces')
    .update({
      name: input.name.trim(),
      space_type: input.spaceType,
      daily_rate_cents: input.dailyRateCents,
      stay_rate_cents: input.stayRateCents,
    })
    .eq('id', id)
  if (error) throw error
}

export async function setSpaceActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from('hospital_spaces')
    .update({ is_active: isActive })
    .eq('id', id)
  if (error) throw error
}

// ── Estancias ──────────────────────────────────────────────────────────────────

interface StayRow extends HospitalStay {
  pets: { name: string; species: Database['public']['Enums']['pet_species'] } | null
  customers: { first_name: string; last_name: string } | null
  hospital_spaces: { name: string } | null
}

const STAY_SELECT =
  '*, pets ( name, species ), customers ( first_name, last_name ), hospital_spaces ( name )'

function mapStay(row: StayRow): StayListItem {
  const { pets, customers, hospital_spaces, ...stay } = row
  return {
    ...stay,
    petName: pets?.name ?? '(sin nombre)',
    petSpecies: pets?.species ?? 'other',
    ownerName: customers ? `${customers.first_name} ${customers.last_name}`.trim() : '',
    spaceName: hospital_spaces?.name ?? '',
  }
}

/** Mascotas hospitalizadas hoy en una sucursal (alta pendiente), de la más antigua a la más nueva. */
export async function listOpen(
  tenantId: string,
  branchId: string,
): Promise<StayListItem[]> {
  const { data, error } = await supabase
    .from('hospital_stays')
    .select(STAY_SELECT)
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId)
    .is('discharged_at', null)
    .order('admitted_at')
  if (error) throw error
  return ((data ?? []) as unknown as StayRow[]).map(mapStay)
}

/** Estancias dadas de alta y todavía sin cobrar (para no perderlas de vista). */
export async function listPendingBilling(
  tenantId: string,
  branchId: string,
): Promise<StayListItem[]> {
  const { data, error } = await supabase
    .from('hospital_stays')
    .select(STAY_SELECT)
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId)
    .not('discharged_at', 'is', null)
    .is('billed_sale_id', null)
    .order('discharged_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as unknown as StayRow[]).map(mapStay)
}

/** La estancia abierta de una mascota (para el aviso al cobrar); nulo si no está hospitalizada. */
export async function getOpenStayByPet(
  tenantId: string,
  petId: string,
): Promise<StayListItem | null> {
  const { data, error } = await supabase
    .from('hospital_stays')
    .select(STAY_SELECT)
    .eq('tenant_id', tenantId)
    .eq('pet_id', petId)
    .is('discharged_at', null)
    .maybeSingle()
  if (error) throw error
  return data ? mapStay(data as unknown as StayRow) : null
}

export async function getDetail(
  tenantId: string,
  stayId: string,
): Promise<StayDetail | null> {
  const { data, error } = await supabase
    .from('hospital_stays')
    .select(`${STAY_SELECT}, branches ( timezone )`)
    .eq('tenant_id', tenantId)
    .eq('id', stayId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const [notes, medications] = await Promise.all([
    supabase
      .from('hospital_notes')
      .select('*')
      .eq('stay_id', stayId)
      .order('noted_at', { ascending: false }),
    supabase
      .from('hospital_medications')
      .select('*')
      .eq('stay_id', stayId)
      .is('deleted_at', null)
      .order('administered_at', { ascending: false }),
  ])
  if (notes.error) throw notes.error
  if (medications.error) throw medications.error

  const row = data as unknown as StayRow & { branches: { timezone: string } | null }
  return {
    ...mapStay(row),
    notes: notes.data ?? [],
    medications: medications.data ?? [],
    branchTimezone: row.branches?.timezone ?? 'America/Mexico_City',
  }
}

export interface AdmitInput {
  petId: string
  spaceId: string
  rateMode: RateMode
  rateCents: number
  reason: string | null
}

export async function admit(input: AdmitInput): Promise<string> {
  const { data, error } = await supabase.rpc('admit_pet', {
    p_pet_id: input.petId,
    p_space_id: input.spaceId,
    p_rate_mode: input.rateMode,
    p_rate_cents: input.rateCents,
    p_reason: input.reason as string,
  })
  if (error) throw error
  return data
}

export interface NoteArgs {
  stayId: string
  content: string | null
  notedAt: string | null
  temperatureDeciC: number | null
  weightGrams: number | null
  heartRateBpm: number | null
  mucousColor: string | null
  mood: string | null
  elimination: string | null
}

// Los tipos generados marcan los parámetros con valor por defecto como obligatorios y no
// nulos; la base acepta NULL en todos: de ahí los `as`.
export async function addNote(args: NoteArgs): Promise<string> {
  const { data, error } = await supabase.rpc('add_hospital_note', {
    p_stay_id: args.stayId,
    p_content: args.content as string,
    p_noted_at: args.notedAt as string,
    p_temperature_deci_c: args.temperatureDeciC as number,
    p_weight_grams: args.weightGrams as number,
    p_heart_rate_bpm: args.heartRateBpm as number,
    p_mucous_color: args.mucousColor as string,
    p_mood: args.mood as string,
    p_elimination: args.elimination as string,
  })
  if (error) throw error
  return data
}

export async function administerMedication(args: {
  stayId: string
  productId: string
  quantity: number
  isBillable: boolean
  unit: SaleUnit
}): Promise<string> {
  const { data, error } = await supabase.rpc('administer_hospital_medication', {
    p_stay_id: args.stayId,
    p_product_id: args.productId,
    p_quantity: args.quantity,
    p_is_billable: args.isBillable,
    p_unit: args.unit,
  })
  if (error) throw error
  return data
}

export async function removeMedication(medicationId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_hospital_medication', {
    p_medication_id: medicationId,
  })
  if (error) throw error
}

export async function discharge(stayId: string): Promise<void> {
  const { error } = await supabase.rpc('discharge_pet', { p_stay_id: stayId })
  if (error) throw error
}

/** Cobra la estancia ya dada de alta, con sus medicamentos cobrables. Devuelve el id de la venta. */
export async function bill(
  stayId: string,
  payments: Array<{
    method: string
    amountCents: number
    paymentFormCode?: string
  }>,
  discountCents: number,
): Promise<string> {
  const { data, error } = await supabase.rpc('bill_hospital_stay', {
    p_stay_id: stayId,
    p_payments: payments.map((p) => ({
      method: p.method,
      amount_cents: p.amountCents,
      payment_form_code: p.paymentFormCode ?? null,
    })),
    p_discount_cents: discountCents,
  })
  if (error) throw error
  return data
}

/** Mensaje en español para un error de las RPC de hospitalización (la base ya manda el suyo). */
export function errorMessage(error: unknown): string {
  const fallback = 'No se pudo completar la acción. Revisa tu conexión.'
  if (error && typeof error === 'object' && 'message' in error) {
    const { message, code } = error as { message: string; code?: string }
    // 23514 check_violation, 42501 insufficient_privilege, P0002 no_data_found.
    if (code === '23514' || code === '42501' || code === 'P0002') return message
  }
  return fallback
}
