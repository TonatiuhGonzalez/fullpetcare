// Cuenta del dueño de la mascota (fase 16B, PLAN.md D31; migración
// 20261029120000_customer_accounts.sql): vincular con un link con token, desvincular y la
// lectura en lista blanca con visibilidad por periodo.
//
// Qué se protege: que la cuenta solo vea lo suyo, que el link sea la única prueba de vínculo,
// que un dueño anterior no vea lo que pasó después, que los montos solo los vea quien le toca,
// y que ninguna de estas funciones de lectura la pueda llamar un usuario de la API.
import { createHash, randomBytes } from 'node:crypto'
import type { PoolClient } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { closePool, insertAuthUser, setRole, withTransaction } from './helpers'
import {
  BRANCH_CENTRO,
  CUSTOMER_CAMILA,
  CUSTOMER_DIEGO,
  CUSTOMER_SOFIA,
  PET_BRUNO,
  PET_ROCKY,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
} from './fixtures'

afterAll(closePool)

const ACCOUNT_A = 'f1000000-0000-4000-8000-00000000000a'
const ACCOUNT_B = 'f1000000-0000-4000-8000-00000000000b'
const GENERIC = /Este link no es válido o ya venció/i

/** Crea un usuario de Auth de dueño (sin membresía) y devuelve su id. */
async function ownerUser(client: PoolClient, id = ACCOUNT_A, email = `${id}@dueno.test`) {
  // Crear el usuario de Auth es armar el escenario: se hace como superusuario (insertAuthUser).
  await client.query('reset role')
  await insertAuthUser(client, id, email)
  await client.query(
    `update auth.users set raw_app_meta_data = '{"customer_account": true}'::jsonb where id = $1`,
    [id],
  )
  return id
}

/** Un link con token de una mascota; devuelve el token en claro. */
async function link(
  client: PoolClient,
  petId = PET_ROCKY,
  tenantId = TENANT_PATITAS,
  opts: { revoked?: boolean; expired?: boolean } = {},
): Promise<string> {
  await setRole(client, 'service_role')
  const token = randomBytes(32).toString('base64url')
  const hash = createHash('sha256').update(token).digest('hex')
  await client.query(
    `insert into share_links (tenant_id, scope, pet_id, token_hash, token_prefix, expires_at, revoked_at, created_by)
     values ($1, 'pet', $2, $3, $4, $5, $6, $7)`,
    [
      tenantId,
      petId,
      hash,
      token.slice(0, 8),
      opts.expired
        ? new Date(Date.now() - 86_400_000)
        : new Date(Date.now() + 30 * 86_400_000),
      opts.revoked ? new Date() : null,
      USER_DUENO,
    ],
  )
  return token
}

async function claim(client: PoolClient, userId: string, token: string) {
  await setRole(client, 'authenticated', userId)
  const { rows } = await client.query('select claim_customer_link($1) as r', [token])
  return rows[0].r as { account_id: string; tenant_id: string; business_name: string }
}

async function overview(client: PoolClient, userId: string) {
  await setRole(client, 'service_role')
  const { rows } = await client.query('select customer_account_overview($1) as r', [
    userId,
  ])
  return rows[0].r as Array<{
    tenant_id: string
    business_name: string
    pets: Array<{ id: string; name: string }>
    upcoming: Array<{ pet_name: string }>
  }>
}

async function detail(client: PoolClient, userId: string, petId: string) {
  await setRole(client, 'service_role')
  const { rows } = await client.query('select customer_account_pet_detail($1, $2) as r', [
    userId,
    petId,
  ])
  return rows[0].r as Record<string, unknown> | null
}

