// Familias y transferencia de mascota (fase 31, PLAN.md D30 puntos 7 y 8; migración
// 20261024120000_families_and_pet_transfer.sql).
//
// Qué se protege: que un cliente pertenezca a una sola familia, que la transferencia mueva
// solo lo que debe (citas programadas) y deje en paz lo que no (ventas), que sus links se
// revoquen, y que la regla de quién ve qué por periodo no deje al nuevo dueño ver montos
// ajenos ni al dueño anterior ver lo que pasó después.
import type { PoolClient } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { closePool, setRole, withTransaction } from './helpers'
import {
  BRANCH_CENTRO,
  CUSTOMER_CAMILA,
  CUSTOMER_DIEGO,
  CUSTOMER_FERNANDA,
  CUSTOMER_SOFIA,
  CUSTOMER_VALENTINA,
  PET_MICHI,
  PET_ROCKY,
  TENANT_HUELLITAS,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
  USER_VET,
} from './fixtures'

afterAll(closePool)

async function saveFamily(
  client: PoolClient,
  user: string,
  members: string[],
  {
    name = 'Familia Ramírez',
    holder = members[0],
    familyId = null as string | null,
  } = {},
): Promise<string> {
  await setRole(client, 'authenticated', user)
  const { rows } = await client.query('select save_family($1, $2, $3, $4, $5) as id', [
    TENANT_PATITAS,
    familyId,
    name,
    holder,
    members,
  ])
  return rows[0].id
}

async function transfer(client: PoolClient, user: string, pet: string, to: string) {
  await setRole(client, 'authenticated', user)
  const { rows } = await client.query('select * from transfer_pet($1, $2)', [pet, to])
  return rows[0]
}

/** Llama una función interna (sin permiso para la API) como superusuario. */
async function visible(client: PoolClient, customer: string, pet: string, at: string) {
  await setRole(client, 'service_role')
  const view = await client.query(
    'select app.customer_can_view_pet($1, $2, $3::timestamptz) as v',
    [customer, pet, at],
  )
  const money = await client.query(
    'select app.customer_can_view_pet_money($1, $2, $3::timestamptz) as v',
    [customer, pet, at],
  )
  return { view: view.rows[0].v as boolean, money: money.rows[0].v as boolean }
}

