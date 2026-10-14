// Hospitalización (fase 33, PLAN.md D30 punto 10; migración 20261028120000_hospitalization.sql):
// estancias, bitácora, medicamentos con inventario y cobro.
//
// Qué se protege: que los días y el cobro se cuenten con la regla del negocio y la zona de la
// sucursal, que la bitácora (expediente) no se modifique ni se borre, que lo administrado baje
// del inventario y vuelva si se quita, y que cada rol haga solo lo suyo.
import type { PoolClient } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { closePool, setRole, withTransaction } from './helpers'
import {
  BRANCH_CENTRO,
  BRANCH_DEL_VALLE,
  PET_MICHI,
  PET_ROCKY,
  PRODUCT_SHAMPOO,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
  USER_VET,
} from './fixtures'

afterAll(closePool)

const CASH = [{ method: 'cash', amount_cents: 1000000 }]

async function space(
  client: PoolClient,
  branch = BRANCH_DEL_VALLE,
  name = 'Jaula de prueba',
): Promise<string> {
  await setRole(client, 'service_role')
  const { rows } = await client.query(
    `insert into hospital_spaces (tenant_id, branch_id, name, space_type)
     values ($1, $2, $3, 'Jaula chica') returning id`,
    [TENANT_PATITAS, branch, name],
  )
  return rows[0].id
}

async function admit(
  client: PoolClient,
  user: string,
  spaceId: string,
  pet = PET_ROCKY,
  mode = 'per_day',
  rate = 50000,
) {
  await setRole(client, 'authenticated', user)
  const { rows } = await client.query('select admit_pet($1, $2, $3, $4, $5) as id', [
    pet,
    spaceId,
    mode,
    rate,
    'Postoperatorio',
  ])
  return rows[0].id as string
}

async function seedStock(client: PoolClient, quantity: number) {
  await setRole(client, 'service_role')
  await client.query(
    `insert into stock_movements (tenant_id, branch_id, product_id, created_by, movement_type, quantity)
     values ($1, $2, $3, $4, 'purchase', $5)`,
    [TENANT_PATITAS, BRANCH_DEL_VALLE, PRODUCT_SHAMPOO, USER_DUENO, quantity],
  )
}

async function stock(client: PoolClient): Promise<number> {
  await setRole(client, 'service_role')
  const { rows } = await client.query(
    'select coalesce(sum(quantity), 0)::int as n from stock_movements where product_id = $1 and branch_id = $2',
    [PRODUCT_SHAMPOO, BRANCH_DEL_VALLE],
  )
  return rows[0].n
}

describe('días de una estancia', () => {
  async function days(
    client: PoolClient,
    from: string,
    to: string,
    rule: string,
    tz = 'America/Mexico_City',
  ) {
    await setRole(client, 'service_role')
    const { rows } = await client.query(
      'select app.hospital_stay_days($1::timestamptz, $2::timestamptz, $3, $4) as d',
      [from, to, rule, tz],
    )
    return rows[0].d as number
  }

  // Qué prueba: regla natural: de las 23:30 de un día a las 00:10 del siguiente (hora de la
  // sucursal) son 2 días calendario, aunque pasaron 40 minutos. Con 24 h es 1.
  // Qué se rompería: se cobraría un día de más o de menos según la regla que el negocio eligió.
  it('natural cuenta los días calendario tocados; 24 horas, bloques desde el ingreso', async () => {
    await withTransaction(async (client) => {
      // 23:30 del 14 de octubre en la Ciudad de México (UTC-6) y 00:10 del 15.
      const from = '2026-10-15T05:30:00Z'
      const to = '2026-10-15T06:10:00Z'
      expect(await days(client, from, to, 'natural')).toBe(2)
      expect(await days(client, from, to, '24h')).toBe(1)
    })
  })

  // Qué prueba: el mismo instante cae en días distintos según la zona de la sucursal (§8.3).
  it('usa la zona horaria de la sucursal', async () => {
    await withTransaction(async (client) => {
      // 06:30Z: en CDMX (UTC-6) es 00:30 del 15; en Tijuana (UTC-7 en octubre) es 23:30 del 14.
      const from = '2026-10-15T06:30:00Z'
      const to = '2026-10-15T08:00:00Z'
      expect(await days(client, from, to, 'natural', 'America/Mexico_City')).toBe(1)
      expect(await days(client, from, to, 'natural', 'America/Tijuana')).toBe(2)
    })
  })

  // Qué prueba: los bordes de 24 h: 0 minutos es 1 día, 24 h exactas es 1, y 24 h con un minuto es 2.
  it('24 horas: mínimo 1 y redondea hacia arriba', async () => {
    await withTransaction(async (client) => {
      const from = '2026-10-15T10:00:00Z'
      expect(await days(client, from, from, '24h')).toBe(1)
      expect(await days(client, from, '2026-10-16T10:00:00Z', '24h')).toBe(1)
      expect(await days(client, from, '2026-10-16T10:01:00Z', '24h')).toBe(2)
    })
  })
})