describe('claim_customer_link()', () => {
  // Qué prueba: con un link vigente la cuenta queda vinculada al CLIENTE dueño de la mascota
  // y puede ver sus mascotas.
  // Qué se rompería: el dueño guardaría el link y su cuenta seguiría vacía.
  it('vincula la cuenta con el cliente de la mascota del link', async () => {
    await withTransaction(async (client) => {
      const user = await ownerUser(client)
      const token = await link(client, PET_ROCKY)
      const result = await claim(client, user, token)
      expect(result.tenant_id).toBe(TENANT_PATITAS)

      const data = await overview(client, user)
      expect(data).toHaveLength(1)
      // Sofía es dueña de Rocky y de Michi: ve las dos, no las de otros clientes.
      expect(data[0].pets.map((p) => p.name).sort()).toEqual(['Michi', 'Rocky'])
    })
  })

  // Qué prueba: vincular dos veces con la misma cuenta es idempotente (volver a tocar el botón).
  it('es idempotente para la misma cuenta', async () => {
    await withTransaction(async (client) => {
      const user = await ownerUser(client)
      const token = await link(client)
      const first = await claim(client, user, token)
      const second = await claim(client, user, token)
      expect(second.account_id).toBe(first.account_id)
    })
  })

  // Qué prueba: el mismo mensaje para token inexistente, revocado o vencido (§7.4).
  // Qué se rompería: alguien podría averiguar si un token alguna vez existió.
  it('rechaza un token inexistente, revocado o vencido con el mismo mensaje', async () => {
    await withTransaction(async (client) => {
      const user = await ownerUser(client)
      const revoked = await link(client, PET_ROCKY, TENANT_PATITAS, { revoked: true })
      const expired = await link(client, PET_ROCKY, TENANT_PATITAS, { expired: true })
      for (const token of [revoked, expired, randomBytes(32).toString('base64url')]) {
        await client.query('savepoint s')
        await expect(claim(client, user, token)).rejects.toThrow(GENERIC)
        await client.query('rollback to savepoint s')
      }
    })
  })

  // Qué prueba: sin sesión no se vincula.
  it('exige sesión', async () => {
    await withTransaction(async (client) => {
      const token = await link(client)
      await setRole(client, 'anon')
      await expect(
        client.query('select claim_customer_link($1)', [token]),
      ).rejects.toThrow(/permission denied|inicia sesión/i)
    })
  })

  // Qué prueba: un cliente solo puede tener UNA cuenta: quien llega segundo con el mismo link
  // (p. ej. reenviado por WhatsApp) no lo secuestra.
  // Qué se rompería: un link reenviado le daría a otra persona la cuenta de la clienta.
  it('un cliente ya vinculado a otra cuenta no se puede vincular otra vez', async () => {
    await withTransaction(async (client) => {
      const first = await ownerUser(client, ACCOUNT_A)
      const second = await ownerUser(client, ACCOUNT_B)
      const token = await link(client)
      await claim(client, first, token)
      await client.query('savepoint s')
      await expect(claim(client, second, token)).rejects.toThrow(
        /ya está vinculado a otra cuenta/i,
      )
      await client.query('rollback to savepoint s')
    })
  })

  // Qué prueba: una cuenta tiene un solo cliente por negocio (decisión del usuario).
  it('una cuenta no se vincula a dos clientes del mismo negocio', async () => {
    await withTransaction(async (client) => {
      const user = await ownerUser(client)
      await claim(client, user, await link(client, PET_ROCKY)) // Sofía
      await client.query('savepoint s')
      await expect(
        claim(client, user, await link(client, PET_LUNA_DIEGO())),
      ).rejects.toThrow(/ya está vinculada a otro cliente/i)
      await client.query('rollback to savepoint s')
    })
  })
})

// Luna es de Diego (otro cliente del mismo negocio).
function PET_LUNA_DIEGO(): string {
  return 'e0000000-0000-4000-8000-000000000003'
}

describe('desvincular', () => {
  // Qué prueba: dueño y recepción desvinculan; groomer no. Tras desvincular la cuenta ya no ve nada.
  it('el personal desvincula y la cuenta deja de ver sus mascotas', async () => {
    await withTransaction(async (client) => {
      const user = await ownerUser(client)
      await claim(client, user, await link(client))

      await setRole(client, 'authenticated', USER_GROOMER)
      await client.query('savepoint s')
      await expect(
        client.query('select unlink_customer_account($1)', [CUSTOMER_SOFIA]),
      ).rejects.toThrow(/permiso/i)
      await client.query('rollback to savepoint s')

      await setRole(client, 'authenticated', USER_RECEPCION)
      await client.query('select unlink_customer_account($1)', [CUSTOMER_SOFIA])
      expect(await overview(client, user)).toEqual([])
    })
  })

  // Qué prueba: tras desvincular, el cliente puede vincularse con otra cuenta.
  it('un cliente desvinculado puede vincularse con otra cuenta', async () => {
    await withTransaction(async (client) => {
      const first = await ownerUser(client, ACCOUNT_A)
      const second = await ownerUser(client, ACCOUNT_B)
      const token = await link(client)
      await claim(client, first, token)
      await setRole(client, 'authenticated', USER_DUENO)
      await client.query('select unlink_customer_account($1)', [CUSTOMER_SOFIA])
      expect(await claim(client, second, token)).toBeTruthy()
    })
  })
})

