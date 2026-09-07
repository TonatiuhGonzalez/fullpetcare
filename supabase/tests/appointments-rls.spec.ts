// Aislamiento y permisos de appointments/appointment_services (tarea
// 3.13). A diferencia de customers/pets, aquí también se prueba el
// alcance por SUCURSAL (no solo por tenant) — CLAUDE.md §6.1:
// "receptionist/groomer/vet: sus sucursales" — y que la política de
// INSERT sigue protegiendo aunque la app normal use la función
// create_appointment() (RPC) en vez de un insert directo: si alguien
// intentara saltarse la función con un insert crudo, RLS lo detiene
// igual.
import { afterAll, describe, expect, it } from 'vitest'

import { closePool, setRole, withTransaction } from './helpers'
import {
  BRANCH_CENTRO,
  BRANCH_DEL_VALLE,
  CUSTOMER_SOFIA,
  PET_ROCKY,
  SERVICE_BANO,
  TENANT_HUELLITAS,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
  USER_VET,
} from './fixtures'

afterAll(closePool)

/**
 * Llama create_appointment() con el rol/usuario ya fijado en `client` —
 * mismo patrón que checkout-rpc.spec.ts, para probar la función tal cual
 * la usa la app (vía RPC), no un insert directo.
 */
async function callCreateAppointment(
  client: Parameters<typeof setRole>[0],
  args: { branchId: string; kind: 'grooming' | 'veterinary'; employeeUserId: string },
): Promise<{ id: string } | { error: string }> {
  try {
    const { rows } = await client.query(
      `select (create_appointment($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)).id as id`,
      [
        TENANT_PATITAS,
        args.branchId,
        CUSTOMER_SOFIA,
        PET_ROCKY,
        args.kind,
        args.employeeUserId,
        new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
        new Date(Date.now() + 20 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
        null,
        JSON.stringify([{ service_id: SERVICE_BANO, quantity: 1 }]),
      ],
    )
    return { id: rows[0].id }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

// Crea una cita de prueba (como service_role, dentro de la transacción
// del test) en la sucursal Del Valle, asignada al veterinario — el
// groomer sembrado SOLO tiene acceso a Centro (seed.sql), así que sirve
// para probar el alcance por sucursal, no solo por tenant.
async function seedTestAppointment(client: Parameters<typeof setRole>[0]): Promise<string> {
  await setRole(client, 'service_role')
  const { rows } = await client.query(
    `insert into appointments (tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, created_by)
     values ($1, $2, $3, $4, 'veterinary', $5, now() + interval '10 days', now() + interval '10 days' + interval '30 minutes', $6)
     returning id`,
    [TENANT_PATITAS, BRANCH_DEL_VALLE, CUSTOMER_SOFIA, PET_ROCKY, USER_VET, USER_DUENO],
  )
  return rows[0].id
}

describe('Aislamiento entre tenants: appointments', () => {
  it('un miembro de OTRO tenant no ve la cita', async () => {
    await withTransaction(async (client) => {
      const appointmentId = await seedTestAppointment(client)

      await setRole(client, 'service_role')
      await client.query('update memberships set tenant_id = $1 where user_id = $2', [
        TENANT_HUELLITAS,
        USER_GROOMER,
      ])

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows } = await client.query('select id from appointments where id = $1', [
        appointmentId,
      ])

      expect(rows).toHaveLength(0)
    })
  })
})

describe('Alcance por sucursal dentro del MISMO tenant', () => {
  it('un empleado sin acceso a esa sucursal no ve la cita, aunque sea del mismo tenant', async () => {
    // El groomer sembrado solo tiene Centro (seed.sql); la cita de
    // prueba es de Del Valle. is_member_of() por sí solo dejaría pasar
    // esto — la política usa can_access_branch(), que sí distingue.
    await withTransaction(async (client) => {
      const appointmentId = await seedTestAppointment(client)

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows } = await client.query('select id from appointments where id = $1', [
        appointmentId,
      ])

      expect(rows).toHaveLength(0)
    })
  })

  it('control: el veterinario asignado (con acceso a Del Valle) sí ve su propia cita', async () => {
    await withTransaction(async (client) => {
      const appointmentId = await seedTestAppointment(client)

      await setRole(client, 'authenticated', USER_VET)
      const { rows } = await client.query('select id from appointments where id = $1', [
        appointmentId,
      ])

      expect(rows).toHaveLength(1)
    })
  })

  it('control: el dueño ve la cita de cualquier sucursal, sin fila en membership_branches', async () => {
    await withTransaction(async (client) => {
      const appointmentId = await seedTestAppointment(client)

      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query('select id from appointments where id = $1', [
        appointmentId,
      ])

      expect(rows).toHaveLength(1)
    })
  })
})

describe('Política de INSERT: protege aunque no se use la RPC', () => {
  it('un groomer no puede insertar una cita directo (solo owner/receptionist agendan)', async () => {
    await withTransaction(async (client) => {
      // Centro: el groomer SÍ tiene acceso a esta sucursal (seed.sql) —
      // a propósito, para que el rechazo se deba al ROL, no a la
      // sucursal (eso ya lo prueba el describe de "alcance por sucursal").
      await setRole(client, 'authenticated', USER_GROOMER)
      await expect(
        client.query(
          `insert into appointments (tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, created_by)
           values ($1, $2, $3, $4, 'grooming', $5, now() + interval '11 days', now() + interval '11 days' + interval '30 minutes', $5)`,
          [TENANT_PATITAS, BRANCH_CENTRO, CUSTOMER_SOFIA, PET_ROCKY, USER_GROOMER],
        ),
      ).rejects.toThrow(/row-level security/i)
    })
  })

  it('recepción SÍ puede insertar una cita directo (aunque en la práctica la app use la RPC)', async () => {
    await withTransaction(async (client) => {
      // Centro, no Del Valle: recepción solo tiene acceso a Centro
      // (seed.sql) — la política exige rol Y sucursal correctos.
      await setRole(client, 'authenticated', USER_RECEPCION)
      const { rows } = await client.query(
        `insert into appointments (tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, created_by)
         values ($1, $2, $3, $4, 'grooming', $5, now() + interval '12 days', now() + interval '12 days' + interval '30 minutes', $5)
         returning id`,
        [TENANT_PATITAS, BRANCH_CENTRO, CUSTOMER_SOFIA, PET_ROCKY, USER_RECEPCION],
      )
      expect(rows).toHaveLength(1)
    })
  })
})

// Nuevo tras el UAT (migración role_permission_hardening.sql):
// create_appointment() validaba QUIÉN AGENDA (owner/receptionist) y que
// no hubiera traslape de horario, pero nunca revisaba que el EMPLEADO
// ASIGNADO tuviera el rol correcto para el tipo de cita — recepción
// podía agendar una cita de veterinaria a un groomer, una de estética a
// un vet, o cualquiera de las dos a sí misma. Esto se prueba llamando a
// la función tal cual la usa la app (RPC), no con un insert directo,
// porque la validación vive DENTRO de la función.
describe('create_appointment(): el empleado asignado debe poder atender ese tipo de cita', () => {
  it('rechaza asignar una cita de VETERINARIA a un groomer', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const result = await callCreateAppointment(client, {
        branchId: BRANCH_DEL_VALLE,
        kind: 'veterinary',
        employeeUserId: USER_GROOMER,
      })
      expect('error' in result && /no puede atender citas de este tipo/i.test(result.error)).toBe(
        true,
      )
    })
  })

  it('rechaza asignar una cita de ESTÉTICA a un vet', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const result = await callCreateAppointment(client, {
        branchId: BRANCH_CENTRO,
        kind: 'grooming',
        employeeUserId: USER_VET,
      })
      expect('error' in result && /no puede atender citas de este tipo/i.test(result.error)).toBe(
        true,
      )
    })
  })

  it('rechaza asignar CUALQUIER cita a recepción — recepción agenda, no atiende', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const result = await callCreateAppointment(client, {
        branchId: BRANCH_CENTRO,
        kind: 'grooming',
        employeeUserId: USER_RECEPCION,
      })
      expect('error' in result && /no puede atender citas de este tipo/i.test(result.error)).toBe(
        true,
      )
    })
  })

  it('control: sí se puede asignar una cita de estética a un groomer', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const result = await callCreateAppointment(client, {
        branchId: BRANCH_CENTRO,
        kind: 'grooming',
        employeeUserId: USER_GROOMER,
      })
      expect('id' in result).toBe(true)
    })
  })

  it('control: sí se puede asignar una cita de veterinaria a un vet', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const result = await callCreateAppointment(client, {
        branchId: BRANCH_DEL_VALLE,
        kind: 'veterinary',
        employeeUserId: USER_VET,
      })
      expect('id' in result).toBe(true)
    })
  })

  it('control: el dueño puede asignarse a sí mismo cualquier tipo de cita', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const result = await callCreateAppointment(client, {
        branchId: BRANCH_DEL_VALLE,
        kind: 'veterinary',
        employeeUserId: USER_DUENO,
      })
      expect('id' in result).toBe(true)
    })
  })
})

