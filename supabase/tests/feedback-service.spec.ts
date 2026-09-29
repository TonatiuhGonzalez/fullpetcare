// Prueba services/feedback.ts (tarea #1958) con una sesión REAL de Supabase
// Auth, mismo patrón que pets-service.spec.ts. Lo que se verifica es lo que
// las pruebas de RLS no cubren: que el servicio arma bien la ruta de la
// captura, la sube y guarda la fila con esa ruta. Storage vive fuera de la
// transacción de Postgres, así que lo que se crea se limpia a mano al final.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

import * as feedback from '@/services/feedback'
import { supabase } from '@/services/supabase'

import { TENANT_PATITAS } from './fixtures'

// service_role key fija del Supabase LOCAL (no es secreta, ver storage-rls.spec.ts).
const adminClient = createClient(
  'http://127.0.0.1:54321',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
)

const { Pool } = pg
const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' })

// Marca única para encontrar y borrar solo lo que crearon estas pruebas.
const MARK = 'PRUEBA-FEEDBACK-SERVICE'

async function reportsWithMark(): Promise<{ id: string; message: string; screenshot_path: string | null }[]> {
  const client = await pool.connect()
  try {
    await client.query('set role service_role')
    const { rows } = await client.query(
      `select id, message, screenshot_path from feedback_reports where message like $1`,
      [`${MARK}%`],
    )
    return rows
  } finally {
    await client.query('reset role')
    client.release()
  }
}

afterAll(() => pool.end())

describe('services/feedback.ts contra Supabase local', () => {
  beforeEach(async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email: 'groomer@patitasfelices.mx',
      password: 'Demo1234!',
    })
    if (error) throw error
  })

  afterEach(async () => {
    await supabase.auth.signOut()
    const rows = await reportsWithMark()
    const paths = rows.map((r) => r.screenshot_path).filter((p): p is string => p !== null)
    if (paths.length > 0) await adminClient.storage.from('feedback-screenshots').remove(paths)
    const client = await pool.connect()
    try {
      await client.query('set role service_role')
      await client.query('delete from feedback_reports where message like $1', [`${MARK}%`])
    } finally {
      await client.query('reset role')
      client.release()
    }
  })

  it('envía un comentario sin captura, recortando espacios', async () => {
    // El caso más común. Si el trim() faltara, se guardaría basura de espacios
    // y el panel de la plataforma mostraría mensajes con sangrías raras.
    await feedback.send(TENANT_PATITAS, `  ${MARK} sin captura  `)
    const rows = await reportsWithMark()
    expect(rows).toHaveLength(1)
    expect(rows[0].message).toBe(`${MARK} sin captura`)
    expect(rows[0].screenshot_path).toBeNull()
  })

  it('envía un comentario con captura: la sube bajo la carpeta del negocio y guarda la ruta', async () => {
    // Si la ruta no empezara con el tenant_id, la política del bucket
    // rechazaría la subida (o peor: quedaría en la carpeta equivocada).
    const png = new File([new Uint8Array([1, 2, 3, 4])], 'captura.png', { type: 'image/png' })
    await feedback.send(TENANT_PATITAS, `${MARK} con captura`, png)

    const [row] = await reportsWithMark()
    expect(row.screenshot_path).toBe(`${TENANT_PATITAS}/${row.id}.png`)

    const { data, error } = await adminClient.storage
      .from('feedback-screenshots')
      .download(row.screenshot_path as string)
    expect(error).toBeNull()
    expect(data?.size).toBe(4)
  })

  it('con un negocio ajeno falla y no deja ninguna fila', async () => {
    // El servicio no debe fingir éxito: la interfaz depende del error para
    // avisar "no se pudo enviar".
    await expect(
      feedback.send('b0000000-0000-4000-8000-000000000002', `${MARK} ajeno`),
    ).rejects.toBeTruthy()
    expect(await reportsWithMark()).toHaveLength(0)
  })
})
