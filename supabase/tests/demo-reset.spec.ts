// Prueba el bloque de "estado de plataforma" de supabase/seed/demo_reset.sql
// (el que oculta empresas dadas de alta durante una demo).
//
// El script se ejecuta ENTERO, tal cual lo corre `npm run demo:reset`, pero
// dentro de una transacción de prueba: al terminar el test se hace rollback y
// la base queda exactamente como estaba. Así se prueba el archivo real, no
// una copia de su lógica.
//
// Por qué importa: este script corre contra producción. Si ocultara una
// empresa que no debe (un cliente real), esa empresa desaparecería de la
// lista del superadmin en plena operación.
import { readFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import { closePool, withTransaction } from './helpers'
import {
  BRANCH_CENTRO,
  BRANCH_DEL_VALLE,
  PRODUCT_ALIMENTO,
  PRODUCT_SHAMPOO,
  TENANT_HUELLITAS,
  TENANT_MIMOS,
  TENANT_PATITAS,
  USER_DUENO,
} from './fixtures'

afterAll(closePool)

const DEMO_RESET_SQL = readFileSync(new URL('../seed/demo_reset.sql', import.meta.url), 'utf8')

describe('demo_reset.sql — empresas fuera de la semilla', () => {
  it('oculta las empresas marcadas is_demo y NO toca las que no lo están', async () => {
    // Caso central de la marca is_demo: una empresa de demostración (creada
    // en una presentación) se oculta; un cliente real, sin marca, se queda
    // visible. Si el reset volviera a ocultar todo lo que no es semilla, el
    // cliente real desaparecería.
    await withTransaction(async (client) => {
      const demo = await client.query("insert into tenants (name) values ('Empresa de una demo') returning id")
      const real = await client.query("insert into tenants (name) values ('Cliente Real SA') returning id")
      await client.query('update tenant_platform_info set is_demo = true where tenant_id = $1', [demo.rows[0].id])

      await client.query(DEMO_RESET_SQL)

      const rows = await client.query(
        'select id, deleted_at is not null as is_hidden from tenants where id = any($1)',
        [[demo.rows[0].id, real.rows[0].id]],
      )
      const hiddenById = Object.fromEntries(rows.rows.map((r) => [r.id, r.is_hidden]))
      expect(hiddenById[demo.rows[0].id]).toBe(true)
      expect(hiddenById[real.rows[0].id]).toBe(false)
    })
  })

  it('nunca oculta las 3 empresas de la semilla', async () => {
    // Borde: aunque una empresa de la semilla tuviera is_demo = true (de
    // hecho lo tienen), el reset las excluye por id. Sin esa exclusión, el
    // primer reset dejaría la demo sin ninguno de sus negocios.
    await withTransaction(async (client) => {
      await client.query(DEMO_RESET_SQL)

      const rows = await client.query(
        'select count(*)::int as n from tenants where id = any($1) and deleted_at is null',
        [[TENANT_PATITAS, TENANT_HUELLITAS, TENANT_MIMOS]],
      )
      expect(rows.rows[0].n).toBe(3)
    })
  })

  it('una empresa sin marcar sobrevive aunque el reset se corra dos veces', async () => {
    // Borde: el reset es repetible (se corre antes de cada demo). La segunda
    // corrida no debe "descubrir" a un cliente real que la primera respetó.
    await withTransaction(async (client) => {
      const real = await client.query("insert into tenants (name) values ('Cliente Real SA') returning id")

      await client.query(DEMO_RESET_SQL)
      await client.query(DEMO_RESET_SQL)

      const rows = await client.query('select deleted_at from tenants where id = $1', [real.rows[0].id])
      expect(rows.rows[0].deleted_at).toBeNull()
    })
  })
})

describe('demo_reset.sql — inventario de demostración', () => {
  const stockOf = async (client: PoolClient, branchId: string, productId: string) =>
    (
      await client.query(
        'select coalesce(sum(quantity), 0)::int as n from stock_movements where tenant_id = $1 and branch_id = $2 and product_id = $3',
        [TENANT_PATITAS, branchId, productId],
      )
    ).rows[0].n as number

  it('crea las existencias base y las devuelve a su valor compensando lo vendido en una demo anterior', async () => {
    // Una demo vende producto y deja el stock bajo. Como los movimientos no se
    // pueden borrar, el reset debe COMPENSAR con un ajuste; si no, la siguiente
    // presentación arrancaría con "Sin inventario" en un producto que debería
    // tener piezas.
    await withTransaction(async (client) => {
      // La semilla no trae existencias: la primera corrida las crea.
      expect(await stockOf(client, BRANCH_CENTRO, PRODUCT_ALIMENTO)).toBe(0)
      await client.query(DEMO_RESET_SQL)
      expect(await stockOf(client, BRANCH_CENTRO, PRODUCT_ALIMENTO)).toBe(12)
      await client.query(
        `insert into stock_movements (tenant_id, branch_id, product_id, movement_type, quantity, created_by)
         values ($1, $2, $3, 'sale', -5, $4)`,
        [TENANT_PATITAS, BRANCH_CENTRO, PRODUCT_ALIMENTO, USER_DUENO],
      )
      await client.query(
        `insert into stock_movements (tenant_id, branch_id, product_id, movement_type, quantity, reason, created_by)
         values ($1, $2, $3, 'adjustment', 40, 'Conteo de prueba', $4)`,
        [TENANT_PATITAS, BRANCH_DEL_VALLE, PRODUCT_SHAMPOO, USER_DUENO],
      )

      await client.query(DEMO_RESET_SQL)

      expect(await stockOf(client, BRANCH_CENTRO, PRODUCT_ALIMENTO)).toBe(12)
      expect(await stockOf(client, BRANCH_DEL_VALLE, PRODUCT_SHAMPOO)).toBe(2)
    })
  })

  it('repetir el reset no escribe movimientos de más', async () => {
    // El reset se corre antes de cada demo. Si cada corrida agregara ajustes
    // aunque nada cambió, la bitácora de inventario se llenaría de ruido.
    await withTransaction(async (client) => {
      await client.query(DEMO_RESET_SQL)
      const before = await client.query('select count(*)::int as n from stock_movements')
      await client.query(DEMO_RESET_SQL)
      const after = await client.query('select count(*)::int as n from stock_movements')
      expect(after.rows[0].n).toBe(before.rows[0].n)
    })
  })

  it('oculta los productos creados en la demo y restaura los editados', async () => {
    // Un producto de prueba de una reunión anterior no debe aparecer en la
    // siguiente; y un precio cambiado en vivo debe volver al del guion.
    await withTransaction(async (client) => {
      const extra = await client.query(
        "insert into products (tenant_id, name, price_cents) values ($1, 'Producto de una demo', 5000) returning id",
        [TENANT_PATITAS],
      )
      await client.query('update products set price_cents = 1, deleted_at = now() where id = $1', [PRODUCT_SHAMPOO])

      await client.query(DEMO_RESET_SQL)

      const hidden = await client.query('select deleted_at from products where id = $1', [extra.rows[0].id])
      expect(hidden.rows[0].deleted_at).not.toBeNull()
      const shampoo = await client.query('select price_cents, deleted_at from products where id = $1', [PRODUCT_SHAMPOO])
      expect(shampoo.rows[0]).toEqual({ price_cents: 14500, deleted_at: null })
    })
  })

  it('no toca la configuración fiscal del negocio', async () => {
    // El demo desplegado conserva su organización y certificado de pruebas en
    // el PAC. Si el reset los borrara, habría que volver a subir el certificado
    // antes de cada presentación.
    await withTransaction(async (client) => {
      await client.query(
        `insert into tenant_invoicing_settings (tenant_id, pac_organization_id, csd_valid_until)
         values ($1, 'org_demo', '2030-01-01')`,
        [TENANT_PATITAS],
      )

      await client.query(DEMO_RESET_SQL)

      const { rows } = await client.query(
        'select pac_organization_id, csd_valid_until is not null as has_csd, deleted_at from tenant_invoicing_settings where tenant_id = $1',
        [TENANT_PATITAS],
      )
      expect(rows[0]).toEqual({ pac_organization_id: 'org_demo', has_csd: true, deleted_at: null })
    })
  })
})
