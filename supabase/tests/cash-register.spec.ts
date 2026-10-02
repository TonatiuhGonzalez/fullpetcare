// Caja (tareas 12.3 a 12.6, migración cash_register.sql). Lo que se rompería en
// silencio:
//   - que dos cajas queden abiertas a la vez en una sucursal,
//   - que alguien sin permiso (o de otra sucursal / otro negocio) abra, cierre
//     o vea cajas,
//   - que un corte cerrado se edite para "arreglar" un faltante,
//   - que se registren retiros en una caja cerrada o ajena,
//   - que el cierre calcule un efectivo esperado distinto al de lib/cashCount.ts.
import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import { summarizeShift, type CashSale } from '@/lib/cashCount'
import { closePool, setRole, withTransaction } from './helpers'
import {
  BRANCH_CENTRO,
  BRANCH_DEL_VALLE,
  CUSTOMER_SOFIA,
  TENANT_HUELLITAS,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
  USER_VET,
} from './fixtures'

afterAll(closePool)

// Tras un error, Postgres deja la transacción abortada: para encadenar varias
// comprobaciones de "esto debe fallar" en un mismo test se usa un SAVEPOINT.
async function expectFails(
  client: PoolClient,
  action: () => Promise<unknown>,
  message: RegExp,
) {
  await client.query('savepoint expect_fails')
  let error: unknown = null
  try {
    await action()
  } catch (e) {
    error = e
  }
  await client.query('rollback to savepoint expect_fails')
  expect(error, 'debía fallar').not.toBeNull()
  expect((error as Error).message).toMatch(message)
}

const OPEN_SQL = 'select open_cash_session($1, $2, $3) as id'

async function openAs(
  client: PoolClient,
  user: string,
  branch = BRANCH_CENTRO,
  float = 50000,
) {
  await setRole(client, 'authenticated', user)
  const { rows } = await client.query(OPEN_SQL, [branch, float, null])
  return rows[0].id as string
}

async function closeAs(client: PoolClient, user: string, id: string, counted: number) {
  await setRole(client, 'authenticated', user)
  const { rows } = await client.query('select * from close_cash_session($1, $2, $3)', [
    id,
    counted,
    null,
  ])
  return rows[0]
}

describe('open_cash_session: quién y cuándo', () => {
  it('recepción abre la caja de su sucursal con un fondo', async () => {
    // El camino feliz de cada mañana. Si fallara, nadie podría abrir turno.
    await withTransaction(async (client) => {
      const id = await openAs(client, USER_RECEPCION)
      await setRole(client, 'service_role')
      const { rows } = await client.query('select * from cash_sessions where id = $1', [
        id,
      ])
      expect(rows[0]).toMatchObject({
        branch_id: BRANCH_CENTRO,
        opened_by: USER_RECEPCION,
        opening_float_cents: 50000,
        closed_at: null,
      })
    })
  })

  it('no deja abrir una segunda caja en la misma sucursal, pero sí en otra', async () => {
    // Dos cajas abiertas harían que una venta pudiera caer en dos turnos y el
    // efectivo esperado se contara doble. Lo impide un índice, no la pantalla.
    await withTransaction(async (client) => {
      await openAs(client, USER_DUENO, BRANCH_CENTRO)
      await expect(client.query(OPEN_SQL, [BRANCH_CENTRO, 0, null])).rejects.toThrow(
        /ya hay una caja abierta/i,
      )
    })
    await withTransaction(async (client) => {
      await openAs(client, USER_DUENO, BRANCH_CENTRO)
      await expect(openAs(client, USER_DUENO, BRANCH_DEL_VALLE)).resolves.toBeDefined()
    })
  })

  it('tras cerrar una caja se puede abrir otra (turno de la tarde)', async () => {
    await withTransaction(async (client) => {
      const first = await openAs(client, USER_RECEPCION)
      await closeAs(client, USER_RECEPCION, first, 50000)
      await expect(openAs(client, USER_RECEPCION)).resolves.not.toBe(first)
    })
  })

  it('un groomer y un vet (sin permiso de caja) no pueden abrir', async () => {
    // El permiso 'cash_register' lo decide una fila de role_permissions.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_GROOMER)
      await expect(client.query(OPEN_SQL, [BRANCH_CENTRO, 0, null])).rejects.toThrow(
        /no tienes permiso/i,
      )
    })
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_VET)
      await expect(client.query(OPEN_SQL, [BRANCH_DEL_VALLE, 0, null])).rejects.toThrow(
        /no tienes permiso/i,
      )
    })
  })

  it('recepción no puede abrir la caja de una sucursal que no tiene asignada', async () => {
    // Recepción trabaja en Centro; Del Valle no es suya.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_RECEPCION)
      await expect(client.query(OPEN_SQL, [BRANCH_DEL_VALLE, 0, null])).rejects.toThrow(
        /no tienes permiso/i,
      )
    })
  })

  it('un fondo negativo se rechaza', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      await expect(client.query(OPEN_SQL, [BRANCH_CENTRO, -1, null])).rejects.toThrow(
        /fondo inicial/i,
      )
    })
  })

  it('nadie escribe cash_sessions directo, ni el dueño', async () => {
    // Sin esto, el dueño podría insertar una caja "cerrada" con el esperado y
    // la diferencia que quisiera, saltándose el cálculo de la base.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      await expect(
        client.query(
          `insert into cash_sessions (tenant_id, branch_id, opened_by, opening_float_cents)
           values ($1, $2, $3, 0)`,
          [TENANT_PATITAS, BRANCH_CENTRO, USER_DUENO],
        ),
      ).rejects.toThrow(/row-level security/i)
    })
  })
})

