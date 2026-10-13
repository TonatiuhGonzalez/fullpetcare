// Reglas de fecha y hora de create_appointment() y reschedule_appointment(), y
// traslape que YA NO se rechaza (Correcciones 1, tarea C1.2, PLAN.md D26;
// migración 20261014110000_appointment_schedule_rules.sql).
//
// Se llaman las funciones por SQL tal cual las usa la app (RPC), dentro de una
// transacción que se revierte sola (helpers.ts), así no queda ninguna cita
// en la base y los tests no dependen del orden.
//
// Las fechas NUNCA son fijas (envejecerían y la regla "no en el pasado" las
// rompería en unos meses): se calculan con SQL como "el próximo miércoles a
// tal hora LOCAL de la sucursal", entre 8 y 14 días a futuro.
//
// Horario de la semilla para Sucursal Centro (America/Mexico_City): lunes a
// viernes 09:00-18:00, sábado 09:00-15:00, domingo cerrado.
import type { PoolClient } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { closePool, setRole, withTransaction } from './helpers'
import {
  BRANCH_CENTRO,
  CUSTOMER_SOFIA,
  PET_ROCKY,
  SERVICE_BANO,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
} from './fixtures'

afterAll(closePool)

const DOW = { sunday: 0, wednesday: 3, saturday: 6 } as const

/** Próxima fecha (8 a 14 días a futuro) con ese día de la semana, a la hora LOCAL `hhmm` de `tz`. */
async function localInstant(
  client: PoolClient,
  tz: string,
  dow: number,
  hhmm: string,
): Promise<Date> {
  const { rows } = await client.query(
    `select (extract(epoch from ((d + $3::time) at time zone $1)) * 1000)::bigint as ms
       from (
         select gs::date as d
         from generate_series((now() at time zone $1)::date + 8, (now() at time zone $1)::date + 14, interval '1 day') gs
       ) days
      where extract(dow from d) = $2`,
    [tz, dow, hhmm],
  )
  return new Date(Number(rows[0].ms))
}

const MX = 'America/Mexico_City'

type Booked = { id: string } | { message: string; hint: string | null }

/**
 * Llama create_appointment() con un savepoint: si Postgres la rechaza, la
 * transacción de prueba sigue viva y devolvemos el mensaje y el `hint` (el
 * código estable que la interfaz usa para distinguir la causa).
 */
async function book(
  client: PoolClient,
  startsAt: Date,
  endsAt: Date,
  opts: { branchId?: string; employee?: string } = {},
): Promise<Booked> {
  await client.query('savepoint book')
  try {
    const { rows } = await client.query(
      `select (create_appointment($1, $2, $3, $4, 'grooming', $5, $6, $7, null, $8)).id as id`,
      [
        TENANT_PATITAS,
        opts.branchId ?? BRANCH_CENTRO,
        CUSTOMER_SOFIA,
        PET_ROCKY,
        opts.employee ?? USER_GROOMER,
        startsAt.toISOString(),
        endsAt.toISOString(),
        JSON.stringify([{ service_id: SERVICE_BANO, quantity: 1 }]),
      ],
    )
    await client.query('release savepoint book')
    return { id: rows[0].id }
  } catch (error) {
    await client.query('rollback to savepoint book')
    const e = error as { message: string; hint?: string }
    return { message: e.message, hint: e.hint ?? null }
  }
}

async function reschedule(
  client: PoolClient,
  appointmentId: string,
  startsAt: Date,
  endsAt: Date,
): Promise<Booked> {
  await client.query('savepoint resched')
  try {
    await client.query('select reschedule_appointment($1, $2, $3)', [
      appointmentId,
      startsAt.toISOString(),
      endsAt.toISOString(),
    ])
    await client.query('release savepoint resched')
    return { id: appointmentId }
  } catch (error) {
    await client.query('rollback to savepoint resched')
    const e = error as { message: string; hint?: string }
    return { message: e.message, hint: e.hint ?? null }
  }
}