// Endurecido tras el UAT (migración role_permission_hardening.sql):
// CLAUDE.md §6.1 ya decía "groomer/vet: Su agenda", pero hasta ahora la
// política de SELECT solo miraba la SUCURSAL, no el empleado — un
// groomer con acceso a una sucursal podía leer, vía API directa, las
// citas de OTRO empleado de esa misma sucursal (p. ej. las de
// veterinaria del vet). Los describes de "alcance por sucursal" de
// arriba no alcanzan a probar esto: groomer y vet, en la semilla, están
// en sucursales DISTINTAS (Centro / Del Valle), así que cualquier
// diferencia ahí podría deberse a la sucursal, no al empleado. Aquí se
// les da a ambos acceso a la MISMA sucursal (a mano, dentro de la
// transacción de prueba) para aislar de verdad la variable que importa.
describe('Política de SELECT: groomer/vet solo ven SUS PROPIAS citas (no todas las de la sucursal)', () => {
  async function grantVetAccessToCentro(client: Parameters<typeof setRole>[0]): Promise<void> {
    await setRole(client, 'service_role')
    await client.query(
      `insert into membership_branches (tenant_id, membership_id, branch_id)
       select m.tenant_id, m.id, $2
       from memberships m
       where m.user_id = $1 and m.tenant_id = $3`,
      [USER_VET, BRANCH_CENTRO, TENANT_PATITAS],
    )
  }

  async function seedCentroAppointmentForVet(client: Parameters<typeof setRole>[0]): Promise<string> {
    await setRole(client, 'service_role')
    const { rows } = await client.query(
      `insert into appointments (tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, created_by)
       values ($1, $2, $3, $4, 'veterinary', $5, now() + interval '13 days', now() + interval '13 days' + interval '30 minutes', $6)
       returning id`,
      [TENANT_PATITAS, BRANCH_CENTRO, CUSTOMER_SOFIA, PET_ROCKY, USER_VET, USER_DUENO],
    )
    return rows[0].id
  }

  it('un groomer con acceso a la MISMA sucursal no ve la cita de un vet que no es la suya', async () => {
    await withTransaction(async (client) => {
      await grantVetAccessToCentro(client)
      const appointmentId = await seedCentroAppointmentForVet(client)

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows } = await client.query('select id from appointments where id = $1', [
        appointmentId,
      ])
      expect(rows).toHaveLength(0)
    })
  })

  it('control: el vet asignado sí ve su propia cita, en esa misma sucursal', async () => {
    await withTransaction(async (client) => {
      await grantVetAccessToCentro(client)
      const appointmentId = await seedCentroAppointmentForVet(client)

      await setRole(client, 'authenticated', USER_VET)
      const { rows } = await client.query('select id from appointments where id = $1', [
        appointmentId,
      ])
      expect(rows).toHaveLength(1)
    })
  })

  it('control: recepción SÍ ve las citas de cualquier empleado de su sucursal', async () => {
    await withTransaction(async (client) => {
      const appointmentId = await seedCentroAppointmentForVet(client)

      await setRole(client, 'authenticated', USER_RECEPCION)
      const { rows } = await client.query('select id from appointments where id = $1', [
        appointmentId,
      ])
      expect(rows).toHaveLength(1)
    })
  })
})