describe('cash_sessions: lectura y aislamiento', () => {
  it('recepción ve las cajas de su sucursal; el groomer no ve ninguna', async () => {
    await withTransaction(async (client) => {
      await openAs(client, USER_DUENO, BRANCH_CENTRO)
      await setRole(client, 'authenticated', USER_RECEPCION)
      expect((await client.query('select 1 from cash_sessions')).rowCount).toBe(1)
      await setRole(client, 'authenticated', USER_GROOMER)
      expect((await client.query('select 1 from cash_sessions')).rowCount).toBe(0)
    })
  })

  it('recepción no ve las cajas de otra sucursal', async () => {
    // Cada sucursal ve solo sus cortes.
    await withTransaction(async (client) => {
      await openAs(client, USER_DUENO, BRANCH_DEL_VALLE)
      await setRole(client, 'authenticated', USER_RECEPCION)
      expect((await client.query('select 1 from cash_sessions')).rowCount).toBe(0)
    })
  })

  it('un negocio nunca ve las cajas de otro', async () => {
    // Huellitas no tiene personal en la semilla: se mueve al groomer de Patitas
    // a Huellitas y se confirma que no ve lo de Patitas.
    await withTransaction(async (client) => {
      await openAs(client, USER_DUENO, BRANCH_CENTRO)
      await setRole(client, 'service_role')
      await client.query('update memberships set tenant_id = $1 where user_id = $2', [
        TENANT_HUELLITAS,
        USER_RECEPCION,
      ])
      await setRole(client, 'authenticated', USER_RECEPCION)
      expect((await client.query('select 1 from cash_sessions')).rowCount).toBe(0)
    })
  })

  it('anon no ve nada', async () => {
    await withTransaction(async (client) => {
      await openAs(client, USER_DUENO)
      await setRole(client, 'anon')
      expect((await client.query('select 1 from cash_sessions')).rowCount).toBe(0)
    })
  })
})

