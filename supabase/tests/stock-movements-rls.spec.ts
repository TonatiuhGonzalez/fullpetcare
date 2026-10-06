// RLS y reglas de stock_movements + vista product_stock (fase 11, tareas 11.5 y
// 11.6 / HMH Four #2039). Mismo patrón que products-rls.spec.ts.
//
// Qué se protege aquí: la bitácora de inventario es la fuente de verdad de
// cuántas piezas hay. Si se pudiera editar, borrar, inventar ventas o dejar la
// existencia en negativo, el conteo dejaría de ser confiable.
//
// Usuarios sembrados: dueño (todas las sucursales), recepción (Centro), groomer
// (Centro, sin permiso de inventario), veterinario (Del Valle, solo ver).
import type { PoolClient } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { asAnon, asServiceRole, asUser, closePool, setRole, tryQuery, withTransaction } from './helpers'
import {
  BRANCH_CENTRO,
  BRANCH_DEL_VALLE,
  PRODUCT_ALIMENTO,
  PRODUCT_COLLAR_INACTIVO,
  PRODUCT_HUELLITAS,
  PRODUCT_SHAMPOO,
  TENANT_HUELLITAS,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
  USER_VET,
} from './fixtures'

afterAll(closePool)

const INSERT_SQL = `insert into stock_movements
  (tenant_id, branch_id, product_id, created_by, movement_type, quantity, reason)
  values ($1, $2, $3, $4, $5, $6, $7) returning id`

type Args = [string, string, string, string, string, number, string | null]

// Arma los parámetros de un movimiento de Patitas, con valores por defecto.
function movement(over: Partial<{
  branch: string
  product: string
  user: string
  type: string
  quantity: number
  reason: string | null
}> = {}): Args {
  return [
    TENANT_PATITAS,
    over.branch ?? BRANCH_CENTRO,
    over.product ?? PRODUCT_ALIMENTO,
    over.user ?? USER_DUENO,
    over.type ?? 'purchase',
    over.quantity ?? 10,
    over.reason ?? null,
  ]
}

// Mete movimientos saltándose RLS, solo para ARMAR el escenario del test.
async function seedMovements(client: PoolClient, rows: Args[]) {
  await setRole(client, 'service_role')
  for (const row of rows) await client.query(INSERT_SQL, row)
}

async function stockOf(client: PoolClient, product: string, branch: string): Promise<number> {
  const { rows } = await client.query(
    'select stock from product_stock where product_id = $1 and branch_id = $2',
    [product, branch],
  )
  return rows[0].stock
}

describe('stock_movements: aislamiento entre tenants', () => {
  it('el dueño de OTRO negocio no ve los movimientos de Patitas', async () => {
    // Si fallara, un negocio vería las compras, mermas y ventas de otro:
    // información comercial de la competencia.
    await withTransaction(async (client) => {
      await seedMovements(client, [movement()])
      await setRole(client, 'service_role')
      await client.query('update memberships set tenant_id = $1, role = $2 where user_id = $3', [
        TENANT_HUELLITAS,
        'owner',
        USER_GROOMER,
      ])
      await setRole(client, 'authenticated', USER_GROOMER)

      const { rows } = await client.query('select id from stock_movements')
      expect(rows).toHaveLength(0)
    })
  })

  it('el dueño de otro negocio no puede insertar movimientos con el tenant de Patitas', async () => {
    // El with check del INSERT: sin él se podría inflar o vaciar la existencia
    // de un negocio ajeno.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query('update memberships set tenant_id = $1, role = $2 where user_id = $3', [
        TENANT_HUELLITAS,
        'owner',
        USER_GROOMER,
      ])
      await setRole(client, 'authenticated', USER_GROOMER)

      const error = await tryQuery(client, INSERT_SQL, movement({ user: USER_GROOMER }))
      expect(error).toMatch(/row-level security/)
    })
  })

  it('no se puede registrar un movimiento de un producto de OTRO negocio', async () => {
    // Un movimiento con tenant propio pero producto ajeno ensuciaría el
    // catálogo del otro negocio. Lo frena el exists() de la política.
    await asUser(USER_DUENO, async (client) => {
      const error = await tryQuery(client, INSERT_SQL, movement({ product: PRODUCT_HUELLITAS }))
      expect(error).toMatch(/row-level security/)
    })
  })

  it('el visitante anónimo no puede leer movimientos ni existencias', async () => {
    // CLAUDE.md §7.3.3: anon no lee nada de negocio. En la tabla no hay política
    // para anon (RLS forzado) y devuelve 0 filas; la vista ni siquiera le da
    // permiso. Si alguien abriera cualquiera de las dos, este test falla.
    await withTransaction(async (client) => {
      await seedMovements(client, [movement()])
      await setRole(client, 'anon')
      const { rows } = await client.query('select id from stock_movements')
      expect(rows).toHaveLength(0)
    })
    await asAnon(async (client) => {
      expect(await tryQuery(client, 'select * from product_stock')).toMatch(/permission denied/)
    })
  })
})