const minutes = (d: Date, n: number): Date => new Date(d.getTime() + n * 60_000)

function expectRejected(result: Booked, hint: string, message: RegExp): void {
  expect('message' in result).toBe(true)
  if ('message' in result) {
    expect(result.hint).toBe(hint)
    expect(result.message).toMatch(message)
  }
}

describe('create_appointment(): fecha en el pasado', () => {
  it('rechaza una cita que empezó hace un segundo (sin tolerancia)', async () => {
    // Se compara contra now() de la base. Si hubiera "un minuto de gracia", la
    // agenda aceptaría citas que ya empezaron y los reportes del día mentirían.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const start = new Date(Date.now() - 1000)
      const result = await book(client, start, minutes(start, 60))
      expectRejected(result, 'appointment_in_past', /ya pasó/i)
    })
  })

  it('rechaza una cita que empieza este mismo minuto (el minuto ya empezó)', async () => {
    // El formulario manda horas en punto o en múltiplos de 5 minutos: elegir
    // "ahora mismo" da un inicio con segundos en cero que ya es pasado.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query(`select date_trunc('minute', now()) as t`)
      const start: Date = rows[0].t
      const result = await book(client, start, minutes(start, 60))
      expectRejected(result, 'appointment_in_past', /ya pasó/i)
    })
  })
})

