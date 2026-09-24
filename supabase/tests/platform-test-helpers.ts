// Helpers compartidos por los tests que llaman a Edge Functions o a services
// de la fase 10 con SESIONES REALES de Supabase Auth (platform-admin-function
// .spec.ts y platform-service.spec.ts).
//
// =============================================================================
// Limpieza (importante, explicado)
// =============================================================================
// Estos tests no pueden usar rollback: la Edge Function corre en otro proceso
// con su propia conexión, y una sesión real de Auth también vive fuera de la
// transacción del test. Lo que crean queda COMMITEADO. Cada test registra en
// `created` lo que crea (usuarios de Auth y negocios) y
// `cleanupPlatformTestData()` — que cada archivo llama en `afterEach` — lo
// borra:
//   1. Con `session_replication_role = replica` (Postgres omite triggers y
//      comprobaciones de llaves foráneas en esa transacción) se borran las
//      filas de negocio y de bitácora que apuntan a esos usuarios. Sin
//      esto, `audit_log.actor_user_id → auth.users` impediría borrar a un
//      superadmin que ya hizo algo.
//   2. Con la API de administración de Auth se borran los usuarios (su
//      profile se va en cascada).
import { createClient } from '@supabase/supabase-js'

import { runCommitted } from './helpers'

export const SUPABASE_URL = 'http://127.0.0.1:54321'
export const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string
// service_role key fija del Supabase LOCAL (no es secreta, ver
// storage-rls.spec.ts). Solo para armar y limpiar datos de prueba.
export const adminClient = createClient(
  SUPABASE_URL,
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
)

export const created = { userIds: new Set<string>(), tenantIds: new Set<string>() }


export async function cleanupPlatformTestData(): Promise<void> {
  const userIds = [...created.userIds]
  const tenantIds = [...created.tenantIds]
  created.userIds.clear()
  created.tenantIds.clear()

  await runCommitted(async (client) => {
    await client.query('set local session_replication_role = replica')
    // Además de lo ligado a los negocios y a quien actuó, hay que borrar las
    // entradas de bitácora SOBRE las filas de platform_admins de estos
    // usuarios: las creó `adminClient` (service_role), donde auth.uid() es
    // NULL, así que no tienen actor ni tenant y de otra forma se acumularían
    // entre corridas y ensuciarían otros tests que cuentan bitácora.
    await client.query(
      `delete from platform_audit_log
       where tenant_id = any($1)
          or actor_user_id = any($2)
          or (table_name = 'platform_admins'
              and coalesce(new_data ->> 'user_id', old_data ->> 'user_id')::uuid = any($2))`,
      [tenantIds, userIds],
    )
    await client.query('delete from audit_log where tenant_id = any($1) or actor_user_id = any($2)', [
      tenantIds,
      userIds,
    ])
    await client.query('delete from memberships where tenant_id = any($1)', [tenantIds])
    await client.query('delete from branches where tenant_id = any($1)', [tenantIds])
    await client.query('delete from tenant_platform_info where tenant_id = any($1)', [tenantIds])
    await client.query('delete from tenants where id = any($1)', [tenantIds])
    await client.query('delete from platform_admins where user_id = any($1)', [userIds])
  })
  for (const id of userIds) await adminClient.auth.admin.deleteUser(id)
}

export function freshClient() {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Cliente que manda `token` como Authorization, igual que el navegador en cada request. */
export function clientWithToken(token: string) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function signIn(email: string, password: string) {
  const client = freshClient()
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  return { client, session: data.session, error }
}

/**
 * Crea un negocio DESECHABLE (sin dueño, sin sucursal) y lo registra para la
 * limpieza. Los tests que MODIFICAN un negocio (estado, notas) deben usar
 * este y no uno de la semilla: estos tests hacen commit de verdad, así que
 * cualquier cambio a un negocio de la semilla se quedaría en la base local
 * para el siguiente test y para quien la use después.
 */
export async function createScratchTenant(name = 'Negocio desechable'): Promise<string> {
  const { rows } = await runCommitted((client) =>
    client.query('insert into tenants (name) values ($1) returning id', [name]),
  )
  const id: string = rows[0].id
  created.tenantIds.add(id)
  return id
}

let counter = 0
export function uniqueEmail(prefix: string): string {
  counter += 1
  return `${prefix}.${Date.now()}.${counter}@fullpetcare.test`
}

/** Crea un superadmin real (usuario de Auth + fila en platform_admins) y devuelve su token. */
export async function createSuperadmin(): Promise<{ userId: string; email: string; token: string }> {
  const email = uniqueEmail('superadmin')
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password: 'Demo1234!',
    email_confirm: true,
  })
  if (error || !data.user) throw error ?? new Error('No se creó el superadmin de prueba.')
  created.userIds.add(data.user.id)

  const { error: insertError } = await adminClient
    .from('platform_admins')
    .insert({ user_id: data.user.id })
  if (insertError) throw insertError

  const { session, error: signInError } = await signIn(email, 'Demo1234!')
  if (signInError || !session) throw signInError ?? new Error('Sin sesión.')
  return { userId: data.user.id, email, token: session.access_token }
}

