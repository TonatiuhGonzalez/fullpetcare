// Correo único por negocio al guardar un cliente (Correcciones 1, tarea C1.3,
// PLAN.md D26 punto 3; migración 20261014120000_customer_unique_email.sql).
//
// La regla vive en un trigger de `customers`, así que se prueba con SQL directo
// dentro de una transacción que se revierte sola (helpers.ts). Cada test crea
// sus propios clientes con correos inventados; no depende de la semilla.
import type { PoolClient } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { closePool, setRole, withTransaction } from './helpers'
import { TENANT_HUELLITAS, TENANT_PATITAS, USER_DUENO, USER_RECEPCION } from './fixtures'

afterAll(closePool)

type Result = { id: string } | { message: string; code: string | null; hint: string | null }

/** Inserta un cliente (con savepoint, para que un rechazo no aborte la transacción de prueba). */
async function insertCustomer(
  client: PoolClient,
  email: string | null,
  opts: { tenantId?: string; phone?: string } = {},
): Promise<Result> {
  await client.query('savepoint ins')
  try {
    const { rows } = await client.query(
      `insert into customers (tenant_id, first_name, last_name, phone, email)
       values ($1, 'Prueba', 'Correo', $2, $3) returning id`,
      [opts.tenantId ?? TENANT_PATITAS, opts.phone ?? null, email],
    )
    await client.query('release savepoint ins')
    return { id: rows[0].id }
  } catch (error) {
    await client.query('rollback to savepoint ins')
    const e = error as { message: string; code?: string; hint?: string }
    return { message: e.message, code: e.code ?? null, hint: e.hint ?? null }
  }
}

async function updateCustomer(
  client: PoolClient,
  id: string,
  set: string,
  params: unknown[],
): Promise<Result> {
  await client.query('savepoint upd')
  try {
    await client.query(`update customers set ${set} where id = $1`, [id, ...params])
    await client.query('release savepoint upd')
    return { id }
  } catch (error) {
    await client.query('rollback to savepoint upd')
    const e = error as { message: string; code?: string; hint?: string }
    return { message: e.message, code: e.code ?? null, hint: e.hint ?? null }
  }
}

function expectTaken(result: Result): void {
  expect('message' in result).toBe(true)
  if ('message' in result) {
    expect(result.code).toBe('23505')
    expect(result.hint).toBe('customer_email_taken')
    expect(result.message).toBe('Este correo ya está registrado.')
  }
}

describe('customers: correo único por negocio', () => {
  it('rechaza un alta con un correo que ya usa otro cliente del negocio', async () => {
    // El caso principal: sin esto, recepción da de alta dos veces a la misma
    // persona y el historial se parte en dos fichas.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      expect('id' in (await insertCustomer(client, 'ana.unica@example.mx'))).toBe(true)
      expectTaken(await insertCustomer(client, 'ana.unica@example.mx'))
    })
  })

  it('no distingue mayúsculas ni espacios en los extremos', async () => {
    // "Ana@X.mx " y "ana@x.mx" son la misma bandeja. Si la comparación fuera
    // literal, bastaría un espacio al final para duplicar al cliente.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_RECEPCION)
      expect('id' in (await insertCustomer(client, 'mixto@example.mx'))).toBe(true)
      expectTaken(await insertCustomer(client, '  MiXto@Example.MX '))
    })
  })

  it('rechaza cambiar el correo de un cliente a uno que ya usa otro', async () => {
    // La misma regla en la edición: de lo contrario se esquiva el alta y se
    // duplica al editar.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const a = await insertCustomer(client, 'primero@example.mx')
      const b = await insertCustomer(client, 'segundo@example.mx')
      if (!('id' in a) || !('id' in b)) throw new Error('armado de datos falló')
      expectTaken(await updateCustomer(client, b.id, 'email = $2', ['PRIMERO@example.mx']))
    })
  })

  it('un cliente eliminado libera su correo', async () => {
    // El borrado suave no debe dejar el correo "secuestrado" para siempre.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const a = await insertCustomer(client, 'borrado@example.mx')
      if (!('id' in a)) throw new Error('armado de datos falló')
      expect('id' in (await updateCustomer(client, a.id, 'deleted_at = now()', []))).toBe(true)
      expect('id' in (await insertCustomer(client, 'borrado@example.mx'))).toBe(true)
    })
  })

  it('otro negocio sí puede usar el mismo correo', async () => {
    // La unicidad es POR negocio. Una persona real puede ser cliente de dos
    // veterinarias distintas; negarlo filtraría que ya existe en otro tenant.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      expect('id' in (await insertCustomer(client, 'compartido@example.mx'))).toBe(true)
      await setRole(client, 'service_role')
      expect(
        'id' in (await insertCustomer(client, 'compartido@example.mx', { tenantId: TENANT_HUELLITAS })),
      ).toBe(true)
    })
  })

  it('un cliente con el correo YA duplicado puede editarse en lo demás', async () => {
    // Datos viejos: los duplicados que ya existían no se tocan (D26). Si el
    // trigger revisara en cada UPDATE, esos clientes quedarían sin poder
    // cambiar ni su teléfono.
    await withTransaction(async (client) => {
      // Se arma el duplicado apagando el trigger solo dentro de esta transacción.
      await client.query('alter table customers disable trigger customers_prevent_duplicate_email')
      const a = await insertCustomer(client, 'viejo@example.mx')
      const b = await insertCustomer(client, 'viejo@example.mx')
      await client.query('alter table customers enable trigger customers_prevent_duplicate_email')
      if (!('id' in a) || !('id' in b)) throw new Error('armado de datos falló')

      await setRole(client, 'authenticated', USER_DUENO)
      expect('id' in (await updateCustomer(client, b.id, 'phone = $2', ['5551234567']))).toBe(true)
      // Incluso mandando el MISMO correo en el SET (como hace el formulario).
      expect(
        'id' in (await updateCustomer(client, b.id, 'email = $2, phone = $3', ['viejo@example.mx', '5557654321'])),
      ).toBe(true)
    })
  })

  it('un correo vacío, de solo espacios o nulo nunca choca', async () => {
    // Muchos clientes no dan correo. Si "" chocara con "", solo uno podría
    // dejarlo en blanco.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      for (const email of ['', '   ', null, '', null]) {
        expect('id' in (await insertCustomer(client, email))).toBe(true)
      }
    })
  })

  it('cambiar solo mayúsculas del propio correo no choca consigo mismo', async () => {
    // La búsqueda excluye al propio cliente: corregir "ANA@x.mx" a "ana@x.mx"
    // no es un duplicado.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const a = await insertCustomer(client, 'MAYUS@example.mx')
      if (!('id' in a)) throw new Error('armado de datos falló')
      expect('id' in (await updateCustomer(client, a.id, 'email = $2', ['mayus@example.mx']))).toBe(true)
    })
  })
})