describe('create_appointment(): horario de la sucursal', () => {
  it('permite empezar justo a la apertura (09:00)', async () => {
    // Borde inferior: [apertura, ...]. Si usara "<" en vez de "<=" se perdería
    // la primera cita del día de todas las sucursales.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const start = await localInstant(client, MX, DOW.wednesday, '09:00')
      const result = await book(client, start, minutes(start, 60))
      expect('id' in result).toBe(true)
    })
  })

  it('permite terminar justo al cierre (18:00)', async () => {
    // Borde superior: [..., cierre]. La última cita del día debe poder
    // terminar exactamente a la hora de cierre.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const start = await localInstant(client, MX, DOW.wednesday, '17:00')
      const result = await book(client, start, minutes(start, 60))
      expect('id' in result).toBe(true)
    })
  })

  it('rechaza terminar un minuto después del cierre', async () => {
    // Se prueba el borde del lado malo: 17:01 a 18:01. Sin esta regla, la
    // interfaz podría ofrecer horarios que ningún empleado está presente.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const start = await localInstant(client, MX, DOW.wednesday, '17:01')
      const result = await book(client, start, minutes(start, 60))
      expectRejected(result, 'outside_branch_hours', /fuera del horario/i)
    })
  })

  it('rechaza empezar un minuto antes de la apertura', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const start = await localInstant(client, MX, DOW.wednesday, '08:59')
      const result = await book(client, start, minutes(start, 60))
      expectRejected(result, 'outside_branch_hours', /fuera del horario/i)
    })
  })

  it('rechaza una cita en un día cerrado (domingo), con un mensaje distinto al de fuera de horario', async () => {
    // Día cerrado y fuera de horario son causas distintas: la interfaz debe
    // poder decir "ese día no abre" en vez de "cambia la hora".
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const start = await localInstant(client, MX, DOW.sunday, '10:00')
      const result = await book(client, start, minutes(start, 60))
      expectRejected(result, 'branch_closed_day', /cerrada ese día/i)
    })
  })

  it('respeta el horario propio de cada día (sábado cierra a las 15:00)', async () => {
    // Si el chequeo usara un solo horario para toda la semana, el sábado
    // aceptaría citas hasta las 18:00.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const ok = await localInstant(client, MX, DOW.saturday, '14:00')
      expect('id' in (await book(client, ok, minutes(ok, 60)))).toBe(true)

      const late = await localInstant(client, MX, DOW.saturday, '14:30')
      const result = await book(client, late, minutes(late, 60))
      expectRejected(result, 'outside_branch_hours', /fuera del horario/i)
    })
  })

  it('rechaza una cita que cruza la medianoche', async () => {
    // Empieza dentro del horario (17:30) pero termina al día siguiente: no
    // cabe en el horario de ese día.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const start = await localInstant(client, MX, DOW.wednesday, '17:30')
      const result = await book(client, start, minutes(start, 12 * 60))
      expectRejected(result, 'outside_branch_hours', /fuera del horario/i)
    })
  })

  it('evalúa el horario en la zona de la sucursal: la misma hora UTC es distinta en Tijuana y en CDMX', async () => {
    // CLAUDE.md §8.3. El miércoles 09:00 de la Ciudad de México es antes de
    // la apertura en Tijuana (07:00 u 08:00 según horario de verano). Si la
    // base usara UTC o la zona del navegador, el mismo instante se aceptaría
    // en las dos sucursales.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const start = await localInstant(client, MX, DOW.wednesday, '09:00')
      expect('id' in (await book(client, start, minutes(start, 60)))).toBe(true)

      await setRole(client, 'service_role')
      await client.query(`update branches set timezone = 'America/Tijuana' where id = $1`, [
        BRANCH_CENTRO,
      ])
      await setRole(client, 'authenticated', USER_DUENO)
      const result = await book(client, start, minutes(start, 60))
      expectRejected(result, 'outside_branch_hours', /fuera del horario/i)
    })
  })

  it('en Tijuana la cita de 17:00 a 18:00 hora local sí cabe, y en CDMX ese mismo instante no', async () => {
    // La otra dirección del caso anterior: el instante que en Tijuana es el
    // último turno del día, en CDMX ya es después del cierre.
    await withTransaction(async (client) => {
      const tijuanaStart = await localInstant(client, 'America/Tijuana', DOW.wednesday, '17:00')

      // Con la sucursal en Tijuana: cabe.
      await setRole(client, 'service_role')
      await client.query(`update branches set timezone = 'America/Tijuana' where id = $1`, [
        BRANCH_CENTRO,
      ])
      await setRole(client, 'authenticated', USER_DUENO)
      expect('id' in (await book(client, tijuanaStart, minutes(tijuanaStart, 60)))).toBe(true)

      // Con la sucursal en CDMX: el mismo instante es 18:00-19:00 local.
      await setRole(client, 'service_role')
      await client.query(`update branches set timezone = 'America/Mexico_City' where id = $1`, [
        BRANCH_CENTRO,
      ])
      await setRole(client, 'authenticated', USER_DUENO)
      const result = await book(client, tijuanaStart, minutes(tijuanaStart, 60))
      expectRejected(result, 'outside_branch_hours', /fuera del horario/i)
    })
  })

  it('una sucursal sin horario capturado cuenta como cerrada', async () => {
    // opening_hours trae '{}' por defecto. Sin horario no hay forma de saber
    // cuándo atienden: se rechaza en lugar de aceptar a cualquier hora.
    await withTransaction(async (client) => {
      const start = await localInstant(client, MX, DOW.wednesday, '10:00')
      await setRole(client, 'service_role')
      await client.query(`update branches set opening_hours = '{}'::jsonb where id = $1`, [
        BRANCH_CENTRO,
      ])
      await setRole(client, 'authenticated', USER_DUENO)
      const result = await book(client, start, minutes(start, 60))
      expectRejected(result, 'branch_closed_day', /cerrada ese día/i)
    })
  })
})

describe('create_appointment(): fin antes del inicio', () => {
  it('rechaza un fin anterior al inicio y uno igual, con su propio código', async () => {
    // Una cita de duración cero o negativa rompe la agenda y el cobro.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const start = await localInstant(client, MX, DOW.wednesday, '10:00')
      expectRejected(
        await book(client, start, minutes(start, -30)),
        'end_before_start',
        /terminar después/i,
      )
      expectRejected(await book(client, start, start), 'end_before_start', /terminar después/i)
    })
  })
})

