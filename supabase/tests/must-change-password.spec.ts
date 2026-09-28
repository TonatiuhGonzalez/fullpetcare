// Prueba la "contraseña temporal obligatoria" (migración
// 20260925130000_must_change_password.sql) con usuarios REALES de Auth.
//
// Por qué no basta con probar la pantalla: la pantalla solo es comodidad. Lo
// que de verdad obliga es la base. Una persona con contraseña temporal podría
// abrir la consola del navegador y llamar a la API directo; estos tests
// comprueban que aun así no ve nada de negocio y que no puede apagarse la
// marca ella sola.
//
// Los usuarios se crean con `adminClient` y `app_metadata.must_change_password`
// (exactamente como lo hace la Edge Function platform-admin) y se borran al
// terminar; ver platform-test-helpers.ts para la limpieza.
import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { closePool, runCommitted, withTransaction } from './helpers'
import {
  adminClient,
  cleanupPlatformTestData,
  createScratchTenant,
  created,
  signIn,
  uniqueEmail,
} from './platform-test-helpers'

afterAll(closePool)
afterEach(cleanupPlatformTestData)

const TEMP_PASSWORD = 'Temporal1234'
const OWN_PASSWORD = 'MiPropia5678'

async function readFlag(userId: string): Promise<boolean> {
  const { rows } = await withTransaction((client) =>
    client.query('select must_change_password from profiles where id = $1', [userId]),
  )
  return rows[0].must_change_password
}

/** Crea un usuario; con `temporary` nace marcado, igual que un dueño recién dado de alta. */
async function createUser(temporary: boolean) {
  const email = uniqueEmail('temporal')
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password: TEMP_PASSWORD,
    email_confirm: true,
    ...(temporary ? { app_metadata: { must_change_password: true } } : {}),
  })
  if (error || !data.user) throw error ?? new Error('No se creó el usuario de prueba.')
  created.userIds.add(data.user.id)
  return { userId: data.user.id, email }
}

/** Un usuario dueño de un negocio desechable: sirve para ver si "ve" su membresía. */
async function createOwner(temporary: boolean) {
  const user = await createUser(temporary)
  const tenantId = await createScratchTenant()
  await runCommitted((client) =>
    client.query(
      `insert into memberships (tenant_id, user_id, role, is_active) values ($1, $2, 'owner', true)`,
      [tenantId, user.userId],
    ),
  )
  return { ...user, tenantId }
}

describe('contraseña temporal obligatoria', () => {
  it('un usuario creado con app_metadata queda marcado; uno normal no', async () => {
    // Es el punto de entrada: si el alta no marcara, nada más de esta
    // función se activaría y la temporal valdría para siempre, como antes.
    // Y si marcara a todos, cada empleado invitado quedaría bloqueado.
    const temporary = await createUser(true)
    const normal = await createUser(false)

    expect(await readFlag(temporary.userId)).toBe(true)
    expect(await readFlag(normal.userId)).toBe(false)
  })

  it('iniciar sesión con la temporal NO apaga la marca', async () => {
    // Caso borde real: GoTrue actualiza auth.users al iniciar sesión (y puede
    // re-hashear la contraseña). Si eso apagara la marca, el primer login
    // bastaría para saltarse el cambio.
    const { userId, email } = await createUser(true)

    const { error } = await signIn(email, TEMP_PASSWORD)

    expect(error).toBeNull()
    expect(await readFlag(userId)).toBe(true)
  })

  it('mientras está marcada, la base no le muestra su negocio; al cambiar la contraseña sí', async () => {
    // Es EL bloqueo. Si is_member_of() no lo respetara, una persona con
    // temporal vería y escribiría datos de negocio llamando a la API directo.
    // La segunda mitad importa igual: al cambiar la contraseña debe recuperar
    // el acceso sin volver a iniciar sesión.
    const { email, tenantId } = await createOwner(true)
    const { client } = await signIn(email, TEMP_PASSWORD)

    const before = await client
      .from('memberships')
      .select('tenant_id')
      .eq('tenant_id', tenantId)
    expect(before.error).toBeNull()
    expect(before.data).toHaveLength(0)

    const { error: updateError } = await client.auth.updateUser({
      password: OWN_PASSWORD,
    })
    expect(updateError).toBeNull()

    const after = await client
      .from('memberships')
      .select('tenant_id')
      .eq('tenant_id', tenantId)
    expect(after.data).toHaveLength(1)
  })

  it('cambiar la contraseña apaga la marca', async () => {
    // Es lo que "libera" a la persona. Si no se apagara, quedaría bloqueada
    // aunque ya haya elegido una contraseña propia.
    const { userId, email } = await createUser(true)
    const { client } = await signIn(email, TEMP_PASSWORD)

    await client.auth.updateUser({ password: OWN_PASSWORD })

    expect(await readFlag(userId)).toBe(false)
  })

  it('la persona no puede apagar la marca por su cuenta desde la API', async () => {
    // Sin permisos por columna, profiles_update (que deja editar la propia
    // fila) permitiría `update profiles set must_change_password = false` y
    // saltarse todo el cambio obligatorio.
    const { userId, email } = await createUser(true)
    const { client } = await signIn(email, TEMP_PASSWORD)

    const { error } = await client
      .from('profiles')
      .update({ must_change_password: false })
      .eq('id', userId)

    expect(error).not.toBeNull()
    expect(await readFlag(userId)).toBe(true)
  })

  it('sigue pudiendo editar su nombre (los permisos por columna no rompen el perfil)', async () => {
    // Revocar UPDATE a nivel tabla es un cambio grueso: este test asegura que
    // las columnas de perfil siguen editables (pantalla de empleados, etc.).
    const { userId, email } = await createUser(false)
    const { client } = await signIn(email, TEMP_PASSWORD)

    const { error } = await client
      .from('profiles')
      .update({ full_name: 'Nombre Nuevo' })
      .eq('id', userId)

    expect(error).toBeNull()
  })

  it('un superadmin marcado no puede usar las RPC de plataforma hasta cambiar su contraseña', async () => {
    // is_platform_admin() es la puerta de todo el panel. Un superadmin recién
    // creado con temporal no debe poder administrar empresas antes de elegir
    // su propia contraseña.
    const { userId, email } = await createUser(true)
    await adminClient.from('platform_admins').insert({ user_id: userId })
    const { client } = await signIn(email, TEMP_PASSWORD)

    const blocked = await client.rpc('platform_list_admins')
    expect(blocked.error).not.toBeNull()

    await client.auth.updateUser({ password: OWN_PASSWORD })

    const allowed = await client.rpc('platform_list_admins')
    expect(allowed.error).toBeNull()
  })
})
