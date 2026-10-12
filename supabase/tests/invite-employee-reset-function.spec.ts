// Prueba la acción `reset_password` de la Edge Function invite-employee
// (Correcciones 1, C1.7) contra Supabase LOCAL de verdad, por HTTP. Mismo
// motivo que invite-employee-function.spec.ts: la función corre en otro
// proceso (Deno), no se puede probar con `pg` ni con rollback.
//
// REQUIERE `supabase functions serve` corriendo (sin él, todas dan 503).
//
// Datos: cada test arma un negocio DESECHABLE con sus propios usuarios y los
// limpia (ver platform-test-helpers.ts). A propósito NO se usa Patitas
// Felices: restablecer la contraseña de `groomer@patitasfelices.mx` dejaría el
// demo local con una contraseña que nadie conoce.
import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { closePool, runCommitted, withTransaction } from './helpers'
import {
  adminClient,
  cleanupPlatformTestData,
  createScratchTenant,
  created,
  freshClient,
  signIn,
  SUPABASE_URL,
  uniqueEmail,
} from './platform-test-helpers'

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/invite-employee`
const OLD_PASSWORD = 'Demo1234!'

afterAll(closePool)
afterEach(cleanupPlatformTestData)

interface CallResult {
  status: number
  body: Record<string, unknown> & { message?: string }
}

async function call(body: unknown, token?: string): Promise<CallResult> {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

interface Member {
  userId: string
  membershipId: string
  email: string
}

/** Crea un usuario de Auth (contraseña conocida) y su membresía en `tenantId`. */
async function createMember(
  tenantId: string,
  role: 'owner' | 'receptionist' | 'groomer' | 'vet',
  options: { isActive?: boolean } = {},
): Promise<Member> {
  const email = uniqueEmail(role)
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password: OLD_PASSWORD,
    email_confirm: true,
  })
  if (error || !data.user) throw error ?? new Error('No se creó el usuario de prueba.')
  created.userIds.add(data.user.id)

  const { rows } = await runCommitted((client) =>
    client.query(
      `insert into memberships (tenant_id, user_id, role, is_active)
       values ($1, $2, $3, $4) returning id`,
      [tenantId, data.user!.id, role, options.isActive ?? true],
    ),
  )
  return { userId: data.user.id, membershipId: rows[0].id, email }
}

/** Le da a un rol el permiso employees:edit en este negocio. */
async function grantEmployeesEdit(tenantId: string, role: string): Promise<void> {
  await runCommitted((client) =>
    client.query(
      `insert into role_permissions (tenant_id, role, module, can_view, can_edit)
       values ($1, $2, 'employees', true, true)`,
      [tenantId, role],
    ),
  )
}

async function tokenFor(email: string): Promise<string> {
  const { session, error } = await signIn(email, OLD_PASSWORD)
  if (error || !session) throw error ?? new Error('Sin sesión.')
  return session.access_token
}

async function mustChangePassword(userId: string): Promise<boolean> {
  const { rows } = await withTransaction((client) =>
    client.query('select must_change_password from profiles where id = $1', [userId]),
  )
  return rows[0].must_change_password
}

async function auditRows(tenantId: string, membershipId: string) {
  const { rows } = await withTransaction((client) =>
    client.query(
      `select actor_user_id, new_data, new_data::text as details
       from audit_log
       where tenant_id = $1 and record_id = $2 and new_data ->> 'event' like 'password_reset%'`,
      [tenantId, membershipId],
    ),
  )
  return rows
}

describe('invite-employee reset_password: quién puede', () => {
  it('el dueño restablece a un empleado: contraseña nueva sirve, la vieja no, y queda con cambio obligatorio', async () => {
    // Es el camino completo. Si la función devolviera una contraseña que no
    // coincide con la guardada, el dueño se la daría al empleado y no
    // podría entrar; si no marcara el cambio obligatorio, el empleado se
    // quedaría con una contraseña que conoce quien la dictó.
    const tenantId = await createScratchTenant()
    const owner = await createMember(tenantId, 'owner')
    const employee = await createMember(tenantId, 'receptionist')

    const { status, body } = await call(
      { action: 'reset_password', tenantId, membershipId: employee.membershipId },
      await tokenFor(owner.email),
    )

    expect(status).toBe(200)
    expect(body.employeeEmail).toBe(employee.email)
    const newPassword = body.temporaryPassword as string
    expect(newPassword).toMatch(/^[A-HJ-NP-Za-km-z2-9]{14}$/)
    expect(body.mustChangeEnforced).toBe(true)

    expect((await signIn(employee.email, newPassword)).error).toBeNull()
    expect((await signIn(employee.email, OLD_PASSWORD)).error).not.toBeNull()
    expect(await mustChangePassword(employee.userId)).toBe(true)
  })

  it('cierra las sesiones abiertas del empleado (su refresh token ya no sirve)', async () => {
    // Si alguien más estaba dentro con la contraseña vieja, restablecerla no
    // lo saca por sí sola: hay que cerrar sus sesiones o seguiría adentro.
    const tenantId = await createScratchTenant()
    const owner = await createMember(tenantId, 'owner')
    const employee = await createMember(tenantId, 'groomer')

    const open = await signIn(employee.email, OLD_PASSWORD)
    const oldRefresh = open.session!.refresh_token

    const { status, body } = await call(
      { action: 'reset_password', tenantId, membershipId: employee.membershipId },
      await tokenFor(owner.email),
    )
    expect(status).toBe(200)
    expect(body.sessionsRevoked).toBe(true)

    const { error } = await freshClient().auth.refreshSession({ refresh_token: oldRefresh })
    expect(error).not.toBeNull()
  })

  it('queda en la bitácora quién restableció a quién, sin la contraseña', async () => {
    // Una contraseña cambiada sin rastro es justo lo que la bitácora evita.
    // Y si la contraseña quedara escrita ahí, la leería cualquier dueño
    // después: dejaría de ser "se muestra una sola vez".
    const tenantId = await createScratchTenant()
    const owner = await createMember(tenantId, 'owner')
    const employee = await createMember(tenantId, 'vet')

    const { body } = await call(
      { action: 'reset_password', tenantId, membershipId: employee.membershipId },
      await tokenFor(owner.email),
    )

    const rows = await auditRows(tenantId, employee.membershipId)
    expect(rows).toHaveLength(1)
    expect(rows[0].actor_user_id).toBe(owner.userId)
    expect(rows[0].new_data.event).toBe('password_reset')
    expect(rows[0].new_data.target_user_id).toBe(employee.userId)
    expect(rows[0].details).not.toContain(body.temporaryPassword as string)
    expect(rows[0].details).not.toContain(OLD_PASSWORD)
  })

  it('un rol con employees:edit (no dueño) también puede restablecer a un empleado', async () => {
    // El permiso es DATO (role_permissions), no "solo el dueño". Si la
    // función comparara contra 'owner' a secas, darle el permiso a
    // recepción en la pantalla de permisos no serviría de nada.
    const tenantId = await createScratchTenant()
    await createMember(tenantId, 'owner')
    const receptionist = await createMember(tenantId, 'receptionist')
    const groomer = await createMember(tenantId, 'groomer')
    await grantEmployeesEdit(tenantId, 'receptionist')

    const { status } = await call(
      { action: 'reset_password', tenantId, membershipId: groomer.membershipId },
      await tokenFor(receptionist.email),
    )
    expect(status).toBe(200)
  })

  it('un rol SIN employees:edit recibe 403 y la contraseña del objetivo no cambia', async () => {
    // Es la revalidación del paso 1. Sin ella, cualquier empleado podría
    // tomar la cuenta de un compañero cambiándole la contraseña.
    const tenantId = await createScratchTenant()
    await createMember(tenantId, 'owner')
    const receptionist = await createMember(tenantId, 'receptionist')
    const groomer = await createMember(tenantId, 'groomer')

    const { status, body } = await call(
      { action: 'reset_password', tenantId, membershipId: groomer.membershipId },
      await tokenFor(receptionist.email),
    )

    expect(status).toBe(403)
    expect(body.message).toMatch(/no tienes permiso/i)
    expect(body.temporaryPassword).toBeUndefined()
    expect((await signIn(groomer.email, OLD_PASSWORD)).error).toBeNull()
    expect(await auditRows(tenantId, groomer.membershipId)).toHaveLength(0)
  })

  it('el dueño de OTRO negocio recibe 403 (no es miembro de ese negocio)', async () => {
    // Aislamiento entre negocios: ser dueño en un lado no da ningún poder en
    // el otro. Mismo mensaje genérico que cualquier "sin permiso".
    const tenantA = await createScratchTenant('Negocio A')
    const tenantB = await createScratchTenant('Negocio B')
    await createMember(tenantA, 'owner')
    const ownerB = await createMember(tenantB, 'owner')
    const employeeA = await createMember(tenantA, 'groomer')

    const { status, body } = await call(
      { action: 'reset_password', tenantId: tenantA, membershipId: employeeA.membershipId },
      await tokenFor(ownerB.email),
    )

    expect(status).toBe(403)
    expect(body.message).toMatch(/no tienes permiso/i)
    expect((await signIn(employeeA.email, OLD_PASSWORD)).error).toBeNull()
  })

  it('una membresía de otro negocio, pedida con MI negocio, no se encuentra (404) y no se toca', async () => {
    // El objetivo debe pertenecer al negocio de quien llama. Si solo se
    // revisara el permiso del llamador, un dueño podría restablecer a
    // cualquier persona de la plataforma con solo conocer su membershipId.
    const tenantA = await createScratchTenant('Negocio A')
    const tenantB = await createScratchTenant('Negocio B')
    const ownerA = await createMember(tenantA, 'owner')
    const employeeB = await createMember(tenantB, 'groomer')

    const { status, body } = await call(
      { action: 'reset_password', tenantId: tenantA, membershipId: employeeB.membershipId },
      await tokenFor(ownerA.email),
    )

    expect(status).toBe(404)
    expect(body.temporaryPassword).toBeUndefined()
    expect((await signIn(employeeB.email, OLD_PASSWORD)).error).toBeNull()
  })
})

describe('invite-employee reset_password: a quién NO', () => {
  it('uno mismo → 409 y su contraseña no cambia', async () => {
    // Cambiarse la propia contraseña por esta vía lo dejaría fuera con una
    // contraseña que él mismo vio en pantalla; para eso existe "Cambiar
    // contraseña". También evita un cierre de sesión accidental.
    const tenantId = await createScratchTenant()
    await createMember(tenantId, 'owner')
    const receptionist = await createMember(tenantId, 'receptionist')
    await grantEmployeesEdit(tenantId, 'receptionist')

    const { status, body } = await call(
      { action: 'reset_password', tenantId, membershipId: receptionist.membershipId },
      await tokenFor(receptionist.email),
    )

    expect(status).toBe(409)
    expect(body.message).toMatch(/tu propia contraseña/i)
    expect((await signIn(receptionist.email, OLD_PASSWORD)).error).toBeNull()
  })

  it('al dueño → 409 aunque quien llama tenga employees:edit', async () => {
    // A los dueños los restablece la plataforma (§7.5). Si un empleado con
    // permiso pudiera restablecer al dueño, tomaría la cuenta con más poder
    // del negocio.
    const tenantId = await createScratchTenant()
    const owner = await createMember(tenantId, 'owner')
    const receptionist = await createMember(tenantId, 'receptionist')
    await grantEmployeesEdit(tenantId, 'receptionist')

    const { status, body } = await call(
      { action: 'reset_password', tenantId, membershipId: owner.membershipId },
      await tokenFor(receptionist.email),
    )

    expect(status).toBe(409)
    expect(body.message).toMatch(/dueño/i)
    expect((await signIn(owner.email, OLD_PASSWORD)).error).toBeNull()
  })

  it('a una membresía inactiva → 409', async () => {
    // Un empleado dado de baja no debería recibir contraseñas nuevas: se
    // activa primero y se restablece después.
    const tenantId = await createScratchTenant()
    const owner = await createMember(tenantId, 'owner')
    const inactive = await createMember(tenantId, 'groomer', { isActive: false })

    const { status } = await call(
      { action: 'reset_password', tenantId, membershipId: inactive.membershipId },
      await tokenFor(owner.email),
    )

    expect(status).toBe(409)
    expect((await signIn(inactive.email, OLD_PASSWORD)).error).toBeNull()
  })
})

describe('invite-employee reset_password: cuerpo mal formado', () => {
  it('sin membershipId → 400', async () => {
    // Debe frenarse antes de tocar nada; sin esto "restablecer" a nadie
    // podría terminar en un error de base poco claro.
    const tenantId = await createScratchTenant()
    const owner = await createMember(tenantId, 'owner')

    const { status, body } = await call(
      { action: 'reset_password', tenantId },
      await tokenFor(owner.email),
    )

    expect(status).toBe(400)
    expect(body.message).toMatch(/inválida/i)
  })
})
