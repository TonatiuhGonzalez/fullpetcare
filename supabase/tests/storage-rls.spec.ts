// Prueba las políticas de Storage del bucket pet-photos (tarea 2.15):
// un usuario del tenant A no puede leer un archivo bajo la carpeta del
// tenant B, aunque conozca la ruta exacta. Mismo patrón de sesión real
// que customers-service.spec.ts, más un cliente "admin" (service_role)
// solo para la limpieza del archivo de prueba al final — subir/bajar
// archivos de Storage no se puede hacer dentro de una transacción de pg
// que se revierte sola (el contenido vive en el backend de Storage, no
// en una fila que un ROLLBACK deshaga), así que la limpieza tiene que
// ser un borrado real.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

import { supabase } from '@/services/supabase'

import { TENANT_HUELLITAS, TENANT_PATITAS, USER_GROOMER } from './fixtures'

const DUENO_EMAIL = 'dueno@patitasfelices.mx'
const DUENO_PASSWORD = 'Demo1234!'
const GROOMER_EMAIL = 'groomer@patitasfelices.mx'
const GROOMER_PASSWORD = 'Demo1234!'

// service_role key fija del Supabase LOCAL (no es secreta — es la misma
// para cualquier instalación local, ver .env.example). Un cliente admin
// aparte, solo para la limpieza final: subir/leer como usuario normal ya
// lo hace el `supabase` singleton de la app.
const adminClient = createClient(
  'http://127.0.0.1:54321',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
)

const { Pool } = pg
const cleanupPool = new Pool({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})

async function reassignGroomerTenant(tenantId: string): Promise<void> {
  const client = await cleanupPool.connect()
  try {
    await client.query('set role service_role')
    await client.query('update memberships set tenant_id = $1 where user_id = $2', [
      tenantId,
      USER_GROOMER,
    ])
  } finally {
    await client.query('reset role')
    client.release()
  }
}

const TEST_PATH = `${TENANT_PATITAS}/mascota-de-prueba/foto.jpg`

describe('Aislamiento entre tenants: Storage (pet-photos)', () => {
  beforeAll(async () => {
    // Sube un archivo de prueba bajo la carpeta de Patitas Felices,
    // como el dueño real de ese tenant — la subida en sí no es lo que
    // se prueba aquí (eso ya lo cubriría un test de "insert"), es el
    // punto de partida para probar la LECTURA entre tenants.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (signInError) throw signInError

    const fakeImage = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' })
    const { error: uploadError } = await supabase.storage
      .from('pet-photos')
      .upload(TEST_PATH, fakeImage, { upsert: true })
    if (uploadError) throw uploadError

    await supabase.auth.signOut()
  })

  afterEach(async () => {
    await supabase.auth.signOut()
    // El groomer siempre vuelve a su tenant real después de cada test —
    // igual que en customers-rls.spec.ts / pets-rls.spec.ts, pero aquí
    // el cambio es un UPDATE de verdad (no dentro de una transacción que
    // se revierte), porque la sesión de supabase-js vive en OTRA
    // conexión que la de este pool — sin esto, el groomer quedaría
    // "atrapado" en Huellitas Spa para el resto de la suite.
    await reassignGroomerTenant(TENANT_PATITAS)
  })

  afterAll(async () => {
    await adminClient.storage.from('pet-photos').remove([TEST_PATH])
    await cleanupPool.end()
  })

  it('un miembro de OTRO tenant no puede leer la foto, aunque conozca la ruta exacta', async () => {
    // Este es el caso que de verdad importa (CLAUDE.md §7): la seguridad
    // de Storage no depende de que la ruta sea "difícil de adivinar" —
    // aunque el groomer de otro negocio conozca el path EXACTO, la
    // política de RLS de storage.objects lo bloquea igual, porque el
    // primer segmento de la ruta (el tenant_id) no coincide con ninguna
    // membresía suya.
    await reassignGroomerTenant(TENANT_HUELLITAS)

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: GROOMER_EMAIL,
      password: GROOMER_PASSWORD,
    })
    if (signInError) throw signInError

    const { data, error } = await supabase.storage.from('pet-photos').download(TEST_PATH)

    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })

  it('control: un miembro del tenant correcto sí puede leer la foto', async () => {
    // Sin este caso, el test de arriba podría estar "pasando" solo
    // porque la ruta o el nombre del bucket están mal escritos, no
    // porque RLS de verdad esté bloqueando.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: GROOMER_EMAIL,
      password: GROOMER_PASSWORD,
    })
    if (signInError) throw signInError

    const { data, error } = await supabase.storage.from('pet-photos').download(TEST_PATH)

    expect(error).toBeNull()
    expect(data).not.toBeNull()
  })
})
