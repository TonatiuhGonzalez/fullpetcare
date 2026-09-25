// Prueba la Edge Function invite-employee (fase 9) contra Supabase LOCAL
// de verdad — mismo motivo que public-pet-view.spec.ts: es una petición
// HTTP a otro proceso (Deno), no se puede probar con `pg`. A diferencia
// de esa función, aquí SÍ hay sesión: se firma con `signInWithPassword`
// (mismo cliente que usa la app, `@/services/supabase`) y se manda el
// `access_token` como Authorization header, exactamente como lo haría el
// navegador.
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'

import { supabase } from '@/services/supabase'
import { closePool, setRole, withTransaction } from './helpers'
import { TENANT_HUELLITAS, TENANT_PATITAS } from './fixtures'

const FUNCTION_URL = 'http://127.0.0.1:54321/functions/v1/invite-employee'

// Borrar un usuario de auth.users no se puede hacer con un DELETE de SQL
// directo — ni siquiera service_role tiene permiso sobre esa tabla (la
// administra internamente Supabase Auth); hay que pasar por su API de
// administración. service_role key fija del Supabase LOCAL (no es
// secreta, ver storage-rls.spec.ts).
const adminClient = createClient(
  'http://127.0.0.1:54321',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
)

afterAll(async () => {
  await closePool()
})

afterEach(async () => {
  await supabase.auth.signOut()
})

async function signInAs(email: string, password = 'Demo1234!'): Promise<string> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  const token = data.session?.access_token
  if (!token) throw new Error('Sin access_token tras iniciar sesión.')
  return token
}

async function callInviteEmployee(
  body: unknown,
  token?: string,
): Promise<{ status: number; body: { message?: string; userId?: string } }> {
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

describe('invite-employee: sin sesión válida', () => {
  it('sin Authorization header, se rechaza (401 de la plataforma o 403 de la función)', async () => {
    // Hay DOS capas y cuál responde depende de cómo se sirva la función:
    // con verify_jwt = true (config.toml; es lo que corre en CI y en la
    // nube) la plataforma rechaza con 401 antes de ejecutar nuestro código;
    // con `supabase functions serve --no-verify-jwt` (atajo local) llega a
    // la función, que revisa el header ella misma y responde 403. Lo que
    // importa —y lo que este test protege— es que sin sesión NUNCA se
    // invita a nadie, sin atar el test a una sola capa.
    const { status } = await callInviteEmployee({
      tenantId: TENANT_PATITAS,
      email: 'quien-sea@patitasfelices.mx',
      fullName: 'Quien Sea',
    })
    expect([401, 403]).toContain(status)
  })
})

describe('invite-employee: revalida permiso (paso 1, sin service_role todavía)', () => {
  it('un groomer (sin "employees:edit") no puede invitar a nadie', async () => {
    const token = await signInAs('groomer@patitasfelices.mx')
    const { status, body } = await callInviteEmployee(
      { tenantId: TENANT_PATITAS, email: 'intento-groomer@patitasfelices.mx', fullName: 'Intento' },
      token,
    )
    expect(status).toBe(403)
    expect(body.message).toMatch(/no tienes permiso/i)
  })

  it('aislamiento: el dueño de un negocio no puede invitar a un tenant donde no tiene membership', async () => {
    // dueno@patitasfelices.mx es owner de Patitas, no de Huellitas Spa —
    // pedirle que invite "para" Huellitas debe rechazarse igual que
    // cualquier otro intento sin membership en ese tenant.
    const token = await signInAs('dueno@patitasfelices.mx')
    const { status, body } = await callInviteEmployee(
      { tenantId: TENANT_HUELLITAS, email: 'intento-cruzado@huellitasspa.mx', fullName: 'Intento Cruzado' },
      token,
    )
    expect(status).toBe(403)
    expect(body.message).toMatch(/no tienes permiso/i)
  })
})

describe('invite-employee: alta exitosa', () => {
  // Limpieza real (no hay transacción que revertir: auth.admin crea la
  // fila fuera de cualquier savepoint de prueba) — el profile se va con
  // el usuario por el ON DELETE CASCADE (tenancy.sql).
  const createdUserIds: string[] = []

  afterEach(async () => {
    for (const userId of createdUserIds) {
      await adminClient.auth.admin.deleteUser(userId)
    }
    createdUserIds.length = 0
  })

  it('el dueño invita un correo nuevo y recibe un userId con profile creado con el full_name correcto', async () => {
    const token = await signInAs('dueno@patitasfelices.mx')
    const { status, body } = await callInviteEmployee(
      {
        tenantId: TENANT_PATITAS,
        email: 'nuevo.empleado@patitasfelices.mx',
        fullName: 'Empleado De Prueba',
      },
      token,
    )

    expect(status).toBe(200)
    expect(typeof body.userId).toBe('string')
    createdUserIds.push(body.userId)

    const { rows } = await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      return client.query('select full_name from profiles where id = $1', [body.userId])
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].full_name).toBe('Empleado De Prueba')
  })

  it('invitar el MISMO correo otra vez reutiliza el mismo userId en vez de fallar', async () => {
    const token = await signInAs('dueno@patitasfelices.mx')
    const first = await callInviteEmployee(
      {
        tenantId: TENANT_PATITAS,
        email: 'nuevo.empleado@patitasfelices.mx',
        fullName: 'Empleado De Prueba',
      },
      token,
    )
    expect(first.status).toBe(200)
    createdUserIds.push(first.body.userId)

    const second = await callInviteEmployee(
      {
        tenantId: TENANT_PATITAS,
        email: 'nuevo.empleado@patitasfelices.mx',
        fullName: 'Empleado De Prueba (segundo intento)',
      },
      token,
    )
    expect(second.status).toBe(200)
    expect(second.body.userId).toBe(first.body.userId)
  })
})
