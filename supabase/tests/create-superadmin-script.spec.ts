// Prueba scripts/create-superadmin.mjs (fase 10, tarea 10.9): el script que
// crea el PRIMER superadmin de un ambiente, porque nadie puede darlo de alta
// desde la interfaz mientras no exista ninguno.
//
// Se ejecuta el script DE VERDAD, como proceso aparte (igual que lo correría
// `npm run superadmin:create`), contra el Supabase local. Es el único modo de
// probar lo que importa de un script: sus argumentos, su código de salida y
// que NO haga nada cuando no debe. Por eso también cubre los casos donde el
// script debe negarse: un script con la llave service_role que "casi siempre"
// se detiene es un script peligroso.
//
// La limpieza (el script hace commit de verdad, sin rollback) está explicada
// en platform-test-helpers.ts.
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { closePool, withTransaction } from './helpers'
import {
  cleanupPlatformTestData,
  created,
  signIn,
  uniqueEmail,
} from './platform-test-helpers'

const SCRIPT = fileURLToPath(new URL('../../scripts/create-superadmin.mjs', import.meta.url))

afterAll(closePool)
afterEach(cleanupPlatformTestData)

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

/**
 * Corre el script con un entorno MÍNIMO y explícito: ninguna variable del
 * entorno de quien corre los tests (ni un SUPABASE_SERVICE_ROLE_KEY real)
 * llega al script salvo la que el test pase a propósito. `cwd` es un
 * directorio temporal para que no encuentre el `.env.local` del proyecto.
 */
function runScript(args: string[], env: Record<string, string> = {}): RunResult {
  const result = spawnSync(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', SCRIPT, ...args],
    {
      cwd: tmpdir(),
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
      encoding: 'utf8',
      input: '', // stdin vacío y sin terminal (no es un TTY)
    },
  )
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

async function findUserId(email: string): Promise<string | null> {
  return withTransaction(async (client) => {
    const { rows } = await client.query('select id from auth.users where email = $1', [email])
    return rows[0]?.id ?? null
  })
}

async function countAuthUsers(): Promise<number> {
  return withTransaction(async (client) => {
    const { rows } = await client.query('select count(*)::int as n from auth.users')
    return rows[0].n
  })
}

describe('create-superadmin --local', () => {
  it('crea un superadmin que entra con la contraseña impresa y ve la plataforma', async () => {
    // Es la razón de existir del script. Se comprueba de punta a punta: el
    // usuario existe en Auth, puede iniciar sesión CON LA CONTRASEÑA QUE
    // IMPRIMIÓ (si imprimiera una distinta a la que guardó, el superadmin
    // quedaría creado pero nadie podría entrar), y las RPC de plataforma lo
    // reconocen como superadmin.
    const email = uniqueEmail('script.superadmin')

    const result = runScript(['--local', '--email', email, '--name', 'Ana del Script'])
    const userId = await findUserId(email)
    if (userId) created.userIds.add(userId)

    expect(result.code).toBe(0)
    const password = /Contraseña temporal:\s+(\S+)/.exec(result.stdout)?.[1]
    expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]{14}$/)
    expect(userId).not.toBeNull()

    const { client, error } = await signIn(email, password!)
    expect(error).toBeNull()
    const { data: admins, error: rpcError } = await client.rpc('platform_list_admins')
    expect(rpcError).toBeNull()
    expect((admins as { email: string; full_name: string }[]).find((a) => a.email === email)).toMatchObject({
      full_name: 'Ana del Script',
    })
  })

  it('un correo YA registrado se rechaza y NO se toca la cuenta existente', async () => {
    // Mismo criterio que la Edge Function: aquí se le pone una contraseña
    // nueva al usuario, y hacerlo sobre una cuenta que ya existe sería
    // secuestrarla. Se prueba con el dueño real de Patitas: debe salir con
    // error, no volverse superadmin y seguir entrando con su contraseña de
    // siempre.
    const usersBefore = await countAuthUsers()

    const result = runScript(['--local', '--email', 'dueno@patitasfelices.mx', '--name', 'Intruso'])

    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/ya está registrado/)
    expect(result.stdout).not.toMatch(/Contraseña temporal/)
    expect(await countAuthUsers()).toBe(usersBefore)

    const owner = await signIn('dueno@patitasfelices.mx', 'Demo1234!')
    expect(owner.error).toBeNull()
    const { data } = await owner.client.rpc('platform_list_admins')
    expect(data).toBeNull() // no es superadmin: la RPC lo rechaza
  })

  it.each([
    ['sin correo', ['--local', '--name', 'Ana']],
    ['con un correo sin forma de correo', ['--local', '--email', 'no-es-correo', '--name', 'Ana']],
    ['sin nombre', ['--local', '--email', 'sin.nombre@fullpetcare.test']],
  ])('%s: sale con error y no crea nada', async (_caso, args) => {
    // Los argumentos incompletos deben frenar el script ANTES de tocar Auth:
    // si no, un typo dejaría cuentas a medias o sin nombre.
    const usersBefore = await countAuthUsers()

    const result = runScript(args)

    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/Uso:/)
    expect(await countAuthUsers()).toBe(usersBefore)
  })

  it('la contraseña es distinta en cada ejecución', async () => {
    // Un script que imprimiera siempre la misma contraseña "temporal"
    // dejaría a todos los superadmins con una credencial conocida.
    const passwords: string[] = []
    for (const prefix of ['uno', 'dos']) {
      const email = uniqueEmail(`script.${prefix}`)
      const result = runScript(['--local', '--email', email, '--name', `Admin ${prefix}`])
      const userId = await findUserId(email)
      if (userId) created.userIds.add(userId)
      passwords.push(/Contraseña temporal:\s+(\S+)/.exec(result.stdout)?.[1] ?? '')
    }
    expect(passwords[0]).not.toBe('')
    expect(passwords[0]).not.toBe(passwords[1])
  })
})

describe('create-superadmin contra un ambiente desplegado (sin --local)', () => {
  it('sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY se niega a hacer nada', async () => {
    // Sin --local el script no debe "adivinar" a dónde apuntar: un default
    // silencioso a un ambiente real sería el error más caro posible.
    const result = runScript(['--email', 'x@fullpetcare.test', '--name', 'X'])

    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY/)
  })

  it('aunque tenga las variables, sin terminal interactiva se niega ANTES de conectarse', async () => {
    // La confirmación de host es la única barrera entre un comando
    // pegado por error y un superadmin nuevo en producción. Si un CI, un
    // cron o una tubería (donde no hay terminal) pudieran saltársela, la
    // barrera no existiría. La URL apunta a un puerto donde no escucha nadie:
    // si el script intentara conectarse, el error sería otro ("No se pudo
    // conectar"), así que verificar el mensaje de la terminal prueba que la
    // negativa ocurre primero, sin tocar la red.
    const result = runScript(['--email', 'x@fullpetcare.test', '--name', 'X'], {
      SUPABASE_URL: 'http://127.0.0.1:1',
      SUPABASE_SERVICE_ROLE_KEY: 'llave-falsa',
    })

    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/terminal interactiva/)
    expect(result.stderr).not.toMatch(/No se pudo conectar/)
  })
})

// Nota: el camino "el segundo paso (platform_admins) falla y se borra el
// usuario recién creado" no tiene test. No hay forma honesta de hacer fallar
// ese INSERT con datos reales sin modificar el esquema. Está documentado en
// TASKS.md (10.9).