describe('ingreso, bitácora y alta', () => {
  // Qué prueba: dueño, recepción y veterinario ingresan; el groomer no.
  it('ingresan dueño, recepción y veterinario; el groomer no', async () => {
    await withTransaction(async (client) => {
      const valle = await space(client, BRANCH_DEL_VALLE, 'Jaula Valle')
      const centro = await space(client, BRANCH_CENTRO, 'Jaula Centro')
      expect(await admit(client, USER_VET, valle, PET_ROCKY)).toBeTruthy()
      expect(await admit(client, USER_RECEPCION, centro, PET_MICHI)).toBeTruthy()
      await client.query('savepoint s')
      await expect(admit(client, USER_GROOMER, valle, PET_ROCKY)).rejects.toThrow(
        /permiso|acceso/i,
      )
      await client.query('rollback to savepoint s')
    })
  })

  // Qué prueba: una mascota no puede tener dos estancias abiertas.
  it('una mascota no se ingresa dos veces', async () => {
    await withTransaction(async (client) => {
      const valle = await space(client)
      await admit(client, USER_VET, valle)
      await client.query('savepoint s')
      await expect(admit(client, USER_VET, valle)).rejects.toThrow(
        /ya está hospitalizada/i,
      )
      await client.query('rollback to savepoint s')
    })
  })

  // Qué prueba: se puede ingresar a otra mascota en el mismo espacio (varias por jaula).
  it('varias mascotas pueden compartir espacio', async () => {
    await withTransaction(async (client) => {
      const valle = await space(client)
      await admit(client, USER_DUENO, valle, PET_ROCKY)
      expect(await admit(client, USER_DUENO, valle, PET_MICHI)).toBeTruthy()
    })
  })

  // Qué prueba: la nota guarda sus biometrías y su hora; una nota vacía no existe.
  it('la nota guarda biometrías y no se admite vacía', async () => {
    await withTransaction(async (client) => {
      const stay = await admit(client, USER_VET, await space(client))
      await setRole(client, 'authenticated', USER_VET)
      const note = await client.query(
        `select add_hospital_note($1, 'Comió bien', now(), 385, 12400, 110, 'pink', 'alert', 'both') as id`,
        [stay],
      )
      const { rows } = await client.query(
        'select content, temperature_deci_c, weight_grams, heart_rate_bpm, mucous_color, mood from hospital_notes where id = $1',
        [note.rows[0].id],
      )
      expect(rows[0]).toMatchObject({
        content: 'Comió bien',
        temperature_deci_c: 385,
        weight_grams: 12400,
        heart_rate_bpm: 110,
        mucous_color: 'pink',
        mood: 'alert',
      })

      await client.query('savepoint s')
      await expect(client.query('select add_hospital_note($1)', [stay])).rejects.toThrow(
        /hospital_notes_not_empty|check/i,
      )
      await client.query('rollback to savepoint s')
    })
  })

  // Qué prueba: la bitácora es expediente: no se modifica ni se borra, ni con service_role.
  it('una nota no se modifica ni se borra', async () => {
    await withTransaction(async (client) => {
      const stay = await admit(client, USER_VET, await space(client))
      await setRole(client, 'authenticated', USER_VET)
      const note = await client.query("select add_hospital_note($1, 'Nota') as id", [
        stay,
      ])
      await setRole(client, 'service_role')
      await client.query('savepoint s')
      await expect(
        client.query("update hospital_notes set content = 'Otra' where id = $1", [
          note.rows[0].id,
        ]),
      ).rejects.toThrow(/no se modifica/i)
      await client.query('rollback to savepoint s')
      await client.query('savepoint s')
      await expect(
        client.query('delete from hospital_notes where id = $1', [note.rows[0].id]),
      ).rejects.toThrow(/no se puede borrar/i)
      await client.query('rollback to savepoint s')
    })
  })

  // Qué prueba: tras el alta no se admiten más notas ni medicamentos.
  it('después del alta no hay más notas', async () => {
    await withTransaction(async (client) => {
      const stay = await admit(client, USER_VET, await space(client))
      await setRole(client, 'authenticated', USER_VET)
      await client.query('select discharge_pet($1)', [stay])
      await client.query('savepoint s')
      await expect(
        client.query("select add_hospital_note($1, 'Tarde')", [stay]),
      ).rejects.toThrow(/ya fue dada de alta/i)
      await client.query('rollback to savepoint s')
      await client.query('savepoint s')
      await expect(client.query('select discharge_pet($1)', [stay])).rejects.toThrow(
        /ya fue dada de alta/i,
      )
      await client.query('rollback to savepoint s')
    })
  })

  // Qué prueba: lectura: personal sí; groomer no.
  it('el groomer no lee estancias ni notas', async () => {
    await withTransaction(async (client) => {
      const stay = await admit(client, USER_VET, await space(client))
      await setRole(client, 'authenticated', USER_GROOMER)
      const a = await client.query('select id from hospital_stays where id = $1', [stay])
      expect(a.rows).toHaveLength(0)
      await setRole(client, 'authenticated', USER_VET)
      const b = await client.query('select id from hospital_stays where id = $1', [stay])
      expect(b.rows).toHaveLength(1)
    })
  })
})

