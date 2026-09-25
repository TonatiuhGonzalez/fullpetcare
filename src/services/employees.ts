// Acceso a datos de la pantalla de empleados (fase 9, CLAUDE.md §6.7).
// Un "empleado" aquí ES la persona que ya tiene membership en el tenant
// (decisión tomada con el usuario antes de esta fase) — este archivo une
// memberships + profiles + membership_branches + employee_details en un
// solo objeto para la UI.
import { supabase } from './supabase'
import type { MemberRole } from './memberships'
import type { Database } from '@/types/database'

// El generador de tipos (supabase gen types) marca los argumentos del RPC
// como `string` a secas, no `string | null` — no sabe que Postgres acepta
// NULL para un parámetro sin `not null` aunque el tipo SQL sea `date`/
// `text`. CURP, RFC, fecha de nacimiento y clave de elector son opcionales
// de verdad (un empleado puede no tenerlos capturados todavía), así que
// aquí se corrige el tipo a mano en vez de forzar una cadena vacía que
// Postgres rechazaría al intentar convertirla a `date` (CLAUDE.md §5.1:
// "si un tipo estorba, se corrige a mano en vez de pelear con él").
type CreateEmployeeMembershipArgs = Omit<
  Database['public']['Functions']['create_employee_membership']['Args'],
  'p_birth_date' | 'p_curp' | 'p_rfc' | 'p_voter_id_number'
> & {
  p_birth_date: string | null
  p_curp: string | null
  p_rfc: string | null
  p_voter_id_number: string | null
}

export interface Employee {
  membershipId: string
  userId: string
  fullName: string
  role: MemberRole
  isActive: boolean
  branchIds: string[]
  birthDate: string | null
  curp: string | null
  rfc: string | null
  voterIdNumber: string | null
}

interface EmployeeRow {
  id: string
  user_id: string
  role: MemberRole
  is_active: boolean
  profiles: { full_name: string } | null
  membership_branches: { branch_id: string }[]
  employee_details: {
    birth_date: string | null
    curp: string | null
    rfc: string | null
    voter_id_number: string | null
  } | null
}

function mapRow(row: EmployeeRow): Employee {
  return {
    membershipId: row.id,
    userId: row.user_id,
    fullName: row.profiles?.full_name ?? '(sin nombre)',
    role: row.role,
    isActive: row.is_active,
    branchIds: row.membership_branches.map((mb) => mb.branch_id),
    birthDate: row.employee_details?.birth_date ?? null,
    curp: row.employee_details?.curp ?? null,
    rfc: row.employee_details?.rfc ?? null,
    voterIdNumber: row.employee_details?.voter_id_number ?? null,
  }
}

const SELECT_COLUMNS = `
  id,
  user_id,
  role,
  is_active,
  profiles ( full_name ),
  membership_branches ( branch_id ),
  employee_details ( birth_date, curp, rfc, voter_id_number )
`

/**
 * Todos los empleados (memberships) activos de un tenant, con su nombre,
 * rol, sucursales y ficha personal si ya la tiene — un empleado sembrado
 * antes de esta fase (los 4 usuarios de demo) puede no tener fila en
 * employee_details todavía; sus campos personales llegan en `null` hasta
 * que alguien los complete desde EmployeeFormDialog.vue.
 *
 * `.is('membership_branches.deleted_at', null)`: membership_branches_select
 * ya no filtra los borrados suaves ella misma (CLAUDE.md §7.2 — esa tabla
 * ahora tiene UPDATE para authenticated, migración
 * fix_membership_branches_select_for_soft_delete.sql), así que el filtro
 * se hace aquí, igual que en services/memberships.ts.
 */
export async function list(tenantId: string): Promise<Employee[]> {
  const { data, error } = await supabase
    .from('memberships')
    .select(SELECT_COLUMNS)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .is('membership_branches.deleted_at', null)
    .order('role')

  if (error) throw error
  return (data ?? []).map(mapRow)
}