describe('create_appointment(): el traslape ya no se rechaza (D26)', () => {
  it('permite una cita que empieza justo cuando otra termina', async () => {
    // Caso de control: los extremos nunca fueron traslape.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const start = await localInstant(client, MX, DOW.wednesday, '10:00')
      expect('id' in (await book(client, start, minutes(start, 60)))).toBe(true)
      expect('id' in (await book(client, minutes(start, 60), minutes(start, 120)))).toBe(true)
    })
  })

  it('permite traslape parcial y total del mismo empleado', async () => {
    // Antes de D26 la base lo rechazaba con "ya tiene una cita". Ahora es un
    // aviso de la interfaz; si la base siguiera rechazando, el aviso
    // fallaría al guardar.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const start = await localInstant(client, MX, DOW.wednesday, '10:00')
      expect('id' in (await book(client, start, minutes(start, 60)))).toBe(true)
      // parcial: 10:30-11:30
      expect('id' in (await book(client, minutes(start, 30), minutes(start, 90)))).toBe(true)
      // total: exactamente la misma
      expect('id' in (await book(client, start, minutes(start, 60)))).toBe(true)

      await setRole(client, 'service_role')
      const { rows } = await client.query(
        `select count(*)::int as n from appointments
          where employee_user_id = $1 and starts_at >= $2 and starts_at < $3`,
        [USER_GROOMER, start, minutes(start, 120)],
      )
      expect(rows[0].n).toBe(3)
    })
  })
})

describe('create_appointment(): lo que ya validaba se conserva', () => {
  it('recepción puede agendar con las nuevas reglas (permiso y rol intactos)', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_RECEPCION)
      const start = await localInstant(client, MX, DOW.wednesday, '10:00')
      expect('id' in (await book(client, start, minutes(start, 60)))).toBe(true)
    })
  })

  it('la función interna no se puede llamar directo desde el navegador', async () => {
    // app.create_appointment_core() recibe la bandera que desactiva las reglas
    // de horario. Si authenticated pudiera ejecutarla, esa bandera sería una
    // puerta para saltarse la validación.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const start = await localInstant(client, MX, DOW.sunday, '10:00')
      await client.query('savepoint direct')
      let message = ''
      try {
        await client.query(
          `select app.create_appointment_core($1, $2, $3, $4, 'grooming', $5, $6, $7, null, '[]'::jsonb, false)`,
          [TENANT_PATITAS, BRANCH_CENTRO, CUSTOMER_SOFIA, PET_ROCKY, USER_GROOMER, start, minutes(start, 60)],
        )
      } catch (e) {
        message = (e as Error).message
        await client.query('rollback to savepoint direct')
      }
      expect(message).toMatch(/permission denied/i)
    })
  })
})