describe('close_cash_session', () => {
  it('cierra, congela esperado, contado y diferencia, y quién cerró', async () => {
    // Sin ventas: esperado = fondo. Contar $10 de menos deja un faltante de $10.
    await withTransaction(async (client) => {
      const id = await openAs(client, USER_RECEPCION, BRANCH_CENTRO, 50000)
      const closed = await closeAs(client, USER_RECEPCION, id, 49000)
      expect(closed).toMatchObject({
        expected_cents: 50000,
        counted_cents: 49000,
        difference_cents: -1000,
        closed_by: USER_RECEPCION,
      })
      expect(closed.closed_at).not.toBeNull()
    })
  })

  it('no se puede cerrar dos veces ni por alguien sin permiso o de otra sucursal', async () => {
    await withTransaction(async (client) => {
      const id = await openAs(client, USER_DUENO, BRANCH_DEL_VALLE)
      await expectFails(
        client,
        () => closeAs(client, USER_GROOMER, id, 0),
        /no tienes permiso/i,
      )
      await expectFails(
        client,
        () => closeAs(client, USER_RECEPCION, id, 0),
        /no tienes permiso/i,
      )
      await closeAs(client, USER_DUENO, id, 0)
      await expectFails(
        client,
        () => closeAs(client, USER_DUENO, id, 0),
        /ya está cerrada/i,
      )
    })
  })

  it('un conteo negativo se rechaza', async () => {
    await withTransaction(async (client) => {
      const id = await openAs(client, USER_DUENO)
      await expect(closeAs(client, USER_DUENO, id, -1)).rejects.toThrow(
        /efectivo contado/i,
      )
    })
  })

  it('un corte cerrado no se puede modificar ni borrar, ni con service_role', async () => {
    // Es un documento contable: cambiar el contado después sería "arreglar" un faltante.
    await withTransaction(async (client) => {
      const id = await openAs(client, USER_DUENO)
      await closeAs(client, USER_DUENO, id, 100)
      await setRole(client, 'service_role')
      await expect(
        client.query(
          'update cash_sessions set counted_cents = 50000, difference_cents = 50000 - expected_cents where id = $1',
          [id],
        ),
      ).rejects.toThrow(/no se puede modificar/i)
      await expect(
        client.query('delete from cash_sessions where id = $1', [id]),
      ).rejects.toThrow()
    })
  })

  it('la base no admite un cierre a medias ni una diferencia que no sea contado − esperado', async () => {
    // Los checks son el último seguro: aunque una RPC futura se equivocara.
    await withTransaction(async (client) => {
      const id = await openAs(client, USER_DUENO)
      await setRole(client, 'service_role')
      await expectFails(
        client,
        () =>
          client.query(
            `update cash_sessions set closed_at = now() + interval '1 hour' where id = $1`,
            [id],
          ),
        /closing_fields/,
      )
      await expectFails(
        client,
        () =>
          client.query(
            `update cash_sessions set closed_at = now() + interval '1 hour', closed_by = $2, expected_cents = 100,
               counted_cents = 100, difference_cents = 5 where id = $1`,
            [id, USER_DUENO],
          ),
        /difference_check/,
      )
    })
  })
})

