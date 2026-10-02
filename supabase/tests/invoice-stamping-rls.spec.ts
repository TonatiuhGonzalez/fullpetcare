// Ciclo de vida de invoice_requests (tarea 11.17, migración
// invoice_requests_stamping.sql). Lo que se rompería en silencio:
//   - que un usuario fabrique una "factura timbrada" desde la API,
//   - que se timbre dos veces la misma venta,
//   - que una factura timbrada se edite o se borre,
//   - que otro negocio vea las facturas o sus archivos.
import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import { closePool, setRole, withTransaction } from './helpers'
import {
  BRANCH_CENTRO,
  CUSTOMER_SOFIA,
  TENANT_HUELLITAS,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
} from './fixtures'

afterAll(closePool)

async function seedSale(client: PoolClient, folio = 999): Promise<string> {
  await setRole(client, 'service_role')
  const { rows } = await client.query(
    `insert into sales (tenant_id, branch_id, customer_id, folio, status, total_cents)
     values ($1, $2, $3, $4, 'paid', 11600) returning id`,
    [TENANT_PATITAS, BRANCH_CENTRO, CUSTOMER_SOFIA, folio],
  )
  return rows[0].id
}

// Inserta una solicitud como la dejaría la Edge Function (service_role).
async function seedRequest(
  client: PoolClient,
  saleId: string,
  status = 'pending',
): Promise<string> {
  await setRole(client, 'service_role')
  const stamped = status === 'stamped' || status === 'cancelled'
  const { rows } = await client.query(
    `insert into invoice_requests (tenant_id, sale_id, rfc, legal_name, tax_regime_code, cfdi_use,
       postal_code, payment_form_code, payment_method_code, status, fiscal_uuid, stamped_at,
       cancelled_at, cancellation_reason_code)
     values ($1, $2, 'RUCS850312AB1', 'Sofía Ruiz', '612', 'G03', '97000', '01', 'PUE', $3,
       $4, $5, $6, $7)
     returning id`,
    [
      TENANT_PATITAS,
      saleId,
      status,
      stamped ? 'a1b2c3d4-0000-4000-8000-000000000001' : null,
      stamped ? new Date() : null,
      status === 'cancelled' ? new Date() : null,
      status === 'cancelled' ? '02' : null,
    ],
  )
  return rows[0].id
}

describe('invoice_requests: los usuarios solo crean solicitudes limpias', () => {
  const insertAs = (client: PoolClient, saleId: string, extra = '', value = '') =>
    client.query(
      `insert into invoice_requests (tenant_id, sale_id, rfc, legal_name, tax_regime_code, cfdi_use,
         postal_code, payment_form_code, payment_method_code ${extra})
       values ($1, $2, 'RUCS850312AB1', 'Sofía Ruiz', '612', 'G03', '97000', '01', 'PUE' ${value})`,
      [TENANT_PATITAS, saleId],
    )

  it('recepción crea una solicitud pending (el flujo de siempre al cobrar)', async () => {
    // Si la política nueva rompiera esto, ya no se podría pedir factura al cobrar.
    await withTransaction(async (client) => {
      const saleId = await seedSale(client)
      await setRole(client, 'authenticated', USER_RECEPCION)
      await expect(insertAs(client, saleId)).resolves.toBeDefined()
    })
  })

  it('NO puede insertar una solicitud ya "stamped" con UUID inventado', async () => {
    // Sin esta regla, una persona con la API en la mano fabricaría una factura
    // timbrada falsa: "stamped" significa que tiene validez fiscal.
    await withTransaction(async (client) => {
      const saleId = await seedSale(client)
      await setRole(client, 'authenticated', USER_RECEPCION)
      await expect(
        insertAs(
          client,
          saleId,
          ', status, fiscal_uuid',
          ", 'stamped', 'a1b2c3d4-0000-4000-8000-000000000009'",
        ),
      ).rejects.toThrow(/row-level security/i)
    })
  })

  it('un groomer no puede crear solicitudes', async () => {
    await withTransaction(async (client) => {
      const saleId = await seedSale(client)
      await setRole(client, 'authenticated', USER_GROOMER)
      await expect(insertAs(client, saleId)).rejects.toThrow(/row-level security/i)
    })
  })

  it('ni el dueño puede cambiar el estado: UPDATE no pasa por RLS', async () => {
    // Los cambios de estado son de la Edge Function; sin política de UPDATE el
    // dueño no puede marcarse una factura como timbrada.
    await withTransaction(async (client) => {
      const saleId = await seedSale(client)
      const id = await seedRequest(client, saleId)
      await setRole(client, 'authenticated', USER_DUENO)
      const { rowCount } = await client.query(
        `update invoice_requests set status = 'stamped' where id = $1`,
        [id],
      )
      expect(rowCount).toBe(0)
    })
  })
})