describe('medicamentos y cobro', () => {
  // Qué prueba: administrar baja la existencia y quitar la devuelve.
  it('administrar baja la existencia y quitarlo la devuelve', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, 5)
      const stay = await admit(client, USER_VET, await space(client))
      await setRole(client, 'authenticated', USER_VET)
      const med = await client.query(
        'select administer_hospital_medication($1, $2, 2) as id',
        [stay, PRODUCT_SHAMPOO],
      )
      expect(await stock(client)).toBe(3)
      await setRole(client, 'authenticated', USER_VET)
      await client.query('select remove_hospital_medication($1)', [med.rows[0].id])
      expect(await stock(client)).toBe(5)
    })
  })

  // Qué prueba: sin existencia suficiente no queda nada guardado.
  it('sin existencia no se administra y no queda nada', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, 1)
      const stay = await admit(client, USER_VET, await space(client))
      await setRole(client, 'authenticated', USER_VET)
      await client.query('savepoint s')
      await expect(
        client.query('select administer_hospital_medication($1, $2, 3)', [
          stay,
          PRODUCT_SHAMPOO,
        ]),
      ).rejects.toThrow(/existencia/i)
      await client.query('rollback to savepoint s')
      await setRole(client, 'service_role')
      const { rows } = await client.query(
        'select count(*)::int as n from hospital_medications where stay_id = $1',
        [stay],
      )
      expect(rows[0].n).toBe(0)
    })
  })

  // Qué prueba: el cobro de una estancia por día con un medicamento: la estancia se cobra por
  // sus días y el medicamento a su precio, en una sola venta ligada al dueño del ingreso.
  // Qué se rompería: el cliente pagaría de menos (o dos veces) la estancia o el medicamento.
  it('cobra la estancia por día y sus medicamentos en una venta', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, 5)
      const stay = await admit(
        client,
        USER_VET,
        await space(client),
        PET_ROCKY,
        'per_day',
        50000,
      )
      await setRole(client, 'authenticated', USER_VET)
      await client.query('select administer_hospital_medication($1, $2, 1)', [
        stay,
        PRODUCT_SHAMPOO,
      ])

      // Ingresó hace 2 días: la regla natural cuenta 3 días calendario.
      await setRole(client, 'service_role')
      await client.query(
        "update hospital_stays set admitted_at = now() - interval '2 days' where id = $1",
        [stay],
      )
      await setRole(client, 'authenticated', USER_VET)
      await client.query('select discharge_pet($1)', [stay])

      await setRole(client, 'authenticated', USER_RECEPCION)
      // Recepción trabaja en Centro; la estancia es de Del Valle: la sucursal manda.
      await client.query('savepoint s')
      await expect(
        client.query('select bill_hospital_stay($1, $2::jsonb)', [
          stay,
          JSON.stringify(CASH),
        ]),
      ).rejects.toThrow(/acceso/i)
      await client.query('rollback to savepoint s')

      await setRole(client, 'authenticated', USER_DUENO)
      const billed = await client.query(
        'select bill_hospital_stay($1, $2::jsonb) as id',
        [stay, JSON.stringify(CASH)],
      )
      await setRole(client, 'service_role')
      const items = await client.query(
        'select description, quantity, unit_price_cents, line_total_cents, item_type from sale_items where sale_id = $1 order by item_type',
        [billed.rows[0].id],
      )
      const stayLine = items.rows.find((r) => r.item_type === 'service')
      expect(stayLine).toMatchObject({
        quantity: 3,
        unit_price_cents: 50000,
        line_total_cents: 150000,
      })
      expect(items.rows.find((r) => r.item_type === 'product')?.quantity).toBe(1)
      const sale = await client.query(
        'select customer_id, total_cents, status from sales where id = $1',
        [billed.rows[0].id],
      )
      expect(sale.rows[0]).toMatchObject({ status: 'paid' })
      expect(sale.rows[0].total_cents).toBe(
        items.rows.reduce((sum, r) => sum + r.line_total_cents, 0),
      )
      expect(sale.rows[0].customer_id).not.toBeNull()
    })
  })

  // Qué prueba: por estancia cobra el monto único; y no se cobra dos veces ni sin el alta;
  // el veterinario no cobra.
  it('por estancia es un monto único; no se cobra dos veces ni sin alta; el vet no cobra', async () => {
    await withTransaction(async (client) => {
      const stay = await admit(
        client,
        USER_DUENO,
        await space(client),
        PET_ROCKY,
        'per_stay',
        120000,
      )
      await setRole(client, 'authenticated', USER_DUENO)

      await client.query('savepoint s')
      await expect(
        client.query('select bill_hospital_stay($1, $2::jsonb)', [
          stay,
          JSON.stringify(CASH),
        ]),
      ).rejects.toThrow(/alta/i)
      await client.query('rollback to savepoint s')

      await client.query('select discharge_pet($1)', [stay])

      await setRole(client, 'authenticated', USER_VET)
      await client.query('savepoint s')
      await expect(
        client.query('select bill_hospital_stay($1, $2::jsonb)', [
          stay,
          JSON.stringify(CASH),
        ]),
      ).rejects.toThrow(/permiso/i)
      await client.query('rollback to savepoint s')

      await setRole(client, 'authenticated', USER_DUENO)
      const billed = await client.query(
        'select bill_hospital_stay($1, $2::jsonb) as id',
        [stay, JSON.stringify(CASH)],
      )
      await setRole(client, 'service_role')
      const sale = await client.query('select total_cents from sales where id = $1', [
        billed.rows[0].id,
      ])
      expect(sale.rows[0].total_cents).toBe(120000)

      await setRole(client, 'authenticated', USER_DUENO)
      await client.query('savepoint s')
      await expect(
        client.query('select bill_hospital_stay($1, $2::jsonb)', [
          stay,
          JSON.stringify(CASH),
        ]),
      ).rejects.toThrow(/ya fue cobrada/i)
      await client.query('rollback to savepoint s')
    })
  })

  // Qué prueba: un pago que no alcanza no deja venta ni marca la estancia como cobrada.
  it('un pago insuficiente no deja nada cobrado', async () => {
    await withTransaction(async (client) => {
      const stay = await admit(
        client,
        USER_DUENO,
        await space(client),
        PET_ROCKY,
        'per_stay',
        120000,
      )
      await setRole(client, 'authenticated', USER_DUENO)
      await client.query('select discharge_pet($1)', [stay])
      await client.query('savepoint s')
      await expect(
        client.query('select bill_hospital_stay($1, $2::jsonb)', [
          stay,
          JSON.stringify([{ method: 'cash', amount_cents: 100 }]),
        ]),
      ).rejects.toThrow(/no cubre el total/i)
      await client.query('rollback to savepoint s')
      await setRole(client, 'service_role')
      const { rows } = await client.query(
        'select billed_sale_id from hospital_stays where id = $1',
        [stay],
      )
      expect(rows[0].billed_sale_id).toBeNull()
    })
  })
})

