import { supabase } from './supabase'

export type MemberRole = 'owner' | 'receptionist' | 'groomer' | 'vet'

export interface BranchSummary {
  id: string
  name: string
  /** Zona horaria IANA de la sucursal (CLAUDE.md §8.3) — la necesita useAgendaStore (fase 3). */
  timezone: string
}

export interface MembershipSummary {
  membershipId: string
  tenantId: string
  tenantName: string
  tenantTimezone: string
  role: MemberRole
  branches: BranchSummary[]
}

/**
 * Negocios (tenants) a los que pertenece `userId`, con su rol y las
 * sucursales a las que tiene acceso en cada uno.
 *
 * Nota sobre RLS: la política de "memberships" te deja ver TODAS las
 * membresías de un tenant al que perteneces, no solo la tuya — es a
 * propósito, para que un colega pueda ver el nombre de otro colega del
 * mismo negocio (composición con la política de "profiles", ver la
 * migración rls_tenancy). Eso significa que el `.eq('user_id', userId)`
 * de abajo NO es opcional aunque "ya esté protegido por RLS": RLS evita
 * que veas negocios AJENOS, pero sigue siendo trabajo de la consulta
 * pedir exactamente lo que necesita dentro de los tuyos.
 */
export async function listMyMemberships(userId: string): Promise<MembershipSummary[]> {
  const { data, error } = await supabase
    .from('memberships')
    .select(
      `
      id,
      role,
      tenant_id,
      tenants ( name, timezone ),
      membership_branches ( branches ( id, name, timezone ) )
    `,
    )
    .eq('user_id', userId)
    .eq('is_active', true)

  if (error) throw error

  const summaries: MembershipSummary[] = []

  for (const row of data ?? []) {
    if (!row.tenants) continue // no debería pasar (la FK es NOT NULL), pero TS no lo sabe

    let branches: BranchSummary[] = (row.membership_branches ?? [])
      .map((mb) => mb.branches)
      .filter((b): b is BranchSummary => b !== null)

    if (row.role === 'owner') {
      // El dueño no tiene filas en membership_branches: ve todas las
      // sucursales de su tenant por rol (CLAUDE.md §6.1), así que se
      // piden aparte en vez de depender de esa tabla.
      branches = await listAllBranches(row.tenant_id)
    }

    summaries.push({
      membershipId: row.id,
      tenantId: row.tenant_id,
      tenantName: row.tenants.name,
      tenantTimezone: row.tenants.timezone,
      role: row.role,
      branches,
    })
  }

  return summaries
}

async function listAllBranches(tenantId: string): Promise<BranchSummary[]> {
  const { data, error } = await supabase
    .from('branches')
    .select('id, name, timezone')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('name')

  if (error) throw error
  return data ?? []
}

export interface EmployeeSummary {
  userId: string
  fullName: string
  role: MemberRole
}

/**
 * Quién puede atender citas en ESTA sucursal (fase 3: el filtro de
 * empleado de la agenda, y el paso "empleado y horario" de agendar una
 * cita nueva). "owner" ve todas las sucursales de su tenant sin fila en
 * membership_branches (mismo criterio que listMyMemberships) — se pide
 * todo el tenant y se filtra aquí en vez de hacerlo en dos consultas
 * separadas, porque a esta escala (unas decenas de personas por
 * negocio) es más simple que más rápido.
 */
export async function listBranchEmployees(
  tenantId: string,
  branchId: string,
): Promise<EmployeeSummary[]> {
  const { data, error } = await supabase
    .from('memberships')
    .select(
      `
      user_id,
      role,
      profiles ( full_name ),
      membership_branches ( branch_id )
    `,
    )
    .eq('tenant_id', tenantId)
    .eq('is_active', true)

  if (error) throw error

  return (data ?? [])
    .filter(
      (m) => m.role === 'owner' || m.membership_branches.some((mb) => mb.branch_id === branchId),
    )
    .map((m) => ({
      userId: m.user_id,
      fullName: m.profiles?.full_name ?? '(sin nombre)',
      role: m.role,
    }))
}
