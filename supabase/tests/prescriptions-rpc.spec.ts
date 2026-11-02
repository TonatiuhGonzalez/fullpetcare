// Receta médica (fase 28, tareas 28.2 a 28.4; PLAN.md D30 punto 3; migración
// 20261021120000_prescriptions.sql): tablas prescriptions y prescription_items, y las
// RPC save_prescription(), list_unregistered_medications() y resolve_unregistered_medication().
//
// Qué se protege: que la receta la emita solo quien puede (dueño o el veterinario de la
// cita) y con cédula, que lleve una COPIA de esa cédula, que no se pueda escribir ni borrar
// por fuera de la función, y que un negocio no vea las recetas de otro.
import type { PoolClient } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { closePool, setRole, withTransaction } from './helpers'
import {
  BRANCH_DEL_VALLE,
  CUSTOMER_SOFIA,
  PET_ROCKY,
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

/** Cita de veterinaria asignada al vet de Del Valle (o de la clase que se pida). */
async function seedAppointment(client: PoolClient, kind = 'veterinary'): Promise<string> {
  await setRole(client, 'service_role')
  const { rows } = await client.query(
    `insert into appointments (tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, status, created_by)
     values ($1, $2, $3, $4, $5, $6, now() + interval '30 days', now() + interval '30 days' + interval '60 minutes', 'in_progress', $6)
     returning id`,
    [TENANT_PATITAS, BRANCH_DEL_VALLE, CUSTOMER_SOFIA, PET_ROCKY, kind, USER_VET],
  )
  return rows[0].id
}

/** Deja (o quita, con null) la cédula de una persona en su ficha de Patitas Felices. */
async function setLicense(client: PoolClient, userId: string, license: string | null) {
  await setRole(client, 'service_role')
  const m = await client.query(
    'select id from memberships where tenant_id = $1 and user_id = $2',
    [TENANT_PATITAS, userId],
  )
  await client.query(
    `insert into employee_details (tenant_id, membership_id, professional_license)
     values ($1, $2, $3)
     on conflict (membership_id) do update set professional_license = excluded.professional_license`,
    [TENANT_PATITAS, m.rows[0].id, license],
  )
}

const ITEMS = JSON.stringify([
  {
    medication_name: 'Amoxicilina',
    dose: '1 tableta',
    frequency: 'Cada 12 horas',
    duration: '7 días',
  },
  { medication_name: 'Meloxicam', dose: '0.5 ml' },
])

async function save(client: PoolClient, appointmentId: string, items = ITEMS) {
  const { rows } = await client.query('select save_prescription($1, $2::jsonb) as id', [
    appointmentId,
    items,
  ])
  return rows[0].id as string
}

describe('save_prescription(): quién emite y qué guarda', () => {
  // Qué prueba: el caso feliz: el vet de la cita, con cédula, emite; la receta guarda sus
  // renglones y una COPIA de nombre y cédula.
  // Qué se rompería: la receta saldría sin cédula, o cambiaría sola si la corrigen después.
  it('el veterinario de la cita con cédula emite y se guarda la copia de su cédula', async () => {
    await withTransaction(async (client) => {
      const appointmentId = await seedAppointment(client)
      await setLicense(client, USER_VET, '1234567')

      await setRole(client, 'authenticated', USER_VET)
      const id = await save(client, appointmentId)

      const rx = await client.query(
        'select folio, issued_by_user_id, issuer_license_snapshot from prescriptions where id = $1',
        [id],
      )
      expect(rx.rows[0]).toMatchObject({
        folio: 1,
        issued_by_user_id: USER_VET,
        issuer_license_snapshot: '1234567',
      })

      const items = await client.query(
        'select medication_name, dose, frequency, duration, product_id from prescription_items where prescription_id = $1 order by position',
        [id],
      )
      expect(items.rows).toHaveLength(2)
      expect(items.rows[0]).toMatchObject({
        medication_name: 'Amoxicilina',
        dose: '1 tableta',
        frequency: 'Cada 12 horas',
        duration: '7 días',
        product_id: null,
      })
      // Sin frecuencia ni duración: nulos, no cadenas vacías.
      expect(items.rows[1]).toMatchObject({ frequency: null, duration: null })
    })
  })

  // Qué prueba: sin cédula no se emite, y el error trae la pista que la interfaz usa.
  // Qué se rompería: saldrían recetas firmadas sin cédula profesional.
  it('sin cédula capturada no se emite la receta', async () => {
    await withTransaction(async (client) => {
      const appointmentId = await seedAppointment(client)
      await setLicense(client, USER_VET, null)

      await setRole(client, 'authenticated', USER_VET)
      await client.query('savepoint s')
      await expect(save(client, appointmentId)).rejects.toMatchObject({
        message: expect.stringMatching(/cédula profesional/i),
        hint: 'license_required',
      })
      await client.query('rollback to savepoint s')
    })
  })

  // Qué prueba: recepción y groomer no emiten recetas, tengan o no cédula.
  // Qué se rompería: cualquiera del mostrador podría recetar medicamentos.
  it('recepción y groomer no pueden emitir', async () => {
    await withTransaction(async (client) => {
      const appointmentId = await seedAppointment(client)
      for (const user of [USER_RECEPCION, USER_GROOMER]) {
        await setLicense(client, user, '7654321')
        await setRole(client, 'authenticated', user)
        await client.query('savepoint s')
        await expect(save(client, appointmentId)).rejects.toThrow(
          /Solo el veterinario|No perteneces/i,
        )
        await client.query('rollback to savepoint s')
      }
    })
  })

  // Qué prueba: el dueño que ejerce puede emitir una receta de una cita que no es suya.
  it('el dueño con cédula puede emitir', async () => {
    await withTransaction(async (client) => {
      const appointmentId = await seedAppointment(client)
      await setLicense(client, USER_DUENO, '8765432')
      await setRole(client, 'authenticated', USER_DUENO)
      const id = await save(client, appointmentId)
      expect(id).toBeTruthy()
    })
  })

  // Qué prueba: una cita de estética no lleva receta.
  it('una cita de estética no admite receta', async () => {
    await withTransaction(async (client) => {
      const appointmentId = await seedAppointment(client, 'grooming')
      await setLicense(client, USER_VET, '1234567')
      await setRole(client, 'authenticated', USER_VET)
      await client.query('savepoint s')
      // El vet no es el asignado a una de estética en la regla de roles, pero sí está
      // asignado aquí: lo que se rechaza es el tipo de cita.
      await expect(save(client, appointmentId)).rejects.toThrow(/veterinaria/i)
      await client.query('rollback to savepoint s')
    })
  })

  // Qué prueba: reemplazar los renglones oculta los anteriores y conserva el folio.
  // Qué se rompería: corregir una receta crearía otra con otro folio, o duplicaría renglones.
  it('corregir la receta reemplaza los renglones y conserva el folio', async () => {
    await withTransaction(async (client) => {
      const appointmentId = await seedAppointment(client)
      await setLicense(client, USER_VET, '1234567')
      await setRole(client, 'authenticated', USER_VET)

      const first = await save(client, appointmentId)
      const second = await save(
        client,
        appointmentId,
        JSON.stringify([{ medication_name: 'Prednisona', dose: '5 mg' }]),
      )
      expect(second).toBe(first)

      const visible = await client.query(
        'select medication_name from prescription_items where prescription_id = $1',
        [first],
      )
      expect(visible.rows.map((r) => r.medication_name)).toEqual(['Prednisona'])

      // Los anteriores no se borraron: están ocultos (y la bitácora los registró).
      await setRole(client, 'service_role')
      const all = await client.query(
        'select count(*)::int as n from prescription_items where prescription_id = $1',
        [first],
      )
      expect(all.rows[0].n).toBe(3)
    })
  })

  // Qué prueba: el folio avanza de uno en uno por negocio.
  it('el folio es consecutivo por negocio', async () => {
    await withTransaction(async (client) => {
      const a = await seedAppointment(client)
      const b = await seedAppointment(client)
      await setLicense(client, USER_VET, '1234567')
      await setRole(client, 'authenticated', USER_VET)
      const first = await save(client, a)
      const second = await save(client, b)
      const { rows } = await client.query(
        'select folio from prescriptions where id = any($1) order by folio',
        [[first, second]],
      )
      expect(rows.map((r) => r.folio)).toEqual([1, 2])
    })
  })

  // Qué prueba: los bordes de la lista: vacía y renglón sin nombre.
  it('rechaza una receta vacía y un medicamento sin nombre', async () => {
    await withTransaction(async (client) => {
      const appointmentId = await seedAppointment(client)
      await setLicense(client, USER_VET, '1234567')
      await setRole(client, 'authenticated', USER_VET)

      await client.query('savepoint s')
      await expect(save(client, appointmentId, '[]')).rejects.toThrow(
        /al menos un medicamento/i,
      )
      await client.query('rollback to savepoint s')

      await client.query('savepoint s')
      await expect(
        save(client, appointmentId, JSON.stringify([{ medication_name: '   ' }])),
      ).rejects.toThrow(/no tiene nombre/i)
      await client.query('rollback to savepoint s')
    })
  })

  // Qué prueba: un producto de OTRO negocio no se puede ligar (la función salta RLS).
  it('rechaza un producto de otro negocio', async () => {
    await withTransaction(async (client) => {
      const appointmentId = await seedAppointment(client)
      await setLicense(client, USER_VET, '1234567')
      await setRole(client, 'authenticated', USER_VET)
      await client.query('savepoint s')
      await expect(
        save(
          client,
          appointmentId,
          JSON.stringify([{ medication_name: 'Ajeno', product_id: PRODUCT_HUELLITAS }]),
        ),
      ).rejects.toThrow(/no existe/i)
      await client.query('rollback to savepoint s')
    })
  })
})

describe('prescriptions: lectura y escritura directa', () => {
  async function emitOne(client: PoolClient): Promise<string> {
    const appointmentId = await seedAppointment(client)
    await setLicense(client, USER_VET, '1234567')
    await setRole(client, 'authenticated', USER_VET)
    return save(client, appointmentId)
  }

  // Qué prueba: dueño y veterinario leen; recepción, groomer y otro negocio no.
  // Qué se rompería: lo recetado a una mascota sería visible para quien no atiende.
  it('la leen dueño y veterinario; recepción, groomer y otro negocio no', async () => {
    await withTransaction(async (client) => {
      const id = await emitOne(client)

      for (const [user, expected] of [
        [USER_VET, 1],
        [USER_DUENO, 1],
        [USER_RECEPCION, 0],
        [USER_GROOMER, 0],
      ] as const) {
        await setRole(client, 'authenticated', user)
        const { rows } = await client.query(
          'select id from prescriptions where id = $1',
          [id],
        )
        expect(rows).toHaveLength(expected)
      }
    })
  })

  // Qué prueba: no hay forma de escribir una receta sin pasar por la función (así nadie
  // pone a mano una cédula distinta).
  it('no se escribe directo desde la API', async () => {
    await withTransaction(async (client) => {
      const id = await emitOne(client)
      await setRole(client, 'authenticated', USER_VET)

      await client.query('savepoint s')
      await expect(
        client.query(
          "update prescriptions set issuer_license_snapshot = '0000000' where id = $1",
          [id],
        ),
      ).resolves.toMatchObject({ rowCount: 0 }) // sin política de UPDATE: no toca filas
      await client.query('rollback to savepoint s')

      await client.query('savepoint s')
      await expect(
        client.query(
          `insert into prescription_items (tenant_id, prescription_id, medication_name) values ($1, $2, 'Directo')`,
          [TENANT_PATITAS, id],
        ),
      ).rejects.toThrow(/row-level security/i)
      await client.query('rollback to savepoint s')
    })
  })

  // Qué prueba: el expediente no se borra ni con service_role (§8.5).
  it('una receta no se puede borrar físicamente', async () => {
    await withTransaction(async (client) => {
      const id = await emitOne(client)
      await setRole(client, 'service_role')
      await client.query('savepoint s')
      await expect(
        client.query('delete from prescriptions where id = $1', [id]),
      ).rejects.toThrow(/no se puede borrar/i)
      await client.query('rollback to savepoint s')
    })
  })
})

describe('medicamentos de texto libre sin registrar', () => {
  async function emitFree(
    client: PoolClient,
    name: string,
    productId: string | null = null,
  ) {
    const appointmentId = await seedAppointment(client)
    await setLicense(client, USER_VET, '1234567')
    await setRole(client, 'authenticated', USER_VET)
    await save(
      client,
      appointmentId,
      JSON.stringify([{ medication_name: name, product_id: productId }]),
    )
  }

  // Qué prueba: el dueño ve los medicamentos de texto libre; no los de catálogo, y el
  // veterinario no ve el aviso (es del dueño).
  // Qué se rompería: el dueño nunca se enteraría de que se receta algo que no tiene registrado.
  it('el dueño ve los de texto libre, agrupados por nombre; el vet no', async () => {
    await withTransaction(async (client) => {
      await emitFree(client, 'Amoxicilina')
      await emitFree(client, ' amoxicilina ')
      await emitFree(client, 'Champú registrado', PRODUCT_SHAMPOO)

      await setRole(client, 'authenticated', USER_DUENO)
      const owner = await client.query('select * from list_unregistered_medications()')
      expect(owner.rows).toHaveLength(1)
      expect(owner.rows[0].times_prescribed).toBe(2)

      await setRole(client, 'authenticated', USER_VET)
      const vet = await client.query('select * from list_unregistered_medications()')
      expect(vet.rows).toHaveLength(0)
    })
  })

  // Qué prueba: ligar a un producto quita el aviso y deja el renglón apuntando al producto.
  it('ligar a un producto lo quita del aviso y liga los renglones', async () => {
    await withTransaction(async (client) => {
      await emitFree(client, 'Champú medicado')
      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query(
        'select resolve_unregistered_medication($1, $2, $3) as updated',
        [TENANT_PATITAS, 'champú MEDICADO', PRODUCT_SHAMPOO],
      )
      expect(rows[0].updated).toBe(1)

      const pending = await client.query('select * from list_unregistered_medications()')
      expect(pending.rows).toHaveLength(0)
      const linked = await client.query(
        'select product_id from prescription_items where medication_name = $1',
        ['Champú medicado'],
      )
      expect(linked.rows[0].product_id).toBe(PRODUCT_SHAMPOO)
    })
  })

  // Qué prueba: descartar quita el aviso sin ligar nada.
  it('descartar lo quita del aviso sin ligar producto', async () => {
    await withTransaction(async (client) => {
      await emitFree(client, 'Remedio casero')
      await setRole(client, 'authenticated', USER_DUENO)
      await client.query('select resolve_unregistered_medication($1, $2, null)', [
        TENANT_PATITAS,
        'Remedio casero',
      ])
      const pending = await client.query('select * from list_unregistered_medications()')
      expect(pending.rows).toHaveLength(0)
    })
  })

  // Qué prueba: solo el dueño resuelve; un producto de otro negocio no se acepta.
  it('solo el dueño resuelve y el producto debe ser del negocio', async () => {
    await withTransaction(async (client) => {
      await emitFree(client, 'Pomada')

      await setRole(client, 'authenticated', USER_VET)
      await client.query('savepoint s')
      await expect(
        client.query('select resolve_unregistered_medication($1, $2, null)', [
          TENANT_PATITAS,
          'Pomada',
        ]),
      ).rejects.toThrow(/Solo el dueño/i)
      await client.query('rollback to savepoint s')

      await setRole(client, 'authenticated', USER_DUENO)
      await client.query('savepoint s')
      await expect(
        client.query('select resolve_unregistered_medication($1, $2, $3)', [
          TENANT_PATITAS,
          'Pomada',
          PRODUCT_HUELLITAS,
        ]),
      ).rejects.toThrow(/no existe/i)
      await client.query('rollback to savepoint s')

      // Y desde otro negocio: ni siquiera es miembro de Huellitas.
      await client.query('savepoint s')
      await expect(
        client.query('select resolve_unregistered_medication($1, $2, null)', [
          TENANT_HUELLITAS,
          'Pomada',
        ]),
      ).rejects.toThrow(/Solo el dueño/i)
      await client.query('rollback to savepoint s')
    })
  })
})