describe('aislamiento', () => {
  // Qué prueba: la cuenta de un dueño no lee NINGUNA tabla de negocio por la API directa: sin
  // membresía, las políticas del personal la niegan solas.
  // Qué se rompería: un dueño con sesión podría listar a los clientes del negocio.
  it('un dueño no lee tablas de negocio por la API', async () => {
    await withTransaction(async (client) => {
      const user = await ownerUser(client)
      await claim(client, user, await link(client))
      await setRole(client, 'authenticated', user)
      for (const table of [
        'customers',
        'pets',
        'appointments',
        'sales',
        'medical_records',
      ]) {
        const { rows } = await client.query(`select count(*)::int as n from ${table}`)
        expect(rows[0].n, table).toBe(0)
      }
      // Sí ve su propio vínculo.
      const own = await client.query('select count(*)::int as n from customer_accounts')
      expect(own.rows[0].n).toBe(1)
    })
  })

  // Qué prueba: las funciones de lectura no las puede llamar un usuario de la API.
  it('un usuario autenticado no puede llamar las funciones de lectura', async () => {
    await withTransaction(async (client) => {
      const user = await ownerUser(client)
      await setRole(client, 'authenticated', user)
      const calls: Array<[string, unknown[]]> = [
        ['select customer_account_overview($1)', [user]],
        ['select customer_account_pet_detail($1, $2)', [user, PET_ROCKY]],
        ['select * from customer_account_user_by_email($1)', ['a@b.mx']],
      ]
      for (const [sql, params] of calls) {
        await client.query('savepoint s')
        await expect(client.query(sql, params)).rejects.toThrow(/permission denied/i)
        await client.query('rollback to savepoint s')
      }
    })
  })

  // Qué prueba: una cuenta vinculada en un negocio no ve mascotas de otro.
  it('el detalle de una mascota de otro cliente o de otro negocio es nulo', async () => {
    await withTransaction(async (client) => {
      const user = await ownerUser(client)
      await claim(client, user, await link(client, PET_ROCKY)) // Sofía, Patitas
      expect(await detail(client, user, PET_ROCKY)).not.toBeNull()
      expect(await detail(client, user, PET_LUNA_DIEGO())).toBeNull() // otro cliente
      expect(await detail(client, user, PET_BRUNO)).toBeNull() // otro negocio
    })
  })

  // Qué prueba: la consulta por correo distingue cuentas de dueño de las del personal.
  it('identifica si un correo es una cuenta de dueño', async () => {
    await withTransaction(async (client) => {
      const user = await ownerUser(client, ACCOUNT_A, 'persona@example.mx')
      await setRole(client, 'service_role')
      const owner = await client.query(
        'select * from customer_account_user_by_email($1)',
        [' Persona@Example.mx '],
      )
      expect(owner.rows[0]).toMatchObject({ user_id: user, is_customer_account: true })
      const staff = await client.query(
        'select * from customer_account_user_by_email($1)',
        ['dueno@patitasfelices.mx'],
      )
      expect(staff.rows[0].is_customer_account).toBe(false)
      const none = await client.query(
        'select * from customer_account_user_by_email($1)',
        ['nadie@x.mx'],
      )
      expect(none.rows).toHaveLength(0)
    })
  })
})

