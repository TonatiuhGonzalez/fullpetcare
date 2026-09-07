// RLS de invoice_requests (revisión de seguridad, tarea 8.3) — se quedó
// sin su propio test de aislamiento desde que se escribió la migración en
// la fase 5 (checkout-rpc.spec.ts prueba que el RPC de cobro funciona de
// punta a punta, pero nunca ejercitó la política de invoice_requests
// directo). Mismo patrón que el resto de las tablas de cobro: el acceso
// sigue al de la VENTA (un EXISTS contra sales), así que aislarla es
// aislar esa venta.
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
} from './fixtures'

afterAll(closePool)

/** Una venta mínima de verdad (no importa el detalle del cobro, solo que exista). */
async function seedSale(client: PoolClient): Promise<string> {
  await setRole(client, 'service_role')
  const { rows } = await client.query(
    `insert into sales (tenant_id, branch_id, customer_id, folio, status, total_cents)
     values ($1, $2, $3, 999, 'paid', 25000)
     returning id`,
    [TENANT_PATITAS, BRANCH_CENTRO, CUSTOMER_SOFIA],
  )
  return rows[0].id
}

async function seedInvoiceRequest(client: PoolClient, saleId: string): Promise<string> {
  await setRole(client, 'service_role')
  const { rows } = await client.query(
    `insert into invoice_requests (tenant_id, sale_id, rfc, legal_name, tax_regime_code, cfdi_use, postal_code, payment_form_code, payment_method_code)
     values ($1, $2, 'XAXX010101000', 'Público en general', '616', 'S01', '01000', '01', 'PUE')
     returning id`,
    [TENANT_PATITAS, saleId],
  )
  return rows[0].id
}

describe('invoice_requests: aislamiento entre tenants', () => {
  it('un miembro de OTRO tenant no ve la solicitud de factura', async () => {
    await withTransaction(async (client) => {
      const saleId = await seedSale(client)
      const invoiceRequestId = await seedInvoiceRequest(client, saleId)

      await setRole(client, 'service_role')
      await client.query('update memberships set tenant_id = $1 where user_id = $2', [
        TENANT_HUELLITAS,
        USER_GROOMER,
      ])

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows } = await client.query(
        'select id from invoice_requests where id = $1',
        [invoiceRequestId],
      )
      expect(rows).toHaveLength(0)
    })
  })

  it('control: un miembro del MISMO tenant sí la ve', async () => {
    await withTransaction(async (client) => {
      const saleId = await seedSale(client)
      const invoiceRequestId = await seedInvoiceRequest(client, saleId)

      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query(
        'select id from invoice_requests where id = $1',
        [invoiceRequestId],
      )
      expect(rows).toHaveLength(1)
    })
  })
})

describe('invoice_requests: política de INSERT', () => {
  it('owner/receptionist pueden crear una solicitud de factura para una venta de su tenant', async () => {
    await withTransaction(async (client) => {
      const saleId = await seedSale(client)

      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query(
        `insert into invoice_requests (tenant_id, sale_id, rfc, legal_name, tax_regime_code, cfdi_use, postal_code, payment_form_code, payment_method_code)
         values ($1, $2, 'XAXX010101000', 'Público en general', '616', 'S01', '01000', '01', 'PUE')
         returning id`,
        [TENANT_PATITAS, saleId],
      )
      expect(rows).toHaveLength(1)
    })
  })

  it('un groomer no puede crear una solicitud de factura (no es su rol, CLAUDE.md §6.1)', async () => {
    await withTransaction(async (client) => {
      const saleId = await seedSale(client)

      await setRole(client, 'authenticated', USER_GROOMER)
      await expect(
        client.query(
          `insert into invoice_requests (tenant_id, sale_id, rfc, legal_name, tax_regime_code, cfdi_use, postal_code, payment_form_code, payment_method_code)
           values ($1, $2, 'XAXX010101000', 'Público en general', '616', 'S01', '01000', '01', 'PUE')`,
          [TENANT_PATITAS, saleId],
        ),
      ).rejects.toThrow(/row-level security/i)
    })
  })
})
