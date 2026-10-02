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
import { closePool, runCommitted, setRole } from './helpers'
import {
  BRANCH_CENTRO,
  CUSTOMER_SOFIA,
  TENANT_HUELLITAS,
  TENANT_PATITAS,
} from './fixtures'

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

// ---------------------------------------------------------------------------
// stamp / cancel / download (tarea 11.18): solo los guardias previos al PAC.
// El timbrado exitoso, la cancelación y el PAC caído se verifican en el sandbox
// (HMH Four #2068): necesitan una cuenta real de Facturapi.
// ---------------------------------------------------------------------------
const RECEIVER = JSON.stringify({
  rfc: 'RUCS850312AB1',
  legalName: 'Sofía Ruiz',
  taxRegimeCode: '612',
  postalCode: '97000',
  cfdiUse: 'G03',
})

describe('invoicing stamp: guardias previos al PAC', () => {
  const saleIds: string[] = []

  // Estas ventas se confirman de verdad (la función corre en otro proceso y no
  // vería una transacción abierta), así que se borran al terminar.
  async function seedSale(status: 'open' | 'paid'): Promise<string> {
    return runCommitted(async (client) => {
      await setRole(client, 'service_role')
      const { rows } = await client.query(
        `insert into sales (tenant_id, branch_id, customer_id, folio, status, total_cents)
         values ($1, $2, $3, $4, $5, 11600) returning id`,
        [TENANT_PATITAS, BRANCH_CENTRO, CUSTOMER_SOFIA, 9000 + saleIds.length, status],
      )
      saleIds.push(rows[0].id)
      return rows[0].id
    })
  }

  afterEach(async () => {
    const ids = saleIds.splice(0)
    if (ids.length === 0) return
    await runCommitted(async (client) => {
      await setRole(client, 'service_role')
      await client.query('delete from sales where id = any($1::uuid[])', [ids])
    })
  })

  const stamp = (token: string, saleId: string, extra: Record<string, string> = {}) =>
    call(
      { action: 'stamp', tenantId: TENANT_PATITAS, saleId, receiver: RECEIVER, ...extra },
      token,
    )

  it('un groomer (sin permiso de facturación) no puede timbrar', async () => {
    // El permiso 'invoicing' lo decide una fila de role_permissions: sin él,
    // cualquier empleado emitiría facturas a nombre del negocio.
    const token = await signInAs('groomer@patitasfelices.mx')
    const { status } = await stamp(token, await seedSale('paid'))
    expect(status).toBe(403)
  })

  it('aislamiento: el dueño de Patitas no puede timbrar en nombre de Huellitas Spa', async () => {
    const token = await signInAs('dueno@patitasfelices.mx')
    const saleId = await seedSale('paid')
    const { status } = await call(
      { action: 'stamp', tenantId: TENANT_HUELLITAS, saleId, receiver: RECEIVER },
      token,
    )
    expect(status).toBe(403)
  })

  it('una venta que no existe (o es de otro negocio) responde 403, sin revelar nada', async () => {
    const token = await signInAs('dueno@patitasfelices.mx')
    const { status } = await stamp(token, '00000000-0000-4000-8000-00000000dead')
    expect(status).toBe(403)
  })

  it('una venta no pagada no se factura', async () => {
    // Facturar una venta abierta emitiría un documento fiscal por dinero que
    // todavía no se cobró.
    const token = await signInAs('dueno@patitasfelices.mx')
    const { status, body } = await stamp(token, await seedSale('open'))
    expect(status).toBe(409)
    expect(body.message).toMatch(/pagadas/i)
  })

  it('un negocio sin certificado cargado no puede facturar', async () => {
    // La semilla no trae configuración fiscal: debe decir que falta, no intentar timbrar.
    const token = await signInAs('dueno@patitasfelices.mx')
    const { status, body } = await stamp(token, await seedSale('paid'))
    expect(status).toBe(422)
    expect(body.message).toMatch(/listo para facturar/i)
  })

  it('sin datos del cliente es una solicitud inválida', async () => {
    const token = await signInAs('dueno@patitasfelices.mx')
    const { status } = await call(
      { action: 'stamp', tenantId: TENANT_PATITAS, saleId: await seedSale('paid') },
      token,
    )
    expect(status).toBe(400)
  })
})

describe('invoicing cancel / download: guardias previos al PAC', () => {
  it('un motivo de cancelación fuera de los permitidos es inválido', async () => {
    // El 01 exige la factura que sustituye y el 04 es solo de la global: no se ofrecen todavía.
    const token = await signInAs('dueno@patitasfelices.mx')
    const { status } = await call(
      { action: 'cancel', tenantId: TENANT_PATITAS, invoiceRequestId: 'x', motive: '01' },
      token,
    )
    expect(status).toBe(400)
  })

  it('cancelar o descargar una factura que no existe responde 403', async () => {
    const token = await signInAs('dueno@patitasfelices.mx')
    const id = '00000000-0000-4000-8000-00000000dead'
    expect(
      (
        await call(
          {
            action: 'cancel',
            tenantId: TENANT_PATITAS,
            invoiceRequestId: id,
            motive: '02',
          },
          token,
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await call(
          { action: 'download', tenantId: TENANT_PATITAS, invoiceRequestId: id },
          token,
        )
      ).status,
    ).toBe(403)
  })

  it('un groomer no puede cancelar', async () => {
    const token = await signInAs('groomer@patitasfelices.mx')
    const { status } = await call(
      { action: 'cancel', tenantId: TENANT_PATITAS, invoiceRequestId: 'x', motive: '02' },
      token,
    )
    expect(status).toBe(403)
  })
})