describe('Política de UPDATE: owner/recepción, o el empleado asignado a ESA cita', () => {
  it('el empleado asignado puede actualizar su propia cita (p. ej. marcarla en curso)', async () => {
    await withTransaction(async (client) => {
      const appointmentId = await seedTestAppointment(client)

      await setRole(client, 'authenticated', USER_VET)
      const { rowCount } = await client.query(
        "update appointments set status = 'in_progress' where id = $1",
        [appointmentId],
      )
      expect(rowCount).toBe(1)
    })
  })

  it('OTRO empleado (no asignado a esa cita) no puede actualizarla', async () => {
    await withTransaction(async (client) => {
      const appointmentId = await seedTestAppointment(client)

      // El groomer no es ni owner/receptionist ni el empleado asignado
      // (la cita es del vet) — no debe poder tocarla, aunque comparta
      // tenant.
      await setRole(client, 'authenticated', USER_GROOMER)
      const { rowCount } = await client.query(
        "update appointments set status = 'in_progress' where id = $1",
        [appointmentId],
      )
      expect(rowCount).toBe(0)
    })
  })
})

describe('Aislamiento entre tenants: appointment_services', () => {
  it('sigue el acceso de su cita: un miembro sin acceso a la sucursal no ve los servicios de esa cita', async () => {
    await withTransaction(async (client) => {
      const appointmentId = await seedTestAppointment(client)

      await setRole(client, 'service_role')
      await client.query(
        `insert into appointment_services (tenant_id, appointment_id, service_id, name_snapshot, unit_price_cents, duration_minutes_snapshot)
         select $1, $2, id, name, price_cents, duration_minutes from services where tenant_id = $1 and kind = 'veterinary' limit 1`,
        [TENANT_PATITAS, appointmentId],
      )

      // El groomer (solo Centro) no debería ver los servicios de una
      // cita de Del Valle.
      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows } = await client.query(
        'select id from appointment_services where appointment_id = $1',
        [appointmentId],
      )
      expect(rows).toHaveLength(0)
    })
  })
})
