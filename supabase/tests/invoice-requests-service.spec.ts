// Prueba services/invoiceRequests.ts — sesión real. Sin test propio hasta
// ahora (revisión de cobertura, tarea 8.2): invoice-requests-rls.spec.ts
// prueba la política de la TABLA insertando a mano por `pg`, pero nunca
// ejercitó la función `create()` en sí — en particular, el mapeo a
// `payment_form_code` (CLAUDE.md §8.4), que es la única lógica real de
// este archivo y hasta ahora no tenía ni un solo test.
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import pg from 'pg'

import * as invoiceRequestsService from '@/services/invoiceRequests'
import { supabase } from '@/services/supabase'

import { BRANCH_CENTRO, CUSTOMER_SANTIAGO, TENANT_PATITAS } from './fixtures'

const DUENO_EMAIL = 'dueno@patitasfelices.mx'
const DUENO_PASSWORD = 'Demo1234!'

const { Pool } = pg
const cleanupPool = new Pool({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})

const FISCAL_DATA = {
  rfc: 'NURS850312AB1',
  legalName: 'Santiago Núñez Reyes',
  taxRegimeCode: '612',
  cfdiUse: 'G03',
  postalCode: '03100',
}

async function seedSale(): Promise<string> {
  const client = await cleanupPool.connect()
  try {
    await client.query('set role service_role')
    const { rows } = await client.query(
      `insert into sales (tenant_id, branch_id, customer_id, folio, status, total_cents)
       values ($1, $2, $3, (select coalesce(max(folio), 0) + 1 from sales where tenant_id = $1 and branch_id = $2), 'paid', 35000)
       returning id`,
      [TENANT_PATITAS, BRANCH_CENTRO, CUSTOMER_SANTIAGO],
    )
    return rows[0].id
  } finally {
    await client.query('reset role')
    client.release()
  }
}

async function hardDelete(saleIds: string[]): Promise<void> {
  if (saleIds.length === 0) return
  const client = await cleanupPool.connect()
  try {
    await client.query('set role service_role')
    await client.query('delete from invoice_requests where sale_id = any($1::uuid[])', [saleIds])
    await client.query('delete from sales where id = any($1::uuid[])', [saleIds])
  } finally {
    await client.query('reset role')
    client.release()
  }
}

afterAll(() => cleanupPool.end())

describe('services/invoiceRequests.ts contra Supabase local', () => {
  const createdSaleIds: string[] = []

  afterEach(async () => {
    await supabase.auth.signOut()
    await hardDelete(createdSaleIds)
    createdSaleIds.length = 0
  })

  async function signIn(): Promise<void> {
    const { error } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (error) throw error
  }

  it('un solo pago en efectivo mapea a payment_form_code "01"', async () => {
    await signIn()
    const saleId = await seedSale()
    createdSaleIds.push(saleId)

    const request = await invoiceRequestsService.create(TENANT_PATITAS, saleId, FISCAL_DATA, [
      { method: 'cash', amountCents: 35000 },
    ])

    expect(request.payment_form_code).toBe('01')
    expect(request.payment_method_code).toBe('PUE')
    expect(request.status).toBe('pending')
  })

  it('un solo pago con tarjeta mapea a "04"', async () => {
    await signIn()
    const saleId = await seedSale()
    createdSaleIds.push(saleId)

    const request = await invoiceRequestsService.create(TENANT_PATITAS, saleId, FISCAL_DATA, [
      { method: 'card', amountCents: 35000 },
    ])

    expect(request.payment_form_code).toBe('04')
  })

  it('un solo pago por transferencia mapea a "03"', async () => {
    await signIn()
    const saleId = await seedSale()
    createdSaleIds.push(saleId)

    const request = await invoiceRequestsService.create(TENANT_PATITAS, saleId, FISCAL_DATA, [
      { method: 'transfer_spei', amountCents: 35000 },
    ])

    expect(request.payment_form_code).toBe('03')
  })

  it('dos formas de pago distintas (efectivo + tarjeta) mapean a "06" (SAT: dos o más formas)', async () => {
    await signIn()
    const saleId = await seedSale()
    createdSaleIds.push(saleId)

    const request = await invoiceRequestsService.create(TENANT_PATITAS, saleId, FISCAL_DATA, [
      { method: 'cash', amountCents: 20000 },
      { method: 'card', amountCents: 15000 },
    ])

    expect(request.payment_form_code).toBe('06')
  })

  it('guarda los datos fiscales del cliente tal cual se le pasan', async () => {
    await signIn()
    const saleId = await seedSale()
    createdSaleIds.push(saleId)

    const request = await invoiceRequestsService.create(TENANT_PATITAS, saleId, FISCAL_DATA, [
      { method: 'cash', amountCents: 35000 },
    ])

    expect(request).toMatchObject({
      rfc: FISCAL_DATA.rfc,
      legal_name: FISCAL_DATA.legalName,
      tax_regime_code: FISCAL_DATA.taxRegimeCode,
      cfdi_use: FISCAL_DATA.cfdiUse,
      postal_code: FISCAL_DATA.postalCode,
    })
  })

  it('getBySale recupera la misma solicitud por el id de la venta', async () => {
    await signIn()
    const saleId = await seedSale()
    createdSaleIds.push(saleId)

    const created = await invoiceRequestsService.create(TENANT_PATITAS, saleId, FISCAL_DATA, [
      { method: 'cash', amountCents: 35000 },
    ])
    const fetched = await invoiceRequestsService.getBySale(saleId)

    expect(fetched?.id).toBe(created.id)
  })

  it('getBySale da null si la venta no tiene ninguna solicitud de factura', async () => {
    await signIn()
    const saleId = await seedSale()
    createdSaleIds.push(saleId)

    const fetched = await invoiceRequestsService.getBySale(saleId)
    expect(fetched).toBeNull()
  })
})
