// Prueba la imagen de la empresa (fase 26, tarea 26.7): el bucket privado `tenant-logos` y la
// función `set_tenant_logo()`. Mismo patrón que storage-rls.spec.ts: sesión real con el
// `supabase` de la app, y un cliente `service_role` solo para limpiar el archivo al final
// (Storage vive fuera de la transacción de Postgres: un ROLLBACK no lo deshace).
//
// Qué se rompería en producción si esto fallara:
//   - que un empleado que no es dueño cambie o quite la imagen del negocio,
//   - que un negocio vea (o apunte su imagen a) el archivo de otro.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

import { supabase } from '@/services/supabase'

import { TENANT_HUELLITAS, TENANT_PATITAS, USER_GROOMER } from './fixtures'

const DUENO = { email: 'dueno@patitasfelices.mx', password: 'Demo1234!' }
const GROOMER = { email: 'groomer@patitasfelices.mx', password: 'Demo1234!' }

// service_role key fija del Supabase LOCAL (no es secreta; ver .env.example).
const adminClient = createClient(
  'http://127.0.0.1:54321',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
)

const { Pool } = pg
const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' })

// Mueve al groomer a otro negocio (la sesión de supabase-js vive en otra conexión que este
// pool, así que es un UPDATE real y no una transacción que se revierte; ver storage-rls).
async function reassignGroomerTenant(tenantId: string): Promise<void> {
  const client = await pool.connect()
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

async function signIn(user: { email: string; password: string }): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword(user)
  if (error) throw error
}

// El pool se cierra UNA vez, al terminar los dos bloques de este archivo.
afterAll(async () => {
  await pool.end()
})

const LOGO_PATH = `${TENANT_PATITAS}/logo.png`
const png = (bytes: number[]) => new Blob([new Uint8Array(bytes)], { type: 'image/png' })

describe('Imagen de la empresa: Storage (tenant-logos)', () => {
  beforeAll(async () => {
    // Punto de partida: el dueño sube la imagen de Patitas Felices.
    await signIn(DUENO)
    const { error } = await supabase.storage
      .from('tenant-logos')
      .upload(LOGO_PATH, png([1, 2, 3, 4]), { upsert: true })
    if (error) throw error
    await supabase.auth.signOut()
  })

  afterEach(async () => {
    await supabase.auth.signOut()
    await reassignGroomerTenant(TENANT_PATITAS)
  })

  afterAll(async () => {
    await adminClient.storage.from('tenant-logos').remove([LOGO_PATH])
  })

  it('un miembro de OTRO negocio no puede leer la imagen, aunque conozca la ruta', async () => {
    // Caso central de §7: el aislamiento no depende de que la ruta sea difícil de adivinar.
    // El primer segmento (tenant_id) no coincide con ninguna membresía del groomer.
    await reassignGroomerTenant(TENANT_HUELLITAS)
    await signIn(GROOMER)

    const { data, error } = await supabase.storage.from('tenant-logos').download(LOGO_PATH)

    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })

  it('control: un empleado del mismo negocio sí puede leer la imagen', async () => {
    // Sin este caso el de arriba podría pasar solo porque la ruta o el bucket estén mal
    // escritos. Además es el comportamiento que se quiere: la imagen sale en el menú de todos.
    await signIn(GROOMER)

    const { data, error } = await supabase.storage.from('tenant-logos').download(LOGO_PATH)

    expect(error).toBeNull()
    expect(data).not.toBeNull()
  })

  it('un empleado que no es dueño no puede reemplazar la imagen', async () => {
    // Qué se rompería: cualquier groomer o veterinario podría cambiarle el logotipo al negocio.
    await signIn(GROOMER)

    const { error } = await supabase.storage
      .from('tenant-logos')
      .upload(LOGO_PATH, png([7, 7, 7]), { upsert: true })

    expect(error).not.toBeNull()
  })

  it('un empleado que no es dueño no puede quitar la imagen', async () => {
    // Storage no avisa error cuando una política de DELETE oculta la fila: devuelve que no
    // borró nada. Se comprueba que el archivo sigue ahí.
    await signIn(GROOMER)
    await supabase.storage.from('tenant-logos').remove([LOGO_PATH])

    const { data } = await adminClient.storage.from('tenant-logos').download(LOGO_PATH)
    expect(data).not.toBeNull()
  })

  it('el dueño puede reemplazarla (upsert) y quitarla', async () => {
    // Reemplazar es un UPDATE en storage.objects y quitar es un DELETE: cada uno necesita su
    // política (la de UPDATE faltó en pet-photos y rompió el guardado). El archivo de prueba
    // ya existe porque beforeAll lo subió.
    await signIn(DUENO)

    const replace = await supabase.storage
      .from('tenant-logos')
      .upload(LOGO_PATH, png([9, 9, 9, 9, 9]), { upsert: true })
    expect(replace.error).toBeNull()

    const remove = await supabase.storage.from('tenant-logos').remove([LOGO_PATH])
    expect(remove.error).toBeNull()

    const { data } = await adminClient.storage.from('tenant-logos').download(LOGO_PATH)
    expect(data).toBeNull()
  })
})