describe('invoice_requests: un solo timbrado vivo por venta', () => {
  it('rechaza una segunda factura "stamped" o "stamping" para la misma venta', async () => {
    // Es el riesgo central de la fase: timbrar dos veces cobraría dos timbres y
    // dejaría dos facturas válidas por una venta. Lo impide el índice, no la pantalla.
    await withTransaction(async (client) => {
      const saleId = await seedSale(client)
      await seedRequest(client, saleId, 'stamped')
      await expect(seedRequest(client, saleId, 'stamping')).rejects.toThrow(
        /one_live_per_sale/,
      )
    })
  })

  it('permite varias pendientes y volver a facturar tras cancelar', async () => {
    // Un intento fallido (pending) no debe bloquear el reintento, y una
    // factura cancelada libera la venta (cancelar y sustituir).
    await withTransaction(async (client) => {
      const saleId = await seedSale(client)
      await seedRequest(client, saleId, 'pending')
      await seedRequest(client, saleId, 'pending')
      await seedRequest(client, saleId, 'cancelled')
      await expect(seedRequest(client, saleId, 'stamped')).resolves.toBeDefined()
    })
  })
})

describe('invoice_requests: una timbrada no se edita ni se borra', () => {
  it('no deja cambiar el RFC de una factura timbrada, ni con service_role', async () => {
    // Los datos con los que se timbró son el documento fiscal: cambiarlos la
    // desfasaría del XML que ya tiene el SAT.
    await withTransaction(async (client) => {
      const id = await seedRequest(client, await seedSale(client), 'stamped')
      await expect(
        client.query(`update invoice_requests set rfc = 'XAXX010101000' where id = $1`, [
          id,
        ]),
      ).rejects.toThrow(/solo cancelar/i)
    })
  })

  it('sí deja cancelarla (stamped → cancelled con motivo)', async () => {
    // Es la única salida permitida; si se bloqueara, no se podría cancelar nada.
    await withTransaction(async (client) => {
      const id = await seedRequest(client, await seedSale(client), 'stamped')
      const { rowCount } = await client.query(
        `update invoice_requests set status = 'cancelled', cancelled_at = now(),
           cancellation_reason_code = '02' where id = $1`,
        [id],
      )
      expect(rowCount).toBe(1)
    })
  })

  it('una cancelada es final', async () => {
    await withTransaction(async (client) => {
      const id = await seedRequest(client, await seedSale(client), 'cancelled')
      await expect(
        client.query(`update invoice_requests set status = 'stamped' where id = $1`, [
          id,
        ]),
      ).rejects.toThrow(/cancelada/i)
    })
  })

  it('una timbrada no se puede borrar físicamente (ni con service_role)', async () => {
    await withTransaction(async (client) => {
      const id = await seedRequest(client, await seedSale(client), 'stamped')
      await expect(
        client.query('delete from invoice_requests where id = $1', [id]),
      ).rejects.toThrow()
    })
  })

  it('una timbrada o cancelada sin UUID fiscal es imposible', async () => {
    // La coherencia la garantiza un check en la base, no el código.
    await withTransaction(async (client) => {
      const saleId = await seedSale(client)
      await setRole(client, 'service_role')
      await expect(
        client.query(
          `insert into invoice_requests (tenant_id, sale_id, rfc, legal_name, tax_regime_code,
             cfdi_use, postal_code, payment_form_code, payment_method_code, status)
           values ($1, $2, 'RUCS850312AB1', 'x', '612', 'G03', '97000', '01', 'PUE', 'stamped')`,
          [TENANT_PATITAS, saleId],
        ),
      ).rejects.toThrow(/stamped_has_uuid/)
    })
  })
})

describe('bucket invoices: aislamiento', () => {
  async function seedFile(client: PoolClient, tenantId: string): Promise<void> {
    await setRole(client, 'service_role')
    await client.query(
      `insert into storage.objects (bucket_id, name, owner) values ('invoices', $1, null)`,
      [`${tenantId}/factura.pdf`],
    )
  }

  it('el dueño y recepción leen los archivos de su negocio; el groomer no', async () => {
    // El permiso 'invoicing' decide: el groomer no lo tiene.
    await withTransaction(async (client) => {
      await seedFile(client, TENANT_PATITAS)
      const count = async (user: string) => {
        await setRole(client, 'authenticated', user)
        return (
          await client.query(`select 1 from storage.objects where bucket_id = 'invoices'`)
        ).rowCount
      }
      expect(await count(USER_DUENO)).toBe(1)
      expect(await count(USER_RECEPCION)).toBe(1)
      expect(await count(USER_GROOMER)).toBe(0)
    })
  })

  it('aislamiento: el dueño de Patitas no ve los archivos de Huellitas Spa', async () => {
    await withTransaction(async (client) => {
      await seedFile(client, TENANT_HUELLITAS)
      await setRole(client, 'authenticated', USER_DUENO)
      const { rowCount } = await client.query(
        `select 1 from storage.objects where bucket_id = 'invoices'`,
      )
      expect(rowCount).toBe(0)
    })
  })

  it('nadie sube archivos desde el navegador', async () => {
    // Sin política de INSERT: solo la Edge Function sube la factura.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      await expect(
        client.query(
          `insert into storage.objects (bucket_id, name) values ('invoices', $1)`,
          [`${TENANT_PATITAS}/falsa.pdf`],
        ),
      ).rejects.toThrow(/row-level security/i)
    })
  })
})