describe('cash_movements', () => {
  const move = (
    client: PoolClient,
    user: string,
    sessionId: string,
    type = 'expense',
    amount = 3000,
    reason = 'Hielo',
    branch = BRANCH_CENTRO,
  ) =>
    client.query(
      `insert into cash_movements (tenant_id, branch_id, cash_session_id, movement_type, amount_cents, reason, created_by)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [TENANT_PATITAS, branch, sessionId, type, amount, reason, user],
    )

  it('recepción registra un gasto en la caja abierta', async () => {
    await withTransaction(async (client) => {
      const id = await openAs(client, USER_RECEPCION)
      await setRole(client, 'authenticated', USER_RECEPCION)
      await expect(move(client, USER_RECEPCION, id)).resolves.toBeDefined()
    })
  })

  it('exige motivo y un monto positivo', async () => {
    // Sin motivo no se sabe por qué salió el dinero; un monto 0 o negativo
    // invertiría el efecto del tipo.
    await withTransaction(async (client) => {
      const id = await openAs(client, USER_RECEPCION)
      await setRole(client, 'authenticated', USER_RECEPCION)
      await expect(
        move(client, USER_RECEPCION, id, 'expense', 3000, '   '),
      ).rejects.toThrow(/reason/)
    })
    await withTransaction(async (client) => {
      const id = await openAs(client, USER_RECEPCION)
      await setRole(client, 'authenticated', USER_RECEPCION)
      await expect(move(client, USER_RECEPCION, id, 'expense', 0)).rejects.toThrow(
        /amount_cents/,
      )
    })
  })

  it('no se registra en una caja cerrada', async () => {
    await withTransaction(async (client) => {
      const id = await openAs(client, USER_RECEPCION)
      await closeAs(client, USER_RECEPCION, id, 50000)
      await setRole(client, 'authenticated', USER_RECEPCION)
      await expect(move(client, USER_RECEPCION, id)).rejects.toThrow(/ya está cerrada/i)
    })
  })

  it('no se registra con la sucursal de otra caja', async () => {
    // Evita meter un retiro de Del Valle en la caja de Centro.
    await withTransaction(async (client) => {
      const id = await openAs(client, USER_DUENO, BRANCH_CENTRO)
      await setRole(client, 'authenticated', USER_DUENO)
      await expect(
        move(client, USER_DUENO, id, 'expense', 3000, 'x', BRANCH_DEL_VALLE),
      ).rejects.toThrow(/no corresponde/i)
    })
  })

  it('un groomer no registra; recepción no puede hacerlo a nombre de otro', async () => {
    await withTransaction(async (client) => {
      const id = await openAs(client, USER_DUENO)
      await setRole(client, 'authenticated', USER_GROOMER)
      await expectFails(
        client,
        () => move(client, USER_GROOMER, id),
        /row-level security/i,
      )
      await setRole(client, 'authenticated', USER_RECEPCION)
      await expectFails(client, () => move(client, USER_DUENO, id), /row-level security/i)
    })
  })

  it('es inmutable: no se modifica ni se borra, ni con service_role', async () => {
    // Un error de captura se corrige con otro movimiento, no reescribiéndolo.
    await withTransaction(async (client) => {
      const id = await openAs(client, USER_RECEPCION)
      await setRole(client, 'authenticated', USER_RECEPCION)
      await move(client, USER_RECEPCION, id)
      await setRole(client, 'service_role')
      await expect(
        client.query('update cash_movements set amount_cents = 1'),
      ).rejects.toThrow(/no se modifica/i)
      await expect(client.query('delete from cash_movements')).rejects.toThrow()
    })
  })

  it('recepción de otra sucursal no los ve', async () => {
    await withTransaction(async (client) => {
      const id = await openAs(client, USER_DUENO, BRANCH_DEL_VALLE)
      await setRole(client, 'authenticated', USER_DUENO)
      await move(client, USER_DUENO, id, 'income', 1000, 'Propina', BRANCH_DEL_VALLE)
      await setRole(client, 'authenticated', USER_RECEPCION)
      expect((await client.query('select 1 from cash_movements')).rowCount).toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------
// Paridad: la RPC de cierre (SQL) debe dar lo mismo que lib/cashCount.ts.
// Mismo patrón que cfdi-parity: las mismas entradas por las dos y el mismo número.
// ---------------------------------------------------------------------------
describe('close_cash_session: paridad con lib/cashCount.ts', () => {
  async function seedSale(
    client: PoolClient,
    folio: number,
    sale: CashSale,
    paidAt: string,
    branch = BRANCH_CENTRO,
  ) {
    await setRole(client, 'service_role')
    const { rows } = await client.query(
      `insert into sales (tenant_id, branch_id, customer_id, folio, status, total_cents, paid_at)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [
        TENANT_PATITAS,
        branch,
        CUSTOMER_SOFIA,
        folio,
        sale.status,
        sale.totalCents,
        paidAt,
      ],
    )
    for (const payment of sale.payments) {
      await client.query(
        `insert into payments (tenant_id, sale_id, method, amount_cents, status, paid_at, payment_form_code)
         values ($1, $2, $3, $4, 'approved', $5, $6)`,
        [
          TENANT_PATITAS,
          rows[0].id,
          payment.method,
          payment.amountCents,
          paidAt,
          // Con tarjeta la base exige crédito (04) o débito (28); el resto se deriva.
          { cash: '01', card: '04', transfer_spei: '03', openpay: null }[payment.method],
        ],
      )
    }
  }

  const SCENARIOS: {
    name: string
    float: number
    sales: CashSale[]
    moves: { type: 'withdrawal' | 'expense' | 'income'; amountCents: number }[]
  }[] = [
    { name: 'sin ventas', float: 50000, sales: [], moves: [] },
    {
      name: 'efectivo con cambio, tarjeta y transferencia',
      float: 50000,
      sales: [
        {
          status: 'paid',
          totalCents: 35000,
          payments: [{ method: 'cash', amountCents: 50000 }],
        },
        {
          status: 'paid',
          totalCents: 20000,
          payments: [{ method: 'card', amountCents: 20000 }],
        },
        {
          status: 'paid',
          totalCents: 10000,
          payments: [{ method: 'transfer_spei', amountCents: 10000 }],
        },
      ],
      moves: [],
    },
    {
      name: 'pago mixto con sobrepago, tarjeta de más y cancelada',
      float: 0,
      sales: [
        {
          status: 'paid',
          totalCents: 45000,
          payments: [
            { method: 'cash', amountCents: 20000 },
            { method: 'card', amountCents: 30000 },
          ],
        },
        {
          status: 'paid',
          totalCents: 45000,
          payments: [
            { method: 'cash', amountCents: 5000 },
            { method: 'card', amountCents: 50000 },
          ],
        },
        {
          status: 'paid',
          totalCents: 35000,
          payments: [{ method: 'card', amountCents: 40000 }],
        },
        {
          status: 'cancelled',
          totalCents: 99900,
          payments: [{ method: 'cash', amountCents: 99900 }],
        },
      ],
      moves: [],
    },
    {
      name: 'con ingresos, retiros y gastos',
      float: 50000,
      sales: [
        {
          status: 'paid',
          totalCents: 10000,
          payments: [{ method: 'cash', amountCents: 10000 }],
        },
      ],
      moves: [
        { type: 'income', amountCents: 5000 },
        { type: 'withdrawal', amountCents: 20000 },
        { type: 'expense', amountCents: 3000 },
      ],
    },
  ]

  it.each(SCENARIOS)(
    '$name: el esperado de la RPC es el de cashCount.ts',
    async ({ float, sales, moves }) => {
      // Si SQL y TypeScript calcularan distinto, la pantalla mostraría un esperado
      // y la caja se cerraría con otro: el corte no cuadraría contra sí mismo.
      await withTransaction(async (client) => {
        const id = await openAs(client, USER_DUENO, BRANCH_CENTRO, float)
        // Las ventas se pagan DENTRO del turno: apertura en el pasado, ventas después.
        await setRole(client, 'service_role')
        await client.query(
          `update cash_sessions set opened_at = now() - interval '2 hours' where id = $1`,
          [id],
        )
        let folio = 7000
        for (const sale of sales)
          await seedSale(
            client,
            folio++,
            sale,
            new Date(Date.now() - 3600_000).toISOString(),
          )
        await setRole(client, 'authenticated', USER_DUENO)
        for (const m of moves) {
          await client.query(
            `insert into cash_movements (tenant_id, branch_id, cash_session_id, movement_type, amount_cents, reason, created_by)
           values ($1, $2, $3, $4, $5, 'prueba', $6)`,
            [TENANT_PATITAS, BRANCH_CENTRO, id, m.type, m.amountCents, USER_DUENO],
          )
        }

        const closed = await closeAs(client, USER_DUENO, id, 0)
        const expected = summarizeShift({
          openingFloatCents: float,
          sales,
          movements: moves,
        }).expectedCashCents
        expect(closed.expected_cents).toBe(expected)
      })
    },
  )

  it('una venta de otra sucursal o fuera del turno no cuenta', async () => {
    // Si contara, el efectivo de Del Valle inflaría el esperado de Centro, o el
    // de un turno anterior se contaría dos veces.
    await withTransaction(async (client) => {
      const id = await openAs(client, USER_DUENO, BRANCH_CENTRO, 10000)
      await setRole(client, 'service_role')
      await client.query(
        `update cash_sessions set opened_at = now() - interval '2 hours' where id = $1`,
        [id],
      )
      const cashSale: CashSale = {
        status: 'paid',
        totalCents: 20000,
        payments: [{ method: 'cash', amountCents: 20000 }],
      }
      await seedSale(
        client,
        7100,
        cashSale,
        new Date(Date.now() - 3600_000).toISOString(),
        BRANCH_DEL_VALLE,
      ) // otra sucursal
      await seedSale(
        client,
        7101,
        cashSale,
        new Date(Date.now() - 3 * 3600_000).toISOString(),
      ) // antes de abrir
      await seedSale(
        client,
        7102,
        cashSale,
        new Date(Date.now() - 3600_000).toISOString(),
      ) // la única que cuenta
      const closed = await closeAs(client, USER_DUENO, id, 0)
      expect(closed.expected_cents).toBe(30000)
    })
  })
})
