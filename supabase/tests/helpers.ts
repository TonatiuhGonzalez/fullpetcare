// Helper para los tests de RLS: conecta directo a Postgres (sin pasar por
// PostgREST/la API HTTP) y permite ejecutar consultas "como si fuera" un
// usuario concreto, o como el visitante anónimo.
//
// =============================================================================
// Cómo se simula "estar logueado" dentro de una prueba
// =============================================================================
//
// Cuando el navegador llama a la API de Supabase con un token de sesión,
// PostgREST hace, por cada request, más o menos esto contra Postgres:
//   1. SET ROLE authenticated;                          -- el rol de Postgres
//   2. SET request.jwt.claims = '{"sub": "<user-id>", ...}';  -- el contenido del JWT
//   3. <la consulta real>
//
// auth.uid() (que usan app.is_member_of y compañía) no es magia: es una
// función SQL que lee ese "request.jwt.claims" con current_setting() y
// saca el campo "sub". Y el ROL importa porque las políticas RLS se
// escriben "to authenticated" — un rol distinto simplemente no las activa.
//
// Este helper hace exactamente esos mismos dos pasos, a mano, dentro de
// una transacción de prueba — así se prueba el mecanismo real de RLS, sin
// tener que levantar la API HTTP completa para cada test.
//
// Se usa `set_config(nombre, valor, is_local)` en vez de escribir
// `SET ROLE ...` / `SET request.jwt.claims = '...'` como texto porque SET
// no acepta parámetros ($1, $2) — habría que armar el SQL a mano y
// arriesgar un error de comillas. `set_config()` es una función normal:
// acepta parámetros como cualquier otra consulta.
//
// El tercer argumento de set_config(), `is_local = true`, es el detalle
// que hace todo esto seguro de repetir: el cambio de rol y de usuario
// dura SOLO hasta el final de la transacción actual (COMMIT o ROLLBACK),
// nunca fuera de ella.
import { Pool, type PoolClient } from 'pg'

const connectionString =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

// Un solo Pool para todo el archivo de tests: abrir una conexión TCP
// nueva por cada test sería lento y no hace falta, ya que cada test ya
// aísla su propio estado con su propia transacción.
const pool = new Pool({ connectionString })

export type Role = 'anon' | 'authenticated' | 'service_role'

/**
 * Abre una transacción de prueba y la revierte al terminar (pase o falle
 * el test), sin importar qué haya escrito adentro. Así ningún test deja
 * rastro para el siguiente, y todos empiezan siempre desde exactamente
 * los mismos datos de la semilla.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    return await fn(client)
  } finally {
    await client.query('rollback').catch(() => {})
    client.release()
  }
}

/**
 * Como withTransaction, pero HACE COMMIT. Solo para los tests que llaman a
 * una Edge Function por HTTP: la función corre en OTRO proceso con su
 * propia conexión, y esa conexión no ve nada que esté sin commit en la
 * transacción del test. Por eso lo que crean esos tests queda de verdad en
 * la base y HAY QUE limpiarlo a mano al terminar (ver `deletePlatformTestData`
 * en platform-admin-function.spec.ts). Cualquier test que no necesite HTTP
 * debe usar withTransaction, que se limpia solo.
 */
export async function runCommitted<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/**
 * Cambia el rol simulado DENTRO de una transacción ya abierta. Se expone
 * aparte de withTransaction para los tests que necesitan hacer algo como
 * service_role (p. ej. desactivar una membresía) y luego, SIN salir de la
 * transacción, seguir como si fueran el usuario afectado — dos llamadas a
 * asUser()/asServiceRole() por separado no sirven para eso porque cada
 * una es su propia transacción con su propio rollback.
 */
export async function setRole(
  client: PoolClient,
  role: Role,
  userId: string | null = null,
): Promise<void> {
  await client.query('select set_config($1, $2, true)', ['role', role])
  await client.query('select set_config($1, $2, true)', [
    'request.jwt.claims',
    userId ? JSON.stringify({ sub: userId, role }) : '{}',
  ])
}

/** Atajo: abre una transacción, se pone "como" userId (rol authenticated), corre fn. */
export function asUser<T>(
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withTransaction(async (client) => {
    await setRole(client, 'authenticated', userId)
    return fn(client)
  })
}

/** Atajo: abre una transacción como el visitante anónimo (rol anon, sin sesión). */
export function asAnon<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withTransaction(async (client) => {
    await setRole(client, 'anon')
    return fn(client)
  })
}

/**
 * Atajo: abre una transacción con privilegios totales (bypassa RLS), como
 * service_role. Solo para ARMAR datos de prueba dentro de un test — nunca
 * para verificar el comportamiento que se está probando, porque
 * service_role no tiene ninguna restricción que verificar.
 */
export function asServiceRole<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withTransaction(async (client) => {
    await setRole(client, 'service_role')
    return fn(client)
  })
}

/**
 * Crea un usuario en auth.users (el trigger on_auth_user_created le crea su
 * profile solo, con `full_name` = el correo). Es lo que haría la Edge
 * Function con `auth.admin.createUser`, pero directo en SQL para armar
 * datos de prueba.
 *
 * LLAMAR ANTES de cambiar de rol con setRole(): la conexión arranca como
 * el rol dueño de la base (postgres), el único que puede escribir en el
 * esquema `auth` sin ceremonia. Igual que asServiceRole(), esto es para
 * ARMAR datos, nunca para verificar lo que se está probando.
 */
export async function insertAuthUser(
  client: PoolClient,
  id: string,
  email: string,
): Promise<void> {
  await client.query(
    `insert into auth.users (id, instance_id, aud, role, email)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`,
    [id, email],
  )
}

/**
 * Convierte a `userId` en superadmin de plataforma: crea su usuario de Auth
 * y su fila en platform_admins. Mismo aviso que insertAuthUser(): llamar
 * antes de setRole().
 */
export async function makePlatformAdmin(client: PoolClient, userId: string): Promise<void> {
  await insertAuthUser(client, userId, `${userId}@superadmin.test`)
  await client.query('insert into platform_admins (user_id) values ($1)', [userId])
}

/**
 * Ejecuta una consulta que se ESPERA que Postgres rechace, sin romper el
 * resto de la transacción de prueba.
 *
 * Por qué hace falta: cuando una consulta falla dentro de una transacción,
 * Postgres marca TODA la transacción como abortada y rechaza cualquier
 * comando siguiente ("current transaction is aborted") hasta un ROLLBACK.
 * Un SAVEPOINT es un punto de retorno dentro de la transacción: si la
 * consulta falla, se vuelve a él y la transacción sigue viva para el
 * siguiente `expect`. Devuelve el mensaje del error, o null si NO falló
 * (para que el test pueda afirmar que sí debía fallar).
 */
export async function tryQuery(
  client: PoolClient,
  sql: string,
  params: unknown[] = [],
): Promise<string | null> {
  await client.query('savepoint try_query')
  try {
    await client.query(sql, params)
    await client.query('release savepoint try_query')
    return null
  } catch (error) {
    await client.query('rollback to savepoint try_query')
    return error instanceof Error ? error.message : String(error)
  }
}

/** Cierra el pool de conexiones. Se llama una vez, en afterAll(). */
export async function closePool(): Promise<void> {
  await pool.end()
}
