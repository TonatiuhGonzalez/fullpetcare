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

import { closePool, setRole, withTransaction } from './helpers'
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

// Las 7 citas del guion fijo (Rocky y Max). El presentador las cobra en vivo.
const HERO_APPOINTMENTS = Array.from({ length: 7 }, (_, i) => `30000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)
const CUT_ID = '35000000-0000-4000-8000-000000000001'
const saleId = (n: number) => `34000000-0000-4000-8000-${String(n).padStart(12, '0')}`

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

describe('demo_reset.sql — ventas y caja de demostración (12.14)', () => {
  const one = async (client: PoolClient, sql: string, params: unknown[] = []) =>
    (await client.query(sql, params)).rows[0]

  it('deja 12 ventas pagadas y 1 cancelada, sin cobrar ninguna cita del guion', async () => {
    // El reset siembra historia para que Reportes no salga vacío, pero las 7
    // citas del guion deben seguir SIN cobrar: cobrarlas en vivo es el momento
    // central de la demo. Si una quedara cobrada, el botón "Cobrar" no aparecería.
    await withTransaction(async (client) => {
      await client.query(DEMO_RESET_SQL)

      const counts = await one(
        client,
        `select count(*) filter (where status = 'paid')::int as paid,
                count(*) filter (where status = 'cancelled')::int as cancelled
           from sales where tenant_id = $1 and deleted_at is null`,
        [TENANT_PATITAS],
      )
      expect(counts).toEqual({ paid: 12, cancelled: 1 })

      const charged = await one(
        client,
        `select count(*)::int as n from sale_items
          where deleted_at is null and appointment_id = any($1::uuid[])`,
        [HERO_APPOINTMENTS],
      )
      expect(charged.n).toBe(0)
    })
  })

  it('cada venta cuadra: las partidas suman su total y los pagos lo cubren', async () => {
    // Un ticket que no cuadra (pagos de menos, IVA mal desglosado) se vería en
    // pantalla y en el reporte. La semilla arma estas cuentas a mano en SQL, no
    // con la RPC de cobro, así que este test es la red que la vigila.
    await withTransaction(async (client) => {
      await client.query(DEMO_RESET_SQL)

      const { rows } = await client.query(
        `select s.folio, s.total_cents, s.subtotal_cents, s.tax_cents, s.discount_cents,
                (select coalesce(sum(line_total_cents), 0)::int from sale_items i where i.sale_id = s.id and i.deleted_at is null) as items,
                (select coalesce(sum(amount_cents), 0)::int from payments p where p.sale_id = s.id and p.deleted_at is null) as paid
           from sales s where s.tenant_id = $1 and s.deleted_at is null`,
        [TENANT_PATITAS],
      )
      expect(rows).toHaveLength(13)
      for (const r of rows) {
        expect(r.subtotal_cents + r.tax_cents, `folio ${r.folio}`).toBe(r.items)
        expect(r.total_cents, `folio ${r.folio}`).toBe(r.items - r.discount_cents)
        expect(r.paid, `folio ${r.folio}`).toBeGreaterThanOrEqual(r.total_cents)
      }
    })
  })

  it('los reportes del dueño salen con datos: ventas, productos y empleados', async () => {
    // Es el objetivo de la tarea: que "Reportes" no salga vacío en la demo.
    // Se consulta con las mismas RPC y el mismo rol que la pantalla.
    await withTransaction(async (client) => {
      await client.query(DEMO_RESET_SQL)
      const expected = await one(
        client,
        `select count(*)::int as n, sum(total_cents)::int as total
           from sales where tenant_id = $1 and deleted_at is null and status = 'paid'`,
        [TENANT_PATITAS],
      )

      await setRole(client, 'authenticated', USER_DUENO)
      const summary = await one(
        client,
        `select report_sales_summary($1, current_date - 8, current_date + 1, null) as r`,
        [TENANT_PATITAS],
      )
      expect(summary.r.totals.sales_count).toBe(expected.n)
      expect(summary.r.totals.total_cents).toBe(expected.total)

      const top = await one(
        client,
        `select report_top_items($1, current_date - 8, current_date + 1, null, 20) as r`,
        [TENANT_PATITAS],
      )
      expect(top.r.services.length).toBeGreaterThan(0)
      expect(top.r.products.length).toBeGreaterThan(0)

      const staff = await one(
        client,
        `select report_staff_activity($1, current_date - 8, current_date + 1, null) as r`,
        [TENANT_PATITAS],
      )
      const withActivity = staff.r.filter((e: { user_id: string | null }) => e.user_id !== null)
      expect(withActivity.length).toBeGreaterThanOrEqual(3) // groomer, vet y quien cobra en mostrador
    })
  })

  it('deja un corte cerrado que cuadra y ninguna caja abierta', async () => {
    // Caja debe mostrar un corte de ejemplo y arrancar cerrada. El esperado se
    // verifica a mano: fondo 800.00 + efectivo que se queda (250.00 de la venta
    // 1 + 389.00 de la 3, que se pagó con 400.00 y dio 11.00 de cambio) − retiro
    // 300.00 − gasto 85.00 = 1,054.00. Si el cambio se contara como ingreso, o se
    // olvidara el retiro, el corte "cuadraría" mal en la demo.
    await withTransaction(async (client) => {
      await client.query(DEMO_RESET_SQL)

      const cut = await one(client, 'select * from cash_sessions where id = $1', [CUT_ID])
      expect(cut.closed_at).not.toBeNull()
      expect(cut.expected_cents).toBe(105400)
      expect(cut.counted_cents).toBe(105000)
      expect(cut.difference_cents).toBe(-400)

      const open = await one(
        client,
        'select count(*)::int as n from cash_sessions where tenant_id = $1 and closed_at is null and deleted_at is null',
        [TENANT_PATITAS],
      )
      expect(open.n).toBe(0)
    })
  })

  it('las ventas del corte caen dentro del turno del corte', async () => {
    // El esperado del corte está congelado: solo sigue cuadrando con lo que Caja
    // recalcula si las ventas 1 a 5 viven dentro de [apertura, cierre).
    await withTransaction(async (client) => {
      await client.query(DEMO_RESET_SQL)

      const { rows } = await client.query(
        `select count(*)::int as n from sales s, cash_sessions c
          where c.id = $1 and s.id = any($2::uuid[])
            and s.paid_at >= c.opened_at and s.paid_at < c.closed_at and s.branch_id = c.branch_id`,
        [CUT_ID, [1, 2, 3, 4, 5].map(saleId)],
      )
      expect(rows[0].n).toBe(5)
    })
  })

  it('oculta la caja que una demo anterior dejó abierta', async () => {
    // Un corte cerrado no se puede ocultar, pero una caja abierta sí. Si se
    // quedara abierta, la siguiente demo arrancaría con la caja a medias y el
    // presentador no podría "abrir caja" en vivo (solo una por sucursal).
    await withTransaction(async (client) => {
      await client.query(DEMO_RESET_SQL)
      await client.query(
        `insert into cash_sessions (tenant_id, branch_id, opened_by, opening_float_cents)
         values ($1, $2, $3, 50000)`,
        [TENANT_PATITAS, BRANCH_CENTRO, USER_DUENO],
      )

      await client.query(DEMO_RESET_SQL)

      const open = await one(
        client,
        'select count(*)::int as n from cash_sessions where tenant_id = $1 and closed_at is null and deleted_at is null',
        [TENANT_PATITAS],
      )
      expect(open.n).toBe(0)
    })
  })

  it('repetir el reset no duplica nada ni toca el corte ya cerrado', async () => {
    // Se corre antes de cada demo. Si cada corrida sumara ventas, partidas o
    // cortes, Reportes duplicaría los totales y el historial de Caja se llenaría
    // de cortes iguales que nunca se pueden borrar.
    await withTransaction(async (client) => {
      await client.query(DEMO_RESET_SQL)
      const snapshot = async () =>
        one(
          client,
          `select (select count(*)::int from sales where tenant_id = $1) as sales,
                  (select count(*)::int from sale_items where tenant_id = $1) as items,
                  (select count(*)::int from payments where tenant_id = $1) as payments,
                  (select count(*)::int from appointments where tenant_id = $1) as appointments,
                  (select count(*)::int from cash_sessions where tenant_id = $1) as sessions,
                  (select count(*)::int from cash_movements where tenant_id = $1) as movements,
                  (select to_jsonb(c)::text from cash_sessions c where id = $2) as cut`,
          [TENANT_PATITAS, CUT_ID],
        )
      const before = await snapshot()

      await client.query(DEMO_RESET_SQL)

      expect(await snapshot()).toEqual(before)
    })
  })

  it('revive una venta de la semilla que se canceló o se ocultó en la demo', async () => {
    // El presentador puede cancelar un ticket para enseñarlo. El reset debe
    // devolverlo a como estaba, no dejar el reporte con una venta de menos.
    await withTransaction(async (client) => {
      await client.query(DEMO_RESET_SQL)
      await client.query("update sales set status = 'cancelled' where id = $1", [saleId(2)])
      await client.query('update sales set deleted_at = now() where id = $1', [saleId(6)])

      await client.query(DEMO_RESET_SQL)

      const rows = await client.query('select id, status, deleted_at from sales where id = any($1::uuid[])', [
        [saleId(2), saleId(6)],
      ])
      for (const r of rows.rows) {
        expect(r.status).toBe('paid')
        expect(r.deleted_at).toBeNull()
      }
    })
  })

  it('no choca con los folios de ventas de demos anteriores', async () => {
    // Los folios son únicos por sucursal e incluyen ventas ocultas. Si el reset
    // numerara desde 1, en producción (que ya tiene folios) fallaría con "clave
    // duplicada" justo antes de una demo.
    await withTransaction(async (client) => {
      await client.query(
        `insert into sales (tenant_id, branch_id, customer_id, folio, status, paid_at, deleted_at)
         values ($1, $2, 'd0000000-0000-4000-8000-000000000001', 50, 'paid', now(), now())`,
        [TENANT_PATITAS, BRANCH_CENTRO],
      )

      await client.query(DEMO_RESET_SQL)

      const first = await one(client, 'select folio from sales where id = $1', [saleId(1)])
      expect(first.folio).toBeGreaterThan(50)
    })
  })
})