describe('familias', () => {
  // Qué prueba: dueño y recepción crean una familia con titular y miembros.
  it('crea una familia con su titular', async () => {
    await withTransaction(async (client) => {
      const id = await saveFamily(client, USER_RECEPCION, [
        CUSTOMER_SOFIA,
        CUSTOMER_DIEGO,
      ])
      const { rows } = await client.query(
        'select customer_id, is_holder from family_members where family_id = $1 and deleted_at is null order by is_holder desc',
        [id],
      )
      expect(rows).toHaveLength(2)
      expect(rows[0]).toMatchObject({ customer_id: CUSTOMER_SOFIA, is_holder: true })
    })
  })

  // Qué prueba: un cliente no puede estar en dos familias, y el error dice en cuál está.
  // Qué se rompería: dos familias reclamarían a la misma persona y se mezclarían sus mascotas.
  it('un cliente no entra a una segunda familia y el mensaje dice cuál', async () => {
    await withTransaction(async (client) => {
      await saveFamily(client, USER_DUENO, [CUSTOMER_SOFIA, CUSTOMER_DIEGO])
      await client.query('savepoint s')
      await expect(
        saveFamily(client, USER_DUENO, [CUSTOMER_SOFIA, CUSTOMER_CAMILA], {
          name: 'Otra familia',
        }),
      ).rejects.toThrow(/ya pertenece a la familia "Familia Ramírez"/i)
      await client.query('rollback to savepoint s')
    })
  })

  // Qué prueba: al corregir la familia, los que salen quedan libres y el titular cambia.
  it('corregir la familia reasigna al titular y suelta a quien sale', async () => {
    await withTransaction(async (client) => {
      const id = await saveFamily(client, USER_DUENO, [CUSTOMER_SOFIA, CUSTOMER_DIEGO])
      await saveFamily(client, USER_DUENO, [CUSTOMER_DIEGO, CUSTOMER_CAMILA], {
        familyId: id,
        holder: CUSTOMER_DIEGO,
      })
      const active = await client.query(
        'select customer_id, is_holder from family_members where family_id = $1 and deleted_at is null',
        [id],
      )
      expect(active.rows.map((r) => r.customer_id).sort()).toEqual(
        [CUSTOMER_DIEGO, CUSTOMER_CAMILA].sort(),
      )
      expect(active.rows.find((r) => r.is_holder)?.customer_id).toBe(CUSTOMER_DIEGO)

      // Sofía ya quedó libre: puede entrar a otra familia.
      const other = await saveFamily(client, USER_DUENO, [CUSTOMER_SOFIA], {
        name: 'Familia Sofía',
      })
      expect(other).toBeTruthy()
    })
  })

  // Qué prueba: el titular debe ser miembro y la familia no puede quedar vacía.
  it('rechaza un titular que no es miembro y una familia vacía', async () => {
    await withTransaction(async (client) => {
      await client.query('savepoint s')
      await expect(
        saveFamily(client, USER_DUENO, [CUSTOMER_SOFIA], { holder: CUSTOMER_DIEGO }),
      ).rejects.toThrow(/titular debe ser uno de los miembros/i)
      await client.query('rollback to savepoint s')

      await client.query('savepoint s')
      await expect(
        saveFamily(client, USER_DUENO, [], { holder: CUSTOMER_SOFIA }),
      ).rejects.toThrow(/al menos un miembro/i)
      await client.query('rollback to savepoint s')
    })
  })

  // Qué prueba: groomer y veterinario no administran familias; un cliente de otro negocio
  // no se puede meter.
  it('solo dueño y recepción, y solo clientes del negocio', async () => {
    await withTransaction(async (client) => {
      for (const user of [USER_GROOMER, USER_VET]) {
        await client.query('savepoint s')
        await expect(saveFamily(client, user, [CUSTOMER_SOFIA])).rejects.toThrow(
          /permiso/i,
        )
        await client.query('rollback to savepoint s')
      }
      await client.query('savepoint s')
      await expect(saveFamily(client, USER_DUENO, [CUSTOMER_FERNANDA])).rejects.toThrow(
        /no es un cliente de este negocio/i,
      )
      await client.query('rollback to savepoint s')
    })
  })

  // Qué prueba: disolver una familia suelta a los miembros y deja intactos clientes y mascotas.
  it('disolver la familia suelta a sus miembros', async () => {
    await withTransaction(async (client) => {
      const id = await saveFamily(client, USER_DUENO, [CUSTOMER_SOFIA, CUSTOMER_DIEGO])
      await client.query('select delete_family($1)', [id])
      const members = await client.query(
        'select count(*)::int as n from family_members where family_id = $1 and deleted_at is null',
        [id],
      )
      expect(members.rows[0].n).toBe(0)
      const pets = await client.query(
        'select count(*)::int as n from pets where id = $1',
        [PET_ROCKY],
      )
      expect(pets.rows[0].n).toBe(1)
    })
  })

  // Qué prueba: aislamiento entre negocios.
  it('el dueño de otro negocio no ve las familias', async () => {
    await withTransaction(async (client) => {
      await saveFamily(client, USER_DUENO, [CUSTOMER_SOFIA])
      await setRole(client, 'service_role')
      const { rows } = await client.query(
        'select count(*)::int as n from families where tenant_id = $1',
        [TENANT_HUELLITAS],
      )
      expect(rows[0].n).toBe(0)
    })
  })
})

