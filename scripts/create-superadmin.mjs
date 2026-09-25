#!/usr/bin/env node
// Crea un superadmin de plataforma (fase 10, tarea 10.9): un usuario en
// Supabase Auth con contraseña temporal + su fila en `platform_admins`.
//
// =============================================================================
// Para qué existe (y por qué no se puede hacer desde la app)
// =============================================================================
// La pantalla "Superadmins" de /superadmin agrega nuevos superadmins, pero
// solo lo puede hacer alguien que YA sea superadmin. El PRIMERO no puede
// crearse desde la interfaz: es el huevo y la gallina. Este script es esa
// puerta de arranque, y por eso necesita la llave `service_role` (que salta
// RLS y nunca debe tocar el frontend, CLAUDE.md §10): la lee de tu
// `.env.local` o del entorno, jamás del repo.
//
// Uso:
//   npm run superadmin:create -- --local  --email ana@fullpetcare.mx --name "Ana Robles"
//   npm run superadmin:create --          --email ana@fullpetcare.mx --name "Ana Robles"
//
//   --local   apunta al Supabase LOCAL (http://127.0.0.1:54321) con su
//             service_role fija y pública. No pide confirmación.
//   (sin --local) apunta a lo que digan SUPABASE_URL y
//             SUPABASE_SERVICE_ROLE_KEY (en el entorno o en .env.local), y
//             pide escribir el host para confirmar: crear un superadmin en un
//             ambiente desplegado es de las cosas más delicadas del sistema.
//
// Igual que la Edge Function platform-admin: rechaza un correo que ya esté
// registrado (no se le cambia la contraseña a una cuenta existente) y
// imprime la contraseña temporal UNA sola vez. Si el segundo paso falla,
// borra el usuario que acaba de crear para no dejar una cuenta huérfana que
// bloquearía reintentar con el mismo correo.
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'

// El mismo generador que usa la Edge Function: una sola implementación de
// algo tan sensible como una contraseña. Node 22 ejecuta el .ts directo
// (type stripping); no tiene imports ni Deno.* precisamente por eso.
import { generateTemporaryPassword } from '../supabase/functions/platform-admin/password.ts'

// service_role del Supabase LOCAL. No es un secreto: es la misma llave fija
// para cualquier instalación local (mismo valor que ya usan los tests, ver
// supabase/tests/storage-rls.spec.ts y la doc de Supabase CLI). Con ella no
// se puede tocar ningún ambiente desplegado.
const LOCAL_URL = 'http://127.0.0.1:54321'
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

function fail(message) {
  console.error(`\nError: ${message}`)
  process.exit(1)
}

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    local: { type: 'boolean', default: false },
  },
})

const email = values.email?.trim().toLowerCase()
const fullName = values.name?.trim()

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  fail('Falta un correo válido. Uso: --email ana@fullpetcare.mx --name "Ana Robles"')
}
if (!fullName) {
  fail('Falta el nombre. Uso: --email ana@fullpetcare.mx --name "Ana Robles"')
}

// ---------------------------------------------------------------------------
// A qué ambiente se apunta
// ---------------------------------------------------------------------------
let baseUrl
let serviceRoleKey

if (values.local) {
  baseUrl = LOCAL_URL
  serviceRoleKey = LOCAL_SERVICE_ROLE_KEY
} else {
  // .env.local es donde vive la service_role de quien corre scripts (CLAUDE.md
  // §10). loadEnvFile no pisa variables que ya vengan en el entorno.
  if (existsSync('.env.local')) process.loadEnvFile('.env.local')
  baseUrl = process.env.SUPABASE_URL
  serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!baseUrl || !serviceRoleKey) {
    fail(
      'Sin --local hacen falta SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (en el entorno o en .env.local).',
    )
  }

  const host = new URL(baseUrl).host
  if (!process.stdin.isTTY) {
    fail('Para un ambiente desplegado hace falta una terminal interactiva (pide confirmación).')
  }
  console.log(`Se creará el superadmin ${email} en ${baseUrl}`)
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const typed = await rl.question(`Escribe el host (${host}) para confirmar: `)
  rl.close()
  if (typed.trim() !== host) fail('El host no coincide. Cancelado, no se creó nada.')
}

const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  'Content-Type': 'application/json',
}

async function readJson(response) {
  try {
    return await response.json()
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Paso 1: el usuario en Auth (contraseña temporal, correo ya confirmado)
// ---------------------------------------------------------------------------
const password = generateTemporaryPassword()

const createResponse = await fetch(`${baseUrl}/auth/v1/admin/users`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    email,
    password,
    email_confirm: true,
    // `full_name` es lo que lee el trigger app.handle_new_auth_user() para
    // crear el profile.
    user_metadata: { full_name: fullName },
    // Contraseña temporal: el trigger de alta marca el profile y la persona
    // debe cambiarla en su primer inicio de sesión. app_metadata solo la
    // escribe la llave service_role (el usuario no puede quitársela).
    app_metadata: { must_change_password: true },
  }),
}).catch((error) => fail(`No se pudo conectar a ${baseUrl}: ${error.message}`))

if (!createResponse.ok) {
  const body = await readJson(createResponse)
  const text = `${body.error_code ?? ''} ${body.msg ?? body.message ?? ''}`
  if (/already.*registered|already exists|email_exists/i.test(text)) {
    fail(`El correo ${email} ya está registrado. No se modificó ninguna cuenta.`)
  }
  fail(`Auth rechazó la creación del usuario (HTTP ${createResponse.status}): ${text.trim()}`)
}

const { id: userId } = await readJson(createResponse)
if (!userId) fail('Auth no devolvió el id del usuario creado.')

// ---------------------------------------------------------------------------
// Paso 2: la fila en platform_admins. Si falla, se deshace el paso 1.
// ---------------------------------------------------------------------------
const insertResponse = await fetch(`${baseUrl}/rest/v1/platform_admins`, {
  method: 'POST',
  headers: { ...headers, Prefer: 'return=minimal' },
  body: JSON.stringify({ user_id: userId }),
})

if (!insertResponse.ok) {
  const body = await readJson(insertResponse)
  const deleteResponse = await fetch(`${baseUrl}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers,
  })
  const cleanup = deleteResponse.ok
    ? 'Se borró el usuario que se acababa de crear.'
    : `ATENCIÓN: no se pudo borrar el usuario creado (${userId}); bórralo a mano en Auth.`
  fail(
    `No se pudo registrar como superadmin (HTTP ${insertResponse.status}): ${body.message ?? ''}\n${cleanup}`,
  )
}

// ---------------------------------------------------------------------------
// Listo: la contraseña se muestra UNA vez. No se guarda en ningún lado.
// ---------------------------------------------------------------------------
console.log(`
Superadmin creado.

  Correo:               ${email}
  Contraseña temporal:  ${password}

Cópiala ahora: no se puede volver a ver. Entra en /login con ese correo;
el sistema le pedirá cambiarla en el primer inicio de sesión.
`)