describe('set_tenant_logo()', () => {
  afterEach(async () => {
    // Deja el negocio sin imagen y al groomer en su sitio, pase lo que pase.
    await signIn(DUENO)
    await supabase.rpc('set_tenant_logo', { p_tenant_id: TENANT_PATITAS, p_logo_path: '' })
    await supabase.auth.signOut()
    await reassignGroomerTenant(TENANT_PATITAS)
  })

  async function readLogoPath(): Promise<string | null> {
    const { data, error } = await supabase
      .from('tenants')
      .select('logo_path')
      .eq('id', TENANT_PATITAS)
      .single()
    if (error) throw error
    return data.logo_path
  }

  it('el dueño guarda la ruta y la quita con texto vacío', async () => {
    // Qué se rompería: la pantalla de Cuenta no podría guardar ni quitar la imagen.
    await signIn(DUENO)

    const save = await supabase.rpc('set_tenant_logo', {
      p_tenant_id: TENANT_PATITAS,
      p_logo_path: LOGO_PATH,
    })
    expect(save.error).toBeNull()
    expect(await readLogoPath()).toBe(LOGO_PATH)

    const clear = await supabase.rpc('set_tenant_logo', {
      p_tenant_id: TENANT_PATITAS,
      p_logo_path: '',
    })
    expect(clear.error).toBeNull()
    expect(await readLogoPath()).toBeNull()
  })

  it('un empleado que no es dueño es rechazado', async () => {
    // La función es SECURITY DEFINER: salta RLS, así que si no revalidara el rol adentro
    // sería una puerta trasera (CLAUDE.md §7.3.4).
    await signIn(GROOMER)

    const { error } = await supabase.rpc('set_tenant_logo', {
      p_tenant_id: TENANT_PATITAS,
      p_logo_path: LOGO_PATH,
    })

    expect(error?.code).toBe('42501')
  })

  it('rechaza una ruta que apunta a la carpeta de otro negocio', async () => {
    // Qué se rompería: el dueño de un negocio podría ligar su imagen al archivo de otro y
    // la política de lectura de Storage le serviría a quien conozca la ruta.
    await signIn(DUENO)

    const { error } = await supabase.rpc('set_tenant_logo', {
      p_tenant_id: TENANT_PATITAS,
      p_logo_path: `${TENANT_HUELLITAS}/logo.png`,
    })

    expect(error?.code).toBe('22023')
  })

  it('un miembro de otro negocio no puede cambiar la imagen de este', async () => {
    // El groomer movido a Huellitas no es miembro de Patitas: app.role_in() devuelve nulo.
    await reassignGroomerTenant(TENANT_HUELLITAS)
    await signIn(GROOMER)

    const { error } = await supabase.rpc('set_tenant_logo', {
      p_tenant_id: TENANT_PATITAS,
      p_logo_path: LOGO_PATH,
    })

    expect(error?.code).toBe('42501')
  })
})
