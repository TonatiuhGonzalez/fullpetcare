// Prueba services/auth.ts#changePassword contra el Supabase LOCAL, con el
// cliente real de supabase-js (el mismo camino que usa el diálogo "Cambiar
// contraseña").
//
// Cada test crea su propio usuario desechable con `adminClient` (llave de
// servicio) y lo borra al terminar: cambiar la contraseña de un usuario de la
// semilla dejaría la base local con una contraseña distinta a la que documenta
// el README, y rompería los demás tests y las demos.
import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { changePassword, InvalidCurrentPasswordError } from '@/services/auth'
import { supabase } from '@/services/supabase'
import { closePool } from './helpers'
import { adminClient, cleanupPlatformTestData, created, signIn, uniqueEmail } from './platform-test-helpers'

afterAll(closePool)

afterEach(async () => {
  await supabase.auth.signOut()
  await cleanupPlatformTestData()
})

const OLD_PASSWORD = 'ContraseñaVieja1'
const NEW_PASSWORD = 'ContraseñaNueva2'

/** Crea un usuario con OLD_PASSWORD y deja la sesión de `supabase` iniciada con él. */
async function signedInUser() {
  const email = uniqueEmail('cambio.clave')
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password: OLD_PASSWORD,
    email_confirm: true,
  })
  if (error || !data.user) throw error ?? new Error('no se creó el usuario de prueba')
  created.userIds.add(data.user.id)

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password: OLD_PASSWORD,
  })
  if (signInError) throw signInError
  return { email, userId: data.user.id }
}

describe('changePassword', () => {
  it('con la contraseña actual correcta, la nueva sirve para entrar y la vieja ya no', async () => {
    // Es el caso completo: si la vieja siguiera valiendo, "cambiar" no
    // cambiaría nada; si la nueva no sirviera, la persona quedaría fuera de
    // su cuenta después de pulsar el botón.
    const { email } = await signedInUser()

    await changePassword(email, OLD_PASSWORD, NEW_PASSWORD)

    expect((await signIn(email, NEW_PASSWORD)).error).toBeNull()
    expect((await signIn(email, OLD_PASSWORD)).error).not.toBeNull()
  })

  it('con la contraseña actual equivocada lanza InvalidCurrentPasswordError y NO cambia nada', async () => {
    // Esta comprobación es la razón de que el servicio verifique la actual
    // en vez de llamar solo a updateUser: sin ella, una sesión olvidada en
    // un equipo compartido bastaría para cambiarle la contraseña al dueño.
    const { email } = await signedInUser()

    await expect(changePassword(email, 'no-es-esta', NEW_PASSWORD)).rejects.toBeInstanceOf(
      InvalidCurrentPasswordError,
    )

    expect((await signIn(email, OLD_PASSWORD)).error).toBeNull()
    expect((await signIn(email, NEW_PASSWORD)).error).not.toBeNull()
  })

  it('rechaza una contraseña nueva igual a la actual', async () => {
    // Borde: el servidor lo prohíbe (`same_password`). La UI depende de ese
    // código para mostrar el mensaje en español; si Supabase dejara de
    // mandarlo, la persona vería un error genérico.
    const { email } = await signedInUser()

    await expect(changePassword(email, OLD_PASSWORD, OLD_PASSWORD)).rejects.toMatchObject({
      code: 'same_password',
    })
  })

  it('cierra las OTRAS sesiones de la cuenta y conserva la actual', async () => {
    // Si alguien más tenía la contraseña vieja (o una sesión abierta con
    // ella), cambiarla debe dejarlo fuera. Y la persona que la cambió NO
    // debe quedarse fuera de su propia sesión.
    const { email } = await signedInUser()
    const other = await signIn(email, OLD_PASSWORD)
    expect(other.error).toBeNull()

    await changePassword(email, OLD_PASSWORD, NEW_PASSWORD)

    const otherAfter = await other.client.auth.getUser()
    expect(otherAfter.error).not.toBeNull()
    const currentAfter = await supabase.auth.getUser()
    expect(currentAfter.error).toBeNull()
    expect(currentAfter.data.user?.email).toBe(email)
  })
})