describe('transferencia de mascota', () => {
  // Qué prueba: la mascota cambia de dueño y el historial de dueños queda con sus periodos.
  // Qué se rompería: no habría forma de saber quién fue dueño y cuándo.
  it('cambia de dueño y deja el periodo anterior cerrado', async () => {
    await withTransaction(async (client) => {
      const pet = await transfer(client, USER_RECEPCION, PET_ROCKY, CUSTOMER_DIEGO)
      expect(pet.customer_id).toBe(CUSTOMER_DIEGO)

      const { rows } = await client.query(
        'select customer_id, ended_at is null as is_current from pet_ownerships where pet_id = $1 order by started_at',
        [PET_ROCKY],
      )
      expect(rows).toEqual([
        { customer_id: CUSTOMER_SOFIA, is_current: false },
        { customer_id: CUSTOMER_DIEGO, is_current: true },
      ])
    })
  })

  // Qué prueba: las citas programadas se van con la mascota; las ya atendidas, no.
  it('las citas programadas se transfieren y las atendidas se quedan', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      const mk = async (status: string) =>
        (
          await client.query(
            `insert into appointments (tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, status, created_by)
             values ($1, $2, $3, $4, 'grooming', $5, now() + interval '30 days', now() + interval '30 days' + interval '1 hour', $6, $5)
             returning id`,
            [
              TENANT_PATITAS,
              BRANCH_CENTRO,
              CUSTOMER_SOFIA,
              PET_ROCKY,
              USER_GROOMER,
              status,
            ],
          )
        ).rows[0].id as string
      const scheduled = await mk('scheduled')
      const completed = await mk('completed')

      await transfer(client, USER_DUENO, PET_ROCKY, CUSTOMER_DIEGO)

      await setRole(client, 'service_role')
      const { rows } = await client.query(
        'select id, customer_id from appointments where id = any($1)',
        [[scheduled, completed]],
      )
      const byId = Object.fromEntries(rows.map((r) => [r.id, r.customer_id]))
      expect(byId[scheduled]).toBe(CUSTOMER_DIEGO)
      expect(byId[completed]).toBe(CUSTOMER_SOFIA)
    })
  })

  // Qué prueba: las ventas se quedan con el dueño anterior.
  it('las ventas no se tocan', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      const sale = await client.query(
        `insert into sales (tenant_id, branch_id, customer_id, folio, status, subtotal_cents, tax_cents, total_cents, paid_at, closed_by)
         values ($1, $2, $3, 9001, 'paid', 100, 16, 116, now(), $4) returning id`,
        [TENANT_PATITAS, BRANCH_CENTRO, CUSTOMER_SOFIA, USER_DUENO],
      )
      await transfer(client, USER_DUENO, PET_ROCKY, CUSTOMER_DIEGO)
      await setRole(client, 'service_role')
      const { rows } = await client.query('select customer_id from sales where id = $1', [
        sale.rows[0].id,
      ])
      expect(rows[0].customer_id).toBe(CUSTOMER_SOFIA)
    })
  })

  // Qué prueba: los links compartidos de la mascota se revocan.
  // Qué se rompería: el dueño anterior seguiría viendo a una mascota que ya no es suya.
  it('revoca los links compartidos de la mascota', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      const link = await client.query(
        `insert into share_links (tenant_id, scope, pet_id, token_hash, token_prefix, expires_at, created_by)
         values ($1, 'pet', $2, 'hash-prueba-transferencia', 'abcd', now() + interval '7 days', $3)
         returning id`,
        [TENANT_PATITAS, PET_ROCKY, USER_DUENO],
      )
      await transfer(client, USER_DUENO, PET_ROCKY, CUSTOMER_DIEGO)
      await setRole(client, 'service_role')
      const { rows } = await client.query(
        'select revoked_at from share_links where id = $1',
        [link.rows[0].id],
      )
      expect(rows[0].revoked_at).not.toBeNull()
    })
  })

  // Qué prueba: los rechazos: mismo cliente, cliente de otro negocio, y rol sin permiso.
  it('rechaza al mismo cliente, a uno de otro negocio y a quien no tiene permiso', async () => {
    await withTransaction(async (client) => {
      await client.query('savepoint s')
      await expect(
        transfer(client, USER_DUENO, PET_ROCKY, CUSTOMER_SOFIA),
      ).rejects.toThrow(/ya es de ese cliente/i)
      await client.query('rollback to savepoint s')

      await client.query('savepoint s')
      await expect(
        transfer(client, USER_DUENO, PET_ROCKY, CUSTOMER_FERNANDA),
      ).rejects.toThrow(/no existe/i)
      await client.query('rollback to savepoint s')

      for (const user of [USER_GROOMER, USER_VET]) {
        await client.query('savepoint s')
        await expect(transfer(client, user, PET_ROCKY, CUSTOMER_DIEGO)).rejects.toThrow(
          /permiso/i,
        )
        await client.query('rollback to savepoint s')
      }
    })
  })

  // Qué prueba: un cambio de dueño por UPDATE directo también deja el historial.
  it('un cambio directo de customer_id también alimenta el historial', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query('update pets set customer_id = $2 where id = $1', [
        PET_MICHI,
        CUSTOMER_VALENTINA,
      ])
      const { rows } = await client.query(
        'select count(*)::int as n from pet_ownerships where pet_id = $1',
        [PET_MICHI],
      )
      expect(rows[0].n).toBe(2)
    })
  })

  // Qué prueba: ningún usuario de la API borra el historial de dueños (no hay política de DELETE).
  // Qué se rompería: se podría borrar al dueño anterior y desaparecer su periodo.
  it('el historial de dueños no lo borra un usuario', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const { rowCount } = await client.query(
        'delete from pet_ownerships where pet_id = $1',
        [PET_ROCKY],
      )
      expect(rowCount).toBe(0)
      await setRole(client, 'service_role')
      const { rows } = await client.query(
        'select count(*)::int as n from pet_ownerships where pet_id = $1',
        [PET_ROCKY],
      )
      expect(rows[0].n).toBe(1)
    })
  })
})