describe('stock_movements: permiso y sucursal', () => {
  it('control: el dueño registra una compra en cualquier sucursal', async () => {
    await asUser(USER_DUENO, async (client) => {
      const created = await client.query(INSERT_SQL, movement({ branch: BRANCH_DEL_VALLE }))
      expect(created.rows).toHaveLength(1)
    })
  })

  it('recepción registra en SU sucursal, pero no en otra', async () => {
    // La existencia es por sucursal: recepción de Centro no debe mover el
    // inventario de Del Valle.
    await asUser(USER_RECEPCION, async (client) => {
      const own = await tryQuery(client, INSERT_SQL, movement({ user: USER_RECEPCION }))
      expect(own).toBeNull()
      const other = await tryQuery(
        client,
        INSERT_SQL,
        movement({ user: USER_RECEPCION, branch: BRANCH_DEL_VALLE }),
      )
      expect(other).toMatch(/row-level security/)
    })
  })

  it('el groomer no ve ni registra movimientos (no tiene el permiso inventory)', async () => {
    // Lo decide la política y no un v-if: aunque llame a la API directo, nada.
    await withTransaction(async (client) => {
      await seedMovements(client, [movement()])
      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows } = await client.query('select id from stock_movements')
      expect(rows).toHaveLength(0)
      const error = await tryQuery(client, INSERT_SQL, movement({ user: USER_GROOMER }))
      expect(error).toMatch(/row-level security/)
    })
  })

  it('el veterinario ve las existencias de su sucursal pero no puede registrar', async () => {
    // Decisión de la fase: vet solo ve (para saber si hay con qué atender).
    await withTransaction(async (client) => {
      await seedMovements(client, [movement({ branch: BRANCH_DEL_VALLE })])
      await setRole(client, 'authenticated', USER_VET)
      const { rows } = await client.query('select id from stock_movements')
      expect(rows).toHaveLength(1)
      const error = await tryQuery(client, INSERT_SQL, movement({ user: USER_VET, branch: BRANCH_DEL_VALLE }))
      expect(error).toMatch(/row-level security/)
    })
  })

  it('recepción no ve los movimientos de otra sucursal', async () => {
    // can_access_branch en la lectura: recepción de Centro no ve Del Valle.
    await withTransaction(async (client) => {
      await seedMovements(client, [movement({ branch: BRANCH_DEL_VALLE })])
      await setRole(client, 'authenticated', USER_RECEPCION)
      const { rows } = await client.query('select id from stock_movements')
      expect(rows).toHaveLength(0)
    })
  })

  it('un movimiento no se puede registrar a nombre de otra persona', async () => {
    // created_by = auth.uid(): si no, se podría culpar a un compañero de una merma.
    await asUser(USER_RECEPCION, async (client) => {
      const error = await tryQuery(client, INSERT_SQL, movement({ user: USER_DUENO }))
      expect(error).toMatch(/row-level security/)
    })
  })

  it('no se puede insertar a mano una venta ni un consumo', async () => {
    // Esos los generan las RPC de cobro y de atención. Si cualquiera con
    // permiso de editar pudiera insertarlos, fabricaría ventas falsas.
    await withTransaction(async (client) => {
      await seedMovements(client, [movement()])
      await setRole(client, 'authenticated', USER_DUENO)
      for (const type of ['sale', 'consumption']) {
        const error = await tryQuery(client, INSERT_SQL, movement({ type, quantity: -1 }))
        expect(error, type).toMatch(/row-level security/)
      }
      for (const type of ['sale_reversal', 'consumption_reversal']) {
        const error = await tryQuery(client, INSERT_SQL, movement({ type, quantity: 1 }))
        expect(error, type).toMatch(/row-level security/)
      }
    })
  })
})

