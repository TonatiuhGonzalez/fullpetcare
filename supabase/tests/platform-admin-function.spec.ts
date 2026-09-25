// Prueba la Edge Function platform-admin (fase 10, tarea 10.5) contra
// Supabase LOCAL de verdad, por HTTP. Mismo motivo que
// invite-employee-function.spec.ts: la función corre en otro proceso (Deno)
// con su propia conexión, no se puede probar con `pg` ni con rollback.
//
// REQUIERE `supabase functions serve` corriendo (sin él, todas dan 503).
//
// La limpieza de lo que crean estos tests (y por qué hace falta) está
// explicada en platform-test-helpers.ts.
import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { closePool, runCommitted, withTransaction } from './helpers'
import { NONEXISTENT_UUID, TENANT_PATITAS } from './fixtures'
import {
  adminClient,
  cleanupPlatformTestData,
  clientWithToken,
  created,
  createSuperadmin,
  freshClient,
  signIn,
  SUPABASE_URL,
  uniqueEmail,
} from './platform-test-helpers'

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/platform-admin`

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

const validCreateTenant = (ownerEmail: string) => ({
  action: 'create_tenant',
  tenantName: 'Estética Prueba',
  branchName: 'Matriz',
  ownerFullName: 'Ana Prueba',
  ownerEmail,
  ownerPhone: '5512345678',
})

/** Crea un negocio por la función y registra lo creado para la limpieza. */
async function createTenantViaFunction(token: string, ownerEmail: string) {
  const result = await call(validCreateTenant(ownerEmail), token)
  expect(result.status).toBe(200)
  const tenantId = result.body.tenantId as string
  const ownerUserId = result.body.ownerUserId as string
  created.tenantIds.add(tenantId)
  created.userIds.add(ownerUserId)
  return { tenantId, ownerUserId, password: result.body.temporaryPassword as string }
}

async function countAuthUsersByEmail(email: string): Promise<number> {
  return withTransaction(async (client) => {
    const { rows } = await client.query('select count(*)::int as n from auth.users where email = $1', [
      email,
    ])
    return rows[0].n
  })
}

async function countTenants(): Promise<number> {
  return withTransaction(async (client) => {
    const { rows } = await client.query('select count(*)::int as n from tenants')
    return rows[0].n
  })
}

describe('platform-admin: sin sesión o sin ser superadmin', () => {
  it('sin Authorization header se rechaza (401 de la plataforma o 403 de la función)', async () => {
    // Hay DOS capas (mismo comentario que invite-employee): con
    // verify_jwt = true rechaza la plataforma (401); con --no-verify-jwt
    // rechaza la función (403). Lo que importa es que sin sesión NUNCA se
    // crea nada.
    const { status } = await call(validCreateTenant(uniqueEmail('sinsesion')))
    expect([401, 403]).toContain(status)
  })

  it.each([
    ['create_tenant', validCreateTenant('intruso.dueno@fullpetcare.test')],
    ['reset_password', { action: 'reset_password', tenantId: TENANT_PATITAS }],
    ['add_admin', { action: 'add_admin', fullName: 'Intruso', email: 'intruso.admin@fullpetcare.test' }],
  ])('%s: el dueño de un negocio recibe 403 y no se crea ni cambia nada', async (_action, body) => {
    // Es la revalidación del paso 1: dueno@patitasfelices.mx es la persona
    // con más poder DENTRO de un negocio, y aun así no puede usar ninguna
    // acción de plataforma. Si esto fallara, cualquier dueño podría crear
    // negocios, agregarse como superadmin o cambiar la contraseña de otro
    // dueño (y tomar su cuenta).
    const owner = await signIn('dueno@patitasfelices.mx', 'Demo1234!')
    const tenantsBefore = await countTenants()

    const { status, body: response } = await call(body, owner.session!.access_token)

    expect(status).toBe(403)
    expect(response.message).toMatch(/no tienes permiso/i)
    expect(await countTenants()).toBe(tenantsBefore)
    expect(await countAuthUsersByEmail('intruso.dueno@fullpetcare.test')).toBe(0)
    expect(await countAuthUsersByEmail('intruso.admin@fullpetcare.test')).toBe(0)
    // Y la contraseña del dueño de Patitas sigue siendo la de siempre.
    const stillWorks = await signIn('dueno@patitasfelices.mx', 'Demo1234!')
    expect(stillWorks.error).toBeNull()
  })

  it.each([
    ['create_tenant', validCreateTenant('dueno@patitasfelices.mx')],
    ['add_admin', { action: 'add_admin', fullName: 'Sondeo', email: 'dueno@patitasfelices.mx' }],
  ])('%s: quien NO es superadmin recibe 403 aunque el correo ya exista (no se puede sondear qué correos están registrados)', async (_action, body) => {
    // Si la función revisara "¿ya existe este correo?" ANTES de "¿eres
    // superadmin?", un usuario con sesión recibiría 409 para un correo
    // registrado y otra respuesta para uno que no: una forma gratuita de
    // averiguar qué personas tienen cuenta. Las RPC son una segunda capa que
    // igual rechazaría, pero solo DESPUÉS de haber creado y borrado un
    // usuario de Auth — este test exige que el rechazo ocurra primero y sea
    // idéntico en ambos casos.
    const groomer = await signIn('groomer@patitasfelices.mx', 'Demo1234!')
    const { status, body: response } = await call(body, groomer.session!.access_token)
    expect(status).toBe(403)
    expect(response.message).toMatch(/no tienes permiso/i)
  })

  it('un superadmin al que ya se le quitó el acceso recibe 403', async () => {
    // Quitar a un superadmin debe cortar TODO al instante, aunque su
    // sesión siga abierta (su token seguirá siendo válido un rato).
    const admin = await createSuperadmin()
    await adminClient
      .from('platform_admins')
      .update({ deleted_at: new Date().toISOString() })
      .eq('user_id', admin.userId)

    const { status } = await call(validCreateTenant(uniqueEmail('exadmin')), admin.token)
    expect(status).toBe(403)
  })
})

describe('platform-admin: solicitud inválida', () => {
  it.each([
    ['acción desconocida', { action: 'borrar_todo' }],
    ['sin acción', { tenantName: 'x' }],
    ['create_tenant sin nombre de sucursal', { ...validCreateTenant('a@b.mx'), branchName: '  ' }],
    ['create_tenant con correo sin forma de correo', { ...validCreateTenant('no-es-correo') }],
    ['reset_password sin tenantId', { action: 'reset_password' }],
    ['add_admin sin nombre', { action: 'add_admin', email: 'a@b.mx' }],
  ])('%s → 400 y no se crea nada', async (_caso, body) => {
    // Un cuerpo mal formado debe frenarse ANTES de crear el usuario de
    // Auth: si no, quedarían cuentas huérfanas por cada formulario mal
    // llenado.
    const admin = await createSuperadmin()
    const { status, body: response } = await call(body, admin.token)
    expect(status).toBe(400)
    expect(response.message).toMatch(/inválida/i)
  })
})

describe('platform-admin: create_tenant', () => {
  it('crea negocio + sucursal + dueño y devuelve una contraseña temporal que SÍ sirve para entrar', async () => {
    // Es el alta completa de punta a punta. La comprobación clave es que
    // el dueño puede iniciar sesión con la contraseña devuelta y ve SU
    // negocio: si la función devolviera una contraseña que no coincide con
    // la del usuario creado, el negocio existiría pero nadie podría entrar.
    const admin = await createSuperadmin()
    const ownerEmail = uniqueEmail('dueno.nuevo')

    const { tenantId, password } = await createTenantViaFunction(admin.token, ownerEmail)
    expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]{14}$/)

    const owner = await signIn(ownerEmail, password)
    expect(owner.error).toBeNull()
    const { data: tenants } = await owner.client.from('tenants').select('id, name')
    expect(tenants).toEqual([{ id: tenantId, name: 'Estética Prueba' }])

    // La lista de plataforma lo muestra con el dueño capturado.
    const { data: listed } = await clientWithToken(admin.token).rpc('platform_list_tenants')
    const row = (listed as { tenant_id: string }[]).find((t) => t.tenant_id === tenantId)
    expect(row).toMatchObject({
      name: 'Estética Prueba',
      owner_name: 'Ana Prueba',
      owner_email: ownerEmail,
      owner_phone: '5512345678',
      plan: 'Básico',
      status: 'active',
    })
  })

  it.each([
    ['isDemo: true', { isDemo: true }, true],
    ['sin isDemo', {}, false],
    ["isDemo: 'true' (texto, no booleano)", { isDemo: 'true' }, false],
  ])('marca la empresa como demo solo con %s', async (_label, extra, expected) => {
    // Es la marca que usa demo:reset para decidir qué ocultar. Solo el
    // booleano `true` la activa: cualquier otra cosa (falta, texto, número)
    // deja la empresa como REAL. Si un valor raro la marcara como demo, un
    // cliente real podría desaparecer en el siguiente reset.
    const admin = await createSuperadmin()
    const ownerEmail = uniqueEmail('dueno.demo')

    const result = await call({ ...validCreateTenant(ownerEmail), ...extra }, admin.token)
    expect(result.status).toBe(200)
    created.tenantIds.add(result.body.tenantId as string)
    created.userIds.add(result.body.ownerUserId as string)

    const { rows } = await withTransaction((client) =>
      client.query('select is_demo from tenant_platform_info where tenant_id = $1', [
        result.body.tenantId,
      ]),
    )
    expect(rows).toEqual([{ is_demo: expected }])
  })

  it('un correo YA registrado se rechaza con 409 y NO toca la cuenta existente', async () => {
    // Decisión 3 de la fase: aquí se le pone una contraseña nueva al
    // usuario, y hacerlo sobre una cuenta que ya existe (p. ej. el dueño
    // de OTRO negocio) sería secuestrarla. Se prueba con el dueño real de
    // Patitas: debe seguir entrando con su contraseña de siempre y no
    // debe haberse creado ningún negocio.
    const admin = await createSuperadmin()
    const tenantsBefore = await countTenants()

    const { status, body } = await call(validCreateTenant('dueno@patitasfelices.mx'), admin.token)

    expect(status).toBe(409)
    expect(body.message).toMatch(/ya está registrado/i)
    expect(await countTenants()).toBe(tenantsBefore)
    const stillWorks = await signIn('dueno@patitasfelices.mx', 'Demo1234!')
    expect(stillWorks.error).toBeNull()
  })

  it('el alta queda en la bitácora con el SUPERADMIN como actor (no "nadie")', async () => {
    // Por eso la función llama la RPC con el JWT de quien llama y no con
    // service_role: con service_role, auth.uid() es NULL y la bitácora
    // diría que nadie dio de alta esa empresa.
    const admin = await createSuperadmin()
    const { tenantId } = await createTenantViaFunction(admin.token, uniqueEmail('dueno.bitacora'))

    const rows = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `select action, actor_user_id from platform_audit_log
         where tenant_id = $1 and table_name = 'tenant_platform_info'`,
        [tenantId],
      )
      return rows
    })
    expect(rows).toEqual([{ action: 'INSERT', actor_user_id: admin.userId }])
  })
})

describe('platform-admin: reset_password', () => {
  it('cambia la contraseña, invalida la vieja, cierra las sesiones abiertas y no deja la contraseña en la bitácora', async () => {
    // Es la acción más delicada del panel. Se verifica todo lo que
    // promete: (1) la contraseña nueva funciona, (2) la vieja ya no,
    // (3) el refresh token de una sesión que el dueño tenía abierta deja de
    // servir — si alguien más estaba dentro con la contraseña vieja, queda
    // fuera —, (4) queda registro con el superadmin como actor, y (5) la
    // contraseña NUNCA se escribe en la bitácora.
    const admin = await createSuperadmin()
    const ownerEmail = uniqueEmail('dueno.reset')
    const { tenantId, password: oldPassword } = await createTenantViaFunction(admin.token, ownerEmail)

    const openSession = await signIn(ownerEmail, oldPassword)
    expect(openSession.error).toBeNull()
    const oldRefreshToken = openSession.session!.refresh_token

    const { status, body } = await call({ action: 'reset_password', tenantId }, admin.token)

    expect(status).toBe(200)
    expect(body.ownerEmail).toBe(ownerEmail)
    expect(body.sessionsRevoked).toBe(true)
    const newPassword = body.temporaryPassword as string
    expect(newPassword).not.toBe(oldPassword)

    expect((await signIn(ownerEmail, newPassword)).error).toBeNull()
    expect((await signIn(ownerEmail, oldPassword)).error).not.toBeNull()

    const { error: refreshError } = await freshClient().auth.refreshSession({
      refresh_token: oldRefreshToken,
    })
    expect(refreshError).not.toBeNull()

    const audit = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `select actor_user_id, new_data::text as details
         from platform_audit_log where tenant_id = $1 and event = 'password_reset'`,
        [tenantId],
      )
      return rows
    })
    expect(audit).toHaveLength(1)
    expect(audit[0].actor_user_id).toBe(admin.userId)
    expect(audit[0].details).toContain(ownerEmail)
    expect(audit[0].details).not.toContain(newPassword)
    expect(audit[0].details).not.toContain(oldPassword)
  })

  it('una empresa sin dueño activo da 404 con un mensaje claro', async () => {
    // Sin este caso la función intentaría cambiarle la contraseña a
    // "nadie" y devolvería una contraseña temporal que no sirve para nada.
    const admin = await createSuperadmin()
    await runCommitted((client) =>
      client.query("insert into tenants (id, name) values ($1, 'Sin dueño SA')", [NONEXISTENT_UUID]),
    )
    created.tenantIds.add(NONEXISTENT_UUID)

    const { status, body } = await call({ action: 'reset_password', tenantId: NONEXISTENT_UUID }, admin.token)

    expect(status).toBe(404)
    expect(body.message).toMatch(/no tiene un dueño activo/i)
    expect(body.temporaryPassword).toBeUndefined()
  })
})

describe('platform-admin: add_admin', () => {
  it('crea un superadmin nuevo que entra con la contraseña temporal y ve a los demás superadmins', async () => {
    // Prueba de punta a punta: usuario de Auth + fila en platform_admins +
    // la nueva persona ya puede usar las RPC de plataforma.
    const admin = await createSuperadmin()
    const email = uniqueEmail('admin.nuevo')

    const { status, body } = await call(
      { action: 'add_admin', fullName: 'Admin Nuevo', email },
      admin.token,
    )
    expect(status).toBe(200)
    created.userIds.add(body.userId as string)

    const newAdmin = await signIn(email, body.temporaryPassword as string)
    expect(newAdmin.error).toBeNull()
    const { data: admins, error } = await newAdmin.client.rpc('platform_list_admins')
    expect(error).toBeNull()
    expect((admins as { email: string }[]).map((a) => a.email)).toEqual(
      expect.arrayContaining([admin.email, email]),
    )
  })

  it('un correo YA registrado se rechaza con 409 (no se convierte en superadmin una cuenta ajena)', async () => {
    // Si el dueño de Patitas pudiera volverse superadmin solo porque
    // alguien escribió su correo, se saltarían las dos decisiones de la
    // fase (los superadmins son cuentas propias de plataforma).
    const admin = await createSuperadmin()

    const { status } = await call(
      { action: 'add_admin', fullName: 'Dueño', email: 'dueno@patitasfelices.mx' },
      admin.token,
    )

    expect(status).toBe(409)
    const owner = await signIn('dueno@patitasfelices.mx', 'Demo1234!')
    const { error } = await owner.client.rpc('platform_list_admins')
    expect(error?.message).toMatch(/No tienes permiso/i)
  })
})