describe('espacios y configuración', () => {
  // Qué prueba: solo el dueño crea espacios y configura las reglas; recepción y veterinario
  // los leen pero no los cambian.
  // Qué se rompería: cualquiera cambiaría la tarifa o crearía jaulas que el negocio no tiene.
  it('el dueño administra espacios y reglas; los demás solo leen', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const created = await client.query(
        "insert into hospital_spaces (tenant_id, branch_id, name) values ($1, $2, 'Jaula nueva') returning id",
        [TENANT_PATITAS, BRANCH_DEL_VALLE],
      )
      expect(created.rows).toHaveLength(1)
      await client.query(
        "insert into hospital_settings (tenant_id, day_rule, default_daily_rate_cents) values ($1, '24h', 45000)",
        [TENANT_PATITAS],
      )

      for (const user of [USER_VET, USER_RECEPCION]) {
        await setRole(client, 'authenticated', user)
        await client.query('savepoint s')
        await expect(
          client.query(
            "insert into hospital_spaces (tenant_id, branch_id, name) values ($1, $2, 'No debería')",
            [TENANT_PATITAS, BRANCH_DEL_VALLE],
          ),
        ).rejects.toThrow(/row-level security/i)
        await client.query('rollback to savepoint s')
      }

      await setRole(client, 'authenticated', USER_VET)
      const read = await client.query('select id from hospital_spaces where id = $1', [
        created.rows[0].id,
      ])
      expect(read.rows).toHaveLength(1)
    })
  })

  // Qué prueba: la regla de días del negocio se copia a la estancia al ingresar; cambiarla
  // después no altera una estancia abierta.
  it('la regla de días se copia al ingresar', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query(
        "insert into hospital_settings (tenant_id, day_rule) values ($1, '24h')",
        [TENANT_PATITAS],
      )
      const stay = await admit(client, USER_DUENO, await space(client))
      await setRole(client, 'service_role')
      await client.query(
        "update hospital_settings set day_rule = 'natural' where tenant_id = $1",
        [TENANT_PATITAS],
      )
      const { rows } = await client.query(
        'select day_rule from hospital_stays where id = $1',
        [stay],
      )
      expect(rows[0].day_rule).toBe('24h')
    })
  })

  // Qué prueba: el nombre del espacio no se repite en la sucursal.
  it('no repite el nombre de un espacio en la sucursal', async () => {
    await withTransaction(async (client) => {
      await space(client, BRANCH_DEL_VALLE, 'Jaula 9')
      await setRole(client, 'service_role')
      await client.query('savepoint s')
      await expect(
        client.query(
          "insert into hospital_spaces (tenant_id, branch_id, name) values ($1, $2, 'JAULA 9')",
          [TENANT_PATITAS, BRANCH_DEL_VALLE],
        ),
      ).rejects.toThrow(/duplicate key|unique/i)
      await client.query('rollback to savepoint s')
    })
  })
})
