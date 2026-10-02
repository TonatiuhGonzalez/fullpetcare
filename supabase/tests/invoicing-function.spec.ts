// Prueba los guardias de la Edge Function `invoicing` (tarea 11.15) contra
// Supabase LOCAL, igual que invite-employee-function.spec.ts: es una petición
// HTTP a otro proceso (Deno), así que no se puede probar con `pg`.
//
// A propósito NO prueba el camino exitoso: ese habla con el sandbox de
// Facturapi (necesita una cuenta y su llave) y se verifica a mano; ver
// TASKS.md 11.15. Lo que sí se prueba es lo que debe pasar ANTES de tocar al
// PAC: sin sesión, sin permiso, y archivos mal enviados no llegan allá.
import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { supabase } from '@/services/supabase'
import { closePool } from './helpers'
import { TENANT_HUELLITAS, TENANT_PATITAS } from './fixtures'

const FUNCTION_URL = 'http://127.0.0.1:54321/functions/v1/invoicing'

afterAll(closePool)
afterEach(async () => {
  await supabase.auth.signOut()
})

async function signInAs(email: string): Promise<string> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: 'Demo1234!',
  })
  if (error) throw error
  return data.session!.access_token
}

async function call(
  fields: Record<string, string | Blob>,
  token?: string,
): Promise<{ status: number; body: { message?: string } }> {
  const form = new FormData()
  for (const [name, value] of Object.entries(fields)) form.set(name, value)
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  })
  return { status: response.status, body: await response.json() }
}

describe('invoicing: guardias previos al PAC', () => {
  it('sin sesión se rechaza (401 de la plataforma o 403 de la función)', async () => {
    // Sin esto cualquiera en internet podría gastar llamadas del PAC.
    const { status } = await call({ action: 'setup', tenantId: TENANT_PATITAS })
    expect([401, 403]).toContain(status)
  })

  it('recepción no puede configurar la facturación', async () => {
    // Subir un certificado es dar poder de facturar a nombre del negocio:
    // solo el dueño.
    const token = await signInAs('recepcion@patitasfelices.mx')
    const { status, body } = await call(
      { action: 'setup', tenantId: TENANT_PATITAS },
      token,
    )
    expect(status).toBe(403)
    expect(body.message).toMatch(/no tienes permiso/i)
  })

  it('aislamiento: el dueño de Patitas no puede configurar Huellitas Spa', async () => {
    const token = await signInAs('dueno@patitasfelices.mx')
    const { status } = await call({ action: 'setup', tenantId: TENANT_HUELLITAS }, token)
    expect(status).toBe(403)
  })

  it('una acción desconocida o sin negocio es una solicitud inválida', async () => {
    const token = await signInAs('dueno@patitasfelices.mx')
    expect(
      (await call({ action: 'stamp', tenantId: TENANT_PATITAS }, token)).status,
    ).toBe(400)
    expect((await call({ action: 'setup' }, token)).status).toBe(400)
  })

  it('un .cer sin su .key y contraseña se rechaza antes de hablar con el PAC', async () => {
    // Un envío a medias no debe llegar al PAC ni gastar una llamada.
    const token = await signInAs('dueno@patitasfelices.mx')
    const { status, body } = await call(
      { action: 'setup', tenantId: TENANT_PATITAS, cer: new File(['x'], 'a.cer') },
      token,
    )
    expect(status).toBe(400)
    expect(body.message).toMatch(/\.key/)
  })
})