export interface NewEmployeeInput {
  tenantId: string
  email: string
  fullName: string
  role: MemberRole
  branchIds: string[]
  birthDate: string | null
  curp: string | null
  rfc: string | null
  voterIdNumber: string | null
}

/**
 * Intenta sacar el mensaje que la Edge Function puso en el cuerpo de una
 * respuesta de error (p. ej. "No tienes permiso para dar de alta
 * empleados.") — supabase-js no lo hace solo: un error de función expone
 * el Response crudo en `.context`, no el JSON ya parseado. Si no se puede
 * leer (p. ej. sin red, ni siquiera llegó a responder el servidor), se
 * usa el mensaje genérico de CLAUDE.md §5.4.
 */
async function extractFunctionErrorMessage(error: unknown): Promise<string> {
  const fallback = 'No se pudo dar de alta al empleado. Revisa tu conexión.'
  if (
    error &&
    typeof error === 'object' &&
    'context' in error &&
    (error as { context: unknown }).context instanceof Response
  ) {
    const response = (error as { context: Response }).context

    // 404 / 503 / 504 NO los manda nuestra función: los manda el gateway de
    // Supabase cuando la función no existe o no está corriendo (en local:
    // el runtime de Edge Functions apagado; en la nube: sin desplegar).
    // Su cuerpo es texto técnico en inglés ("name resolution failed") que
    // no le sirve a nadie (CLAUDE.md §5.4) — se reemplaza por algo
    // accionable. Los 4xx/502 SÍ son de invite-employee y ya vienen en
    // español, se muestran tal cual.
    if (response.status === 404 || response.status === 503 || response.status === 504) {
      return 'El servicio de invitaciones no está disponible en este momento. Avisa a soporte o intenta más tarde.'
    }

    try {
      const body = await response.clone().json()
      if (typeof body?.message === 'string') return body.message
    } catch {
      // El cuerpo no era JSON — se usa el mensaje genérico de abajo.
    }
  }
  return fallback
}

/**
 * Los errores de create_employee_membership que la persona sí puede
 * corregir ("Esta persona ya tiene acceso a este negocio.", "Una o más
 * sucursales no pertenecen a este negocio.") vienen ya en español desde la
 * base, con código 23505 / 42501. Un 42501 que menciona "row-level
 * security" es un rechazo de RLS en inglés técnico — ese no se muestra.
 */
function friendlyRpcMessage(error: { code?: string; message: string }): string {
  const isActionable =
    (error.code === '23505' || error.code === '42501') &&
    !/row-level security/i.test(error.message)
  return isActionable ? error.message : 'No se pudo guardar el empleado. Revisa tu conexión.'
}

/**
 * Da de alta un empleado NUEVO, con acceso incluido: invita el correo
 * (Edge Function invite-employee, la única pieza que necesita
 * service_role, CLAUDE.md §10) y, con el userId que devuelve, crea
 * membership + membership_branches + employee_details en una sola
 * transacción (RPC create_employee_membership) — con la sesión NORMAL de
 * quien está dando de alta, no con la Edge Function.
 */
export async function inviteAndCreate(input: NewEmployeeInput): Promise<{ membershipId: string }> {
  const { data: invited, error: inviteError } = await supabase.functions.invoke<{
    userId: string
  }>('invite-employee', {
    body: { tenantId: input.tenantId, email: input.email, fullName: input.fullName },
  })

  if (inviteError || !invited) {
    throw new Error(await extractFunctionErrorMessage(inviteError))
  }

  const args: CreateEmployeeMembershipArgs = {
    p_tenant_id: input.tenantId,
    p_user_id: invited.userId,
    p_role: input.role,
    p_branch_ids: input.branchIds,
    p_birth_date: input.birthDate,
    p_curp: input.curp,
    p_rfc: input.rfc,
    p_voter_id_number: input.voterIdNumber,
  }
  const { data: membership, error: rpcError } = await supabase.rpc(
    'create_employee_membership',
    args as Database['public']['Functions']['create_employee_membership']['Args'],
  )

  if (rpcError) throw new Error(friendlyRpcMessage(rpcError))
  return { membershipId: membership.id }
}

