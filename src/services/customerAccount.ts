// Cuenta del dueño de la mascota (fase 16B, PLAN.md D31). Único archivo que habla con la Edge
// Function `customer-account` y con el Auth del dueño. La función es la que filtra qué ve cada
// cuenta; aquí solo se llama y se le da forma al resultado.
import { customerSupabase } from './customerSupabase'
import type { Database } from '@/types/database'

type PetSpecies = Database['public']['Enums']['pet_species']
type PetSex = Database['public']['Enums']['pet_sex']
type ServiceKind = Database['public']['Enums']['service_kind']

export interface AccountPet {
  id: string
  name: string
  species: PetSpecies
  breed: string | null
  sex: PetSex | null
  birth_date: string | null
  photoUrl: string | null
}

export interface AccountUpcoming {
  pet_id: string
  pet_name: string
  kind: ServiceKind
  starts_at: string
  branch_name: string
  branch_address: string | null
  branch_phone: string | null
  branch_timezone: string
}

export interface AccountBusiness {
  tenant_id: string
  business_name: string
  business_timezone: string
  customer_id: string
  pets: AccountPet[]
  upcoming: AccountUpcoming[]
}

export interface AccountPetDetail {
  tenant_id: string
  business_name: string
  pet: AccountPet
  vaccinations: Array<{
    vaccine_name: string
    applied_at: string
    next_due_date: string | null
  }>
  visits: Array<{
    kind: ServiceKind
    starts_at: string
    branch_timezone: string
    employee_name: string | null
    detail: string | null
  }>
  upcoming: Array<Omit<AccountUpcoming, 'pet_id' | 'pet_name'>>
  hospital_stays: Array<{
    admitted_at: string
    discharged_at: string | null
    reason: string | null
    branch_timezone: string
    cost_cents: number | null
    notes: Array<{
      noted_at: string
      content: string | null
      temperature_deci_c: number | null
      weight_grams: number | null
      heart_rate_bpm: number | null
      mucous_color: string | null
      mood: string | null
      elimination: string | null
    }>
    medications: Array<{ name: string; quantity: number; administered_at: string }>
  }>
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await customerSupabase.functions.invoke('customer-account', {
    body,
  })
  if (error) throw error
  return data as T
}

/** Pide el código por correo. Siempre "funciona": no revela si el correo tiene cuenta. */
export async function requestCode(email: string, token?: string | null): Promise<void> {
  await call({ action: 'request_code', email, token: token ?? undefined })
}

/** Canjea el código de 6 dígitos y abre la sesión del dueño. */
export async function verifyCode(email: string, code: string): Promise<void> {
  const { error } = await customerSupabase.auth.verifyOtp({
    email,
    token: code,
    type: 'email',
  })
  if (error) throw error
}

export async function hasSession(): Promise<boolean> {
  const { data } = await customerSupabase.auth.getSession()
  return data.session !== null
}

export async function signOut(): Promise<void> {
  await customerSupabase.auth.signOut()
}

/** Vincula la cuenta con el cliente de ese link (RPC con la sesión de la propia persona). */
export async function claimLink(token: string): Promise<void> {
  const { error } = await customerSupabase.rpc('claim_customer_link', { p_token: token })
  if (error) throw error
}

export async function loadOverview(): Promise<AccountBusiness[]> {
  const result = await call<{ businesses: AccountBusiness[] }>({ action: 'overview' })
  return result.businesses
}

export async function loadPet(petId: string): Promise<AccountPetDetail> {
  return call<AccountPetDetail>({ action: 'pet', petId })
}

export async function deleteAccount(): Promise<void> {
  await call({ action: 'delete_account' })
  await customerSupabase.auth.signOut()
}
