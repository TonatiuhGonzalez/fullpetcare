// Prueba create_employee_membership() (migración
// 20260910120800_create_employee_membership_rpc.sql, fase 9): el RPC que
// da de alta membership + membership_branches + employee_details en una
// sola transacción. Mismo patrón que checkout-rpc.spec.ts: sesión
// simulada vía pg (no HTTP), con SAVEPOINT para poder seguir consultando
// la misma transacción después de una excepción esperada, y así
// comprobar que "todo o nada" es real, no solo un comentario.
import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import { closePool, setRole, withTransaction } from './helpers'
import {
  BRANCH_CENTRO,
  BRANCH_TIJUANA,
  TENANT_HUELLITAS,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_VET,
} from './fixtures'

afterAll(closePool)

interface CreateEmployeeInput {
  tenantId: string
  userId: string
  role: string
  branchIds: string[]
  birthDate?: string | null
  curp?: string | null
  rfc?: string | null
  voterIdNumber?: string | null
}

// `create_employee_membership` regresa el tipo compuesto "memberships" —
// PostgREST (lo que de verdad usa el frontend, vía supabase.rpc()) lo
// serializa como JSON solo. El driver `pg` crudo que usan estos tests NO
// hace ese parseo (lo regresaría como un texto tipo "(id,tenant_id,...)"),
// así que se extrae el campo directo en SQL con "(función(...)).campo" en
// vez de intentar parsear la fila compuesta a mano en JavaScript.
function createEmployee(client: PoolClient, input: CreateEmployeeInput) {
  return client.query(
    `select (create_employee_membership($1, $2, $3, $4::uuid[], $5, $6, $7, $8)).id as membership_id`,
    [
      input.tenantId,
      input.userId,
      input.role,
      input.branchIds,
      input.birthDate ?? '1990-01-01',
      input.curp ?? 'TEST900101HDFAAA01',
      input.rfc ?? 'TEST900101AB1',
      input.voterIdNumber ?? '1234567890123',
    ],
  )
}

/** Libera a USER_VET de su membership actual en Patitas, para poder "recontratarlo" en los tests. */
async function freeUpVet(client: PoolClient): Promise<void> {
  await setRole(client, 'service_role')
  await client.query('update memberships set tenant_id = $1 where user_id = $2', [
    TENANT_HUELLITAS,
    USER_VET,
  ])
}

describe('create_employee_membership(): camino feliz', () => {
  it('crea membership + membership_branches + employee_details, todo junto', async () => {
    await withTransaction(async (client) => {
      await freeUpVet(client)

      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await createEmployee(client, {
        tenantId: TENANT_PATITAS,
        userId: USER_VET,
        role: 'receptionist',
        branchIds: [BRANCH_CENTRO],
        curp: 'RECN900101MDFAAA09',
        rfc: 'RECN900101AB9',
      })
      const membershipId = rows[0].membership_id

      const { rows: branchRows } = await client.query(
        'select branch_id from membership_branches where membership_id = $1',
        [membershipId],
      )
      expect(branchRows).toHaveLength(1)
      expect(branchRows[0].branch_id).toBe(BRANCH_CENTRO)

      const { rows: detailRows } = await client.query(
        'select curp, rfc from employee_details where membership_id = $1',
        [membershipId],
      )
      expect(detailRows).toHaveLength(1)
      expect(detailRows[0].curp).toBe('RECN900101MDFAAA09')
    })
  })

  it('un empleado "owner" no necesita sucursales asignadas (ve todas por rol, CLAUDE.md §6.1)', async () => {
    await withTransaction(async (client) => {
      await freeUpVet(client)

      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await createEmployee(client, {
        tenantId: TENANT_PATITAS,
        userId: USER_VET,
        role: 'owner',
        branchIds: [],
      })
      const membershipId = rows[0].membership_id

      const { rows: branchRows } = await client.query(
        'select id from membership_branches where membership_id = $1',
        [membershipId],
      )
      expect(branchRows).toHaveLength(0)
    })
  })
})

describe('create_employee_membership(): validaciones, todo o nada', () => {
  it('una sucursal que no pertenece al negocio se rechaza y NO deja ningún membership a medias', async () => {
    await withTransaction(async (client) => {
      await freeUpVet(client)

      await setRole(client, 'authenticated', USER_DUENO)
      await client.query('savepoint before_create')
      await expect(
        createEmployee(client, {
          tenantId: TENANT_PATITAS,
          userId: USER_VET,
          role: 'receptionist',
          branchIds: [BRANCH_TIJUANA], // sucursal de Huellitas Spa, no de Patitas
        }),
      ).rejects.toThrow(/no pertenecen a este negocio/i)
      await client.query('rollback to savepoint before_create')

      const { rows } = await client.query(
        'select id from memberships where tenant_id = $1 and user_id = $2',
        [TENANT_PATITAS, USER_VET],
      )
      expect(rows).toHaveLength(0)
    })
  })

  it('dar de alta a alguien que YA tiene membership en este tenant se rechaza con un mensaje claro', async () => {
    await withTransaction(async (client) => {
      // USER_GROOMER ya pertenece a Patitas Felices en la semilla — no
      // se libera a propósito, es justo el caso que se prueba.
      await setRole(client, 'authenticated', USER_DUENO)
      await client.query('savepoint before_duplicate')
      await expect(
        createEmployee(client, {
          tenantId: TENANT_PATITAS,
          userId: USER_GROOMER,
          role: 'vet',
          branchIds: [BRANCH_CENTRO],
        }),
      ).rejects.toThrow(/ya tiene acceso a este negocio/i)
      await client.query('rollback to savepoint before_duplicate')
    })
  })

  it('revalida el permiso adentro aunque se llame directo (SECURITY DEFINER salta RLS, CLAUDE.md §7.3.4)', async () => {
    // Este es el caso que de verdad importa: como la función es
    // SECURITY DEFINER, un groomer SÍ podría ejecutar el INSERT interno
    // si el RPC no revalidara — la única barrera real es esta línea de
    // adentro, no las políticas de las tablas (que aquí ni se evalúan).
    await withTransaction(async (client) => {
      await freeUpVet(client)

      await setRole(client, 'authenticated', USER_GROOMER)
      await client.query('savepoint before_unauthorized')
      await expect(
        createEmployee(client, {
          tenantId: TENANT_PATITAS,
          userId: USER_VET,
          role: 'receptionist',
          branchIds: [BRANCH_CENTRO],
        }),
      ).rejects.toThrow(/no tienes permiso para dar de alta empleados/i)
      await client.query('rollback to savepoint before_unauthorized')

      const { rows } = await client.query(
        'select id from memberships where tenant_id = $1 and user_id = $2',
        [TENANT_PATITAS, USER_VET],
      )
      expect(rows).toHaveLength(0)
    })
  })
})