export interface EmployeeUpdateInput {
  fullName: string
  role: MemberRole
  isActive: boolean
  branchIds: string[]
  birthDate: string | null
  curp: string | null
  rfc: string | null
  voterIdNumber: string | null
}

/**
 * Reemplaza las sucursales asignadas a una membership por el conjunto
 * `desiredBranchIds`. No se puede "borrar todo e insertar de nuevo": el
 * `unique(membership_id, branch_id)` de la tabla no excluye filas
 * borradas suavemente, así que dar de baja una fila y volver a insertar
 * la MISMA sucursal en la misma operación violaría esa restricción. Se
 * calcula la diferencia real: solo se dan de baja las que ya no están, y
 * solo se insertan las nuevas — las que siguen igual no se tocan.
 */
async function replaceBranchAssignments(
  tenantId: string,
  membershipId: string,
  desiredBranchIds: string[],
): Promise<void> {
  const { data: current, error: fetchError } = await supabase
    .from('membership_branches')
    .select('id, branch_id')
    .eq('membership_id', membershipId)
    .is('deleted_at', null)

  if (fetchError) throw fetchError

  const currentRows = current ?? []
  const currentBranchIds = new Set(currentRows.map((r) => r.branch_id))
  const desiredSet = new Set(desiredBranchIds)

  const idsToRemove = currentRows.filter((r) => !desiredSet.has(r.branch_id)).map((r) => r.id)
  const branchIdsToAdd = desiredBranchIds.filter((id) => !currentBranchIds.has(id))

  if (idsToRemove.length > 0) {
    const { error } = await supabase
      .from('membership_branches')
      .update({ deleted_at: new Date().toISOString() })
      .in('id', idsToRemove)
    if (error) throw error
  }

  if (branchIdsToAdd.length > 0) {
    const { error } = await supabase.from('membership_branches').insert(
      branchIdsToAdd.map((branchId) => ({
        tenant_id: tenantId,
        membership_id: membershipId,
        branch_id: branchId,
      })),
    )
    if (error) throw error
  }
}

/**
 * Edita un empleado que YA tiene acceso: nombre (profiles, identidad
 * compartida — CLAUDE.md §6.1), rol y estado de la membership, sus
 * sucursales, y su ficha personal. A diferencia de inviteAndCreate(), no
 * hay ningún paso con efecto secundario externo (no se manda ningún
 * correo), así que no hace falta una transacción atómica en la base:
 * cuatro escrituras normales alcanzan (CLAUDE.md §11, "simple sobre
 * elegante").
 *
 * employee_details se hace `upsert` porque un empleado sembrado antes de
 * esta fase (los 4 usuarios de demo) puede no tener fila todavía — la
 * primera vez que se edita, se crea; después, se actualiza.
 */
export async function update(
  tenantId: string,
  membershipId: string,
  userId: string,
  input: EmployeeUpdateInput,
): Promise<void> {
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ full_name: input.fullName })
    .eq('id', userId)
  if (profileError) throw profileError

  const { error: membershipError } = await supabase
    .from('memberships')
    .update({ role: input.role, is_active: input.isActive })
    .eq('id', membershipId)
  if (membershipError) throw membershipError

  // El dueño ve todas las sucursales del tenant por rol, sin fila en
  // membership_branches (CLAUDE.md §6.1) — igual criterio que el RPC
  // create_employee_membership usa al dar de alta.
  const branchIdsToApply = input.role === 'owner' ? [] : input.branchIds
  await replaceBranchAssignments(tenantId, membershipId, branchIdsToApply)

  const { error: detailsError } = await supabase.from('employee_details').upsert(
    {
      tenant_id: tenantId,
      membership_id: membershipId,
      birth_date: input.birthDate,
      curp: input.curp,
      rfc: input.rfc,
      voter_id_number: input.voterIdNumber,
    },
    { onConflict: 'membership_id' },
  )
  if (detailsError) throw detailsError
}