describe('stock_movements: inmutabilidad', () => {
  async function insertOne(client: PoolClient): Promise<string> {
    const { rows } = await client.query(INSERT_SQL, movement())
    return rows[0].id
  }

  it('el dueño no puede modificar un movimiento', async () => {
    // Sin política de UPDATE, RLS lo ignora (0 filas). Si se pudiera editar, se
    // maquillaría el historial de existencias.
    await asUser(USER_DUENO, async (client) => {
      const id = await insertOne(client)
      const { rowCount } = await client.query('update stock_movements set quantity = 999 where id = $1', [id])
      expect(rowCount).toBe(0)
    })
  })

  it('ni siquiera service_role puede modificar un movimiento', async () => {
    // service_role se salta RLS, pero NO los triggers: es el cinturón.
    await asServiceRole(async (client) => {
      const { rows } = await client.query(INSERT_SQL, movement())
      const error = await tryQuery(client, 'update stock_movements set quantity = 999 where id = $1', [rows[0].id])
      expect(error).toMatch(/no se modifica/)
    })
  })

  it('el dueño no puede borrar un movimiento', async () => {
    // Sin política de DELETE (CLAUDE.md §7.3.2): 0 filas afectadas.
    await asUser(USER_DUENO, async (client) => {
      const id = await insertOne(client)
      const { rowCount } = await client.query('delete from stock_movements where id = $1', [id])
      expect(rowCount).toBe(0)
    })
  })

  it('ni siquiera service_role puede borrar un movimiento', async () => {
    // prevent_hard_delete(): el mismo cinturón del expediente clínico.
    await asServiceRole(async (client) => {
      const { rows } = await client.query(INSERT_SQL, movement())
      const error = await tryQuery(client, 'delete from stock_movements where id = $1', [rows[0].id])
      expect(error).toMatch(/No se puede borrar/)
    })
  })
})

describe('stock_movements: reglas de captura', () => {
  it('ajuste y merma exigen motivo; la compra no', async () => {
    // El motivo explica después por qué cambió la existencia. En blanco no vale.
    await asUser(USER_DUENO, async (client) => {
      expect(await tryQuery(client, INSERT_SQL, movement({ type: 'purchase' }))).toBeNull()
      await tryQuery(client, INSERT_SQL, movement({ type: 'purchase' }))
      for (const reason of [null, '   ']) {
        const adj = await tryQuery(client, INSERT_SQL, movement({ type: 'adjustment', quantity: 1, reason }))
        expect(adj).toMatch(/stock_movements_reason_required/)
        const loss = await tryQuery(client, INSERT_SQL, movement({ type: 'loss', quantity: -1, reason }))
        expect(loss).toMatch(/stock_movements_reason_required/)
      }
      expect(
        await tryQuery(client, INSERT_SQL, movement({ type: 'loss', quantity: -1, reason: 'Caducado' })),
      ).toBeNull()
    })
  })

  it('el signo debe corresponder al tipo y la cantidad no puede ser 0', async () => {
    // Una "compra" negativa o una merma positiva es error de captura (o trampa).
    // Se siembra existencia antes: el trigger de "no negativo" corre ANTES que
    // los check, y sin piezas contestaría con su propio error.
    await asUser(USER_DUENO, async (client) => {
      await client.query(INSERT_SQL, movement({ quantity: 10 }))
      expect(await tryQuery(client, INSERT_SQL, movement({ type: 'purchase', quantity: -5 }))).toMatch(
        /stock_movements_sign_matches_type/,
      )
      expect(
        await tryQuery(client, INSERT_SQL, movement({ type: 'loss', quantity: 3, reason: 'x' })),
      ).toMatch(/stock_movements_sign_matches_type/)
      expect(await tryQuery(client, INSERT_SQL, movement({ quantity: 0 }))).toMatch(/quantity_check/)
    })
  })

  it('un ajuste puede ser positivo o negativo', async () => {
    // Un conteo físico puede dar de más o de menos.
    await asUser(USER_DUENO, async (client) => {
      await client.query(INSERT_SQL, movement({ quantity: 5 }))
      expect(await tryQuery(client, INSERT_SQL, movement({ type: 'adjustment', quantity: 2, reason: 'Conteo' }))).toBeNull()
      expect(await tryQuery(client, INSERT_SQL, movement({ type: 'adjustment', quantity: -2, reason: 'Conteo' }))).toBeNull()
    })
  })

  it('no se puede sacar más de lo que hay: la existencia nunca queda negativa', async () => {
    // Decisión #2: con 0 no se vende, y se valida en la base. Con 3 en
    // existencia, una merma de 4 se rechaza; una de 3 deja justo en 0.
    await asUser(USER_DUENO, async (client) => {
      await client.query(INSERT_SQL, movement({ quantity: 3 }))
      const tooMuch = await tryQuery(client, INSERT_SQL, movement({ type: 'loss', quantity: -4, reason: 'Dañado' }))
      expect(tooMuch).toMatch(/No hay existencia suficiente: hay 3/)
      expect(await tryQuery(client, INSERT_SQL, movement({ type: 'loss', quantity: -3, reason: 'Dañado' }))).toBeNull()
      expect(await stockOf(client, PRODUCT_ALIMENTO, BRANCH_CENTRO)).toBe(0)
      const atZero = await tryQuery(client, INSERT_SQL, movement({ type: 'loss', quantity: -1, reason: 'Dañado' }))
      expect(atZero).toMatch(/No hay existencia suficiente: hay 0/)
    })
  })

  it('la existencia de una sucursal no alcanza para sacar piezas de otra', async () => {
    // El conteo es por sucursal: 10 en Centro no sirven en Del Valle.
    await asUser(USER_DUENO, async (client) => {
      await client.query(INSERT_SQL, movement({ branch: BRANCH_CENTRO, quantity: 10 }))
      const error = await tryQuery(
        client,
        INSERT_SQL,
        movement({ branch: BRANCH_DEL_VALLE, type: 'loss', quantity: -1, reason: 'Dañado' }),
      )
      expect(error).toMatch(/No hay existencia suficiente: hay 0/)
    })
  })
})