describe('reschedule_appointment(): mismas reglas de fecha, sin rechazo por traslape', () => {
  async function createValid(client: PoolClient): Promise<{ id: string; start: Date }> {
    await setRole(client, 'authenticated', USER_DUENO)
    const start = await localInstant(client, MX, DOW.wednesday, '10:00')
    const created = await book(client, start, minutes(start, 60))
    if (!('id' in created)) throw new Error(created.message)
    return { id: created.id, start }
  }

  it('reprograma a otra hora válida', async () => {
    await withTransaction(async (client) => {
      const { id, start } = await createValid(client)
      const result = await reschedule(client, id, minutes(start, 120), minutes(start, 180))
      expect('id' in result).toBe(true)
    })
  })

  it('permite reprogramar encima de otra cita del mismo empleado', async () => {
    // Misma regla que al crear: el traslape es aviso, no bloqueo.
    await withTransaction(async (client) => {
      const { id, start } = await createValid(client)
      expect('id' in (await book(client, minutes(start, 120), minutes(start, 180)))).toBe(true)
      const result = await reschedule(client, id, minutes(start, 120), minutes(start, 180))
      expect('id' in result).toBe(true)
    })
  })

  it('rechaza reprogramar al pasado', async () => {
    await withTransaction(async (client) => {
      const { id } = await createValid(client)
      const past = new Date(Date.now() - 60_000)
      const result = await reschedule(client, id, past, minutes(past, 60))
      expectRejected(result, 'appointment_in_past', /ya pasó/i)
    })
  })

  it('rechaza reprogramar a un día cerrado y fuera de horario, con códigos distintos', async () => {
    await withTransaction(async (client) => {
      const { id } = await createValid(client)
      const sunday = await localInstant(client, MX, DOW.sunday, '10:00')
      expectRejected(
        await reschedule(client, id, sunday, minutes(sunday, 60)),
        'branch_closed_day',
        /cerrada ese día/i,
      )
      const late = await localInstant(client, MX, DOW.wednesday, '17:01')
      expectRejected(
        await reschedule(client, id, late, minutes(late, 60)),
        'outside_branch_hours',
        /fuera del horario/i,
      )
    })
  })

  it('rechaza un fin antes del inicio', async () => {
    await withTransaction(async (client) => {
      const { id, start } = await createValid(client)
      const result = await reschedule(client, id, start, minutes(start, -10))
      expectRejected(result, 'end_before_start', /terminar después/i)
    })
  })

  it('permite terminar justo al cierre y rechaza un minuto después, en la zona de la sucursal', async () => {
    await withTransaction(async (client) => {
      const { id } = await createValid(client)
      const ok = await localInstant(client, MX, DOW.wednesday, '17:00')
      expect('id' in (await reschedule(client, id, ok, minutes(ok, 60)))).toBe(true)
      const late = await localInstant(client, MX, DOW.wednesday, '17:01')
      expectRejected(
        await reschedule(client, id, late, minutes(late, 60)),
        'outside_branch_hours',
        /fuera del horario/i,
      )
    })
  })
})

describe('create_walk_in_appointment(): no hereda las reglas de la agenda', () => {
  it('acepta una visita que empieza ahora aunque la sucursal esté cerrada', async () => {
    // Una urgencia puede llegar el domingo o a las 10 de la noche. Si la
    // visita sin cita heredara el horario, recepción no podría registrarla.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query(`update branches set opening_hours = '{}'::jsonb where id = $1`, [
        BRANCH_CENTRO,
      ])
      await setRole(client, 'authenticated', USER_RECEPCION)
      const { rows } = await client.query(
        `select (create_walk_in_appointment($1, $2, $3, $4, 'grooming', $5, now(), now() + interval '1 hour', false, null, $6)).status as status`,
        [
          TENANT_PATITAS,
          BRANCH_CENTRO,
          CUSTOMER_SOFIA,
          PET_ROCKY,
          USER_GROOMER,
          JSON.stringify([{ service_id: SERVICE_BANO, quantity: 1 }]),
        ],
      )
      expect(rows[0].status).toBe('in_progress')
    })
  })

  it('conserva su ventana de 10 minutos de pasado', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_RECEPCION)
      await client.query('savepoint w')
      let message = ''
      try {
        await client.query(
          `select create_walk_in_appointment($1, $2, $3, $4, 'grooming', $5, now() - interval '30 minutes', now() + interval '1 hour', false, null, $6)`,
          [
            TENANT_PATITAS,
            BRANCH_CENTRO,
            CUSTOMER_SOFIA,
            PET_ROCKY,
            USER_GROOMER,
            JSON.stringify([{ service_id: SERVICE_BANO, quantity: 1 }]),
          ],
        )
      } catch (e) {
        message = (e as Error).message
        await client.query('rollback to savepoint w')
      }
      expect(message).toMatch(/empezar ahora o más tarde/i)
    })
  })
})