describe('lista blanca y visibilidad por periodo', () => {
  // Qué prueba: el detalle trae cartilla, visitas y citas, y NO trae teléfonos, correos ni notas
  // internas de nadie.
  // Qué se rompería: la cuenta filtraría datos del expediente interno o de otros clientes.
  it('el detalle solo trae campos de la lista blanca', async () => {
    await withTransaction(async (client) => {
      const user = await ownerUser(client)
      await claim(client, user, await link(client, PET_ROCKY))
      const data = await detail(client, user, PET_ROCKY)
      expect(data).not.toBeNull()
      expect(Object.keys(data!).sort()).toEqual(
        [
          'business_name',
          'hospital_stays',
          'pet',
          'tenant_id',
          'upcoming',
          'vaccinations',
          'visits',
        ].sort(),
      )
      const pet = data!.pet as Record<string, unknown>
      expect(Object.keys(pet).sort()).toEqual(
        ['birth_date', 'breed', 'id', 'name', 'photo_path', 'sex', 'species'].sort(),
      )
      const serialized = JSON.stringify(data)
      expect(serialized).not.toMatch(
        /medical_alerts|grooming_notes|5512345601|@example\.mx/,
      )
    })
  })

  // Qué prueba: tras una transferencia, el dueño anterior ve solo lo ocurrido en su periodo y el
  // nuevo ve todo el historial; los montos de la hospitalización solo para quien le tocan.
  it('el dueño anterior ve su periodo; el nuevo, todo, y los montos solo en su periodo', async () => {
    await withTransaction(async (client) => {
      const sofia = await ownerUser(client, ACCOUNT_A)
      const diego = await ownerUser(client, ACCOUNT_B)
      await claim(client, sofia, await link(client, PET_ROCKY))
      await claim(client, diego, await link(client, PET_LUNA_DIEGO()))

      // Rocky: dos estancias, una en el periodo de Sofía y otra en el de Diego.
      await setRole(client, 'service_role')
      await client.query(
        `update pet_ownerships set started_at = '2026-01-01T00:00:00Z' where pet_id = $1`,
        [PET_ROCKY],
      )
      await setRole(client, 'authenticated', USER_DUENO)
      await client.query('select transfer_pet($1, $2)', [PET_ROCKY, CUSTOMER_DIEGO])
      await setRole(client, 'service_role')
      await client.query(
        `update pet_ownerships set ended_at = '2026-06-01T00:00:00Z' where pet_id = $1 and customer_id = $2`,
        [PET_ROCKY, CUSTOMER_SOFIA],
      )
      await client.query(
        `update pet_ownerships set started_at = '2026-06-01T00:00:00Z' where pet_id = $1 and customer_id = $2`,
        [PET_ROCKY, CUSTOMER_DIEGO],
      )
      await client.query(
        `insert into hospital_spaces (id, tenant_id, branch_id, name) values ('f2000000-0000-4000-8000-000000000001', $1, $2, 'J-Test')`,
        [TENANT_PATITAS, BRANCH_CENTRO],
      )
      const stay = async (admitted: string, discharged: string) => {
        await client.query(
          `insert into hospital_stays (tenant_id, branch_id, pet_id, customer_id, space_id, admitted_at, discharged_at, admitted_by, rate_mode, rate_cents, day_rule)
           values ($1, $2, $3, $4, 'f2000000-0000-4000-8000-000000000001', $5, $6, $7, 'per_stay', 50000, 'natural')`,
          [
            TENANT_PATITAS,
            BRANCH_CENTRO,
            PET_ROCKY,
            CUSTOMER_SOFIA,
            admitted,
            discharged,
            USER_DUENO,
          ],
        )
      }
      await stay('2026-03-01T10:00:00Z', '2026-03-02T10:00:00Z') // periodo de Sofía
      await stay('2026-09-01T10:00:00Z', '2026-09-02T10:00:00Z') // periodo de Diego

      const old = (await detail(client, sofia, PET_ROCKY))!
      const oldStays = old.hospital_stays as Array<{
        admitted_at: string
        cost_cents: number | null
      }>
      expect(oldStays).toHaveLength(1) // solo la suya
      expect(oldStays[0].cost_cents).toBe(50000) // y su costo, porque era la dueña entonces

      const next = (await detail(client, diego, PET_ROCKY))!
      const newStays = next.hospital_stays as Array<{
        admitted_at: string
        cost_cents: number | null
      }>
      expect(newStays).toHaveLength(2) // ve todo el historial
      const byDate = (s: { admitted_at: string }) => s.admitted_at.slice(0, 7)
      expect(newStays.find((s) => byDate(s) === '2026-03')?.cost_cents).toBeNull() // sin el monto de antes
      expect(newStays.find((s) => byDate(s) === '2026-09')?.cost_cents).toBe(50000)
    })
  })

  // Qué prueba: el costo lo ve el titular de la familia y no un miembro que no lo es.
  it('un miembro no titular de la familia ve la mascota pero no el costo', async () => {
    await withTransaction(async (client) => {
      const camila = await ownerUser(client, ACCOUNT_A)
      // Familia de Sofía (dueña de Rocky) y Camila; el titular es Sofía.
      await setRole(client, 'authenticated', USER_DUENO)
      await client.query('select save_family($1, null, $2, $3, $4)', [
        TENANT_PATITAS,
        'Familia Prueba',
        CUSTOMER_SOFIA,
        [CUSTOMER_SOFIA, CUSTOMER_CAMILA],
      ])
      // La cuenta se vincula con Camila a través de SU mascota (Simón).
      await claim(
        client,
        camila,
        await link(client, 'e0000000-0000-4000-8000-000000000007'),
      )

      await setRole(client, 'service_role')
      await client.query(
        `insert into hospital_spaces (id, tenant_id, branch_id, name) values ('f2000000-0000-4000-8000-000000000002', $1, $2, 'J-Fam')`,
        [TENANT_PATITAS, BRANCH_CENTRO],
      )
      await client.query(
        `insert into hospital_stays (tenant_id, branch_id, pet_id, customer_id, space_id, admitted_by, rate_mode, rate_cents, day_rule)
         values ($1, $2, $3, $4, 'f2000000-0000-4000-8000-000000000002', $5, 'per_stay', 70000, 'natural')`,
        [TENANT_PATITAS, BRANCH_CENTRO, PET_ROCKY, CUSTOMER_SOFIA, USER_DUENO],
      )

      const data = (await detail(client, camila, PET_ROCKY))!
      expect(data).not.toBeNull() // la familia ve la mascota
      const stays = data.hospital_stays as Array<{ cost_cents: number | null }>
      expect(stays).toHaveLength(1)
      expect(stays[0].cost_cents).toBeNull() // Camila no es la titular ni la dueña
    })
  })
})