describe('visibilidad por periodo', () => {
  // Rocky pasa de Sofía a Diego "ahora". Un instante antes y uno después, para probar ambos lados.
  async function transferredRocky(client: PoolClient) {
    await setRole(client, 'service_role')
    // El periodo de Sofía arranca en la semilla (`created_at`): se fija a una fecha conocida
    // para que las pruebas no dependan del reloj.
    await client.query(
      `update pet_ownerships set started_at = '2026-01-01T00:00:00Z' where pet_id = $1`,
      [PET_ROCKY],
    )
    await transfer(client, USER_DUENO, PET_ROCKY, CUSTOMER_DIEGO)
    await setRole(client, 'service_role')
    await client.query(
      `update pet_ownerships set ended_at = '2026-06-01T00:00:00Z' where pet_id = $1 and customer_id = $2`,
      [PET_ROCKY, CUSTOMER_SOFIA],
    )
    await client.query(
      `update pet_ownerships set started_at = '2026-06-01T00:00:00Z' where pet_id = $1 and customer_id = $2`,
      [PET_ROCKY, CUSTOMER_DIEGO],
    )
  }

  // Qué prueba: el dueño anterior ve lo de su periodo y nada de lo posterior.
  // Qué se rompería: la familia anterior seguiría viendo la vida de una mascota ajena.
  it('el dueño anterior ve solo lo ocurrido mientras lo fue', async () => {
    await withTransaction(async (client) => {
      await transferredRocky(client)
      expect(
        await visible(client, CUSTOMER_SOFIA, PET_ROCKY, '2026-03-01T00:00:00Z'),
      ).toEqual({
        view: true,
        money: true,
      })
      expect(
        await visible(client, CUSTOMER_SOFIA, PET_ROCKY, '2026-09-01T00:00:00Z'),
      ).toEqual({
        view: false,
        money: false,
      })
    })
  })

  // Qué prueba: el nuevo dueño ve TODO el historial (cartilla, expediente) pero los montos
  // solo desde que lo es.
  // Qué se rompería: el nuevo dueño vería lo que le cobraron al anterior.
  it('el nuevo dueño ve todo el historial pero solo sus propios montos', async () => {
    await withTransaction(async (client) => {
      await transferredRocky(client)
      expect(
        await visible(client, CUSTOMER_DIEGO, PET_ROCKY, '2026-03-01T00:00:00Z'),
      ).toEqual({
        view: true,
        money: false,
      })
      expect(
        await visible(client, CUSTOMER_DIEGO, PET_ROCKY, '2026-09-01T00:00:00Z'),
      ).toEqual({
        view: true,
        money: true,
      })
    })
  })

  // Qué prueba: la familia accede a la mascota; el miembro no titular no ve montos y el
  // titular sí.
  it('la familia del dueño ve la mascota; solo el titular ve los montos', async () => {
    await withTransaction(async (client) => {
      // Sofía (dueña de Rocky) y Camila, con Camila de titular.
      await saveFamily(client, USER_DUENO, [CUSTOMER_SOFIA, CUSTOMER_CAMILA], {
        holder: CUSTOMER_CAMILA,
      })
      const now = new Date().toISOString()
      // Camila, titular: ve la mascota y los montos.
      expect(await visible(client, CUSTOMER_CAMILA, PET_ROCKY, now)).toEqual({
        view: true,
        money: true,
      })
      // Sofía es la dueña pero no la titular: ve la mascota y sus montos como dueña.
      expect(await visible(client, CUSTOMER_SOFIA, PET_ROCKY, now)).toEqual({
        view: true,
        money: true,
      })
      // Un miembro NO titular que no es el dueño de la mascota ve la mascota, no los montos.
      await saveFamily(
        client,
        USER_DUENO,
        [CUSTOMER_SOFIA, CUSTOMER_CAMILA, CUSTOMER_DIEGO],
        {
          holder: CUSTOMER_CAMILA,
          familyId: (
            await client.query(
              'select family_id from family_members where customer_id = $1 and deleted_at is null',
              [CUSTOMER_SOFIA],
            )
          ).rows[0].family_id,
        },
      )
      expect(await visible(client, CUSTOMER_DIEGO, PET_ROCKY, now)).toEqual({
        view: true,
        money: false,
      })
    })
  })

  // Qué prueba: un cliente sin relación no ve nada.
  it('un cliente sin relación con la mascota no ve nada', async () => {
    await withTransaction(async (client) => {
      expect(
        await visible(client, CUSTOMER_VALENTINA, PET_ROCKY, new Date().toISOString()),
      ).toEqual({ view: false, money: false })
    })
  })

  // Qué prueba: las reglas de visibilidad no están expuestas a usuarios de la API: solo las
  // llama la función del servidor (service_role).
  // Qué se rompería: cualquier empleado podría preguntar "¿puede este cliente ver esta mascota?".
  it('un usuario autenticado no puede llamar las reglas de visibilidad', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      await expect(
        client.query('select app.customer_can_view_pet($1, $2, now())', [
          CUSTOMER_SOFIA,
          PET_ROCKY,
        ]),
      ).rejects.toThrow(/permission denied/i)
    })
  })
})