describe('product_stock: existencia actual', () => {
  it('un producto sin movimientos tiene existencia 0, no NULL', async () => {
    // Si fuera NULL, la pantalla mostraría "NaN" en cada producto nuevo.
    await asUser(USER_DUENO, async (client) => {
      const { rows } = await client.query(
        'select stock from product_stock where product_id = $1 and branch_id = $2',
        [PRODUCT_SHAMPOO, BRANCH_CENTRO],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].stock).toBe(0)
    })
  })

  it('es la suma correcta con compras, ventas, ajustes y mermas mezclados, por sucursal', async () => {
    // +10 compra, -2 venta, +3 ajuste, -1 merma = 10 en Centro; Del Valle
    // no se contamina con los movimientos de Centro.
    await withTransaction(async (client) => {
      await seedMovements(client, [
        movement({ quantity: 10 }),
        movement({ type: 'sale', quantity: -2 }),
        movement({ type: 'adjustment', quantity: 3, reason: 'Conteo' }),
        movement({ type: 'loss', quantity: -1, reason: 'Dañado' }),
        movement({ branch: BRANCH_DEL_VALLE, quantity: 4 }),
      ])
      await setRole(client, 'authenticated', USER_DUENO)
      expect(await stockOf(client, PRODUCT_ALIMENTO, BRANCH_CENTRO)).toBe(10)
      expect(await stockOf(client, PRODUCT_ALIMENTO, BRANCH_DEL_VALLE)).toBe(4)
    })
  })

  it('un producto borrado no aparece', async () => {
    // El borrado suave se oculta también aquí, para que no salga en la lista.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query('update products set deleted_at = now() where id = $1', [PRODUCT_COLLAR_INACTIVO])
      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query('select 1 from product_stock where product_id = $1', [PRODUCT_COLLAR_INACTIVO])
      expect(rows).toHaveLength(0)
    })
  })

  it('respeta RLS de quien consulta: recepción ve solo su sucursal y el groomer nada', async () => {
    // security_invoker: sin él la vista correría con permisos de su dueño y
    // mostraría las existencias de todos los negocios y sucursales.
    await asUser(USER_RECEPCION, async (client) => {
      const { rows } = await client.query('select distinct branch_id, tenant_id from product_stock')
      expect(rows).toEqual([{ branch_id: BRANCH_CENTRO, tenant_id: TENANT_PATITAS }])
    })
    await asUser(USER_GROOMER, async (client) => {
      const { rows } = await client.query('select 1 from product_stock')
      expect(rows).toHaveLength(0)
    })
  })

  it('el dueño de otro negocio no ve existencias de Patitas', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query('update memberships set tenant_id = $1, role = $2 where user_id = $3', [
        TENANT_HUELLITAS,
        'owner',
        USER_GROOMER,
      ])
      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows } = await client.query('select distinct tenant_id from product_stock')
      expect(rows.map((r) => r.tenant_id)).toEqual([TENANT_HUELLITAS])
    })
  })
})
