// Prueba los reportes de errores y sugerencias (migración
// 20260928130000_feedback_reports.sql, tarea #1958): la tabla feedback_reports,
// la RPC platform_list_feedback y el bucket "feedback-screenshots".
//
// Qué se protege aquí: (1) que cualquier usuario de un negocio pueda ENVIAR un
// reporte pero solo a nombre suyo y solo en su negocio; (2) que nadie del
// negocio pueda LEER reportes (ni siquiera los suyos ni los de sus compañeros);
// (3) que solo un superadmin los lea; (4) que un negocio en solo lectura no
// pueda enviar. Mismo patrón de sesión simulada vía pg que el resto de la suite.
import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import {
  asAnon,
  closePool,
  makePlatformAdmin,
  setRole,
  tryQuery,
  withTransaction,
} from './helpers'
import {
  TENANT_HUELLITAS,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_SUPERADMIN,
} from './fixtures'

afterAll(closePool)

const INSERT_REPORT = `insert into feedback_reports (tenant_id, message) values ($1, $2)`

/** Un reporte sembrado como service_role (que no pasa por RLS). Devuelve su id. */
async function seedReport(
  client: PoolClient,
  tenantId = TENANT_PATITAS,
  userId = USER_DUENO,
): Promise<string> {
  await setRole(client, 'service_role')
  const { rows } = await client.query(
    `insert into feedback_reports (tenant_id, user_id, message, screenshot_path)
     values ($1, $2, 'El botón de cobrar no responde', $3) returning id`,
    [tenantId, userId, `${tenantId}/captura.png`],
  )
  return rows[0].id
}

describe('feedback_reports: enviar', () => {
  it('un miembro (cualquier rol) puede enviar un reporte y queda a nombre suyo', async () => {
    // Todos los roles usan el sistema y todos pueden tener una queja; si solo
    // el dueño pudiera enviar, el groomer no tendría cómo avisar de un error.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_GROOMER)
      const error = await tryQuery(client, INSERT_REPORT, [TENANT_PATITAS, 'Se ve mal en el celular'])
      expect(error).toBeNull()

      await setRole(client, 'service_role')
      const { rows } = await client.query('select user_id from feedback_reports')
      expect(rows).toEqual([{ user_id: USER_GROOMER }])
    })
  })

  it('no se puede enviar a nombre de otra persona', async () => {
    // Sin la condición user_id = auth.uid(), alguien podría dejar un reporte
    // firmado por el dueño y el equipo de la plataforma contestaría a la persona equivocada.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_GROOMER)
      const error = await tryQuery(
        client,
        `insert into feedback_reports (tenant_id, user_id, message) values ($1, $2, 'x')`,
        [TENANT_PATITAS, USER_DUENO],
      )
      expect(error).toMatch(/row-level security/i)
    })
  })

  it('aislamiento: no se puede enviar a nombre de OTRO negocio', async () => {
    // Un reporte con el tenant equivocado aparecería en el panel como de una
    // empresa que no lo escribió.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const error = await tryQuery(client, INSERT_REPORT, [TENANT_HUELLITAS, 'x'])
      expect(error).toMatch(/row-level security/i)
    })
  })

  it('el visitante anónimo no puede enviar', async () => {
    // La ruta pública de mascotas no debe convertirse en un buzón abierto.
    await asAnon(async (client) => {
      const error = await tryQuery(client, INSERT_REPORT, [TENANT_PATITAS, 'x'])
      expect(error).toMatch(/permission denied|row-level security/i)
    })
  })

  it('rechaza un mensaje vacío, de solo espacios o de más de 2000 caracteres', async () => {
    // Bordes del check de la tabla: 2000 exactos sí cabe, 2001 no. Es la red
    // de seguridad si alguien salta las validaciones de la interfaz.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      expect(await tryQuery(client, INSERT_REPORT, [TENANT_PATITAS, ''])).toMatch(/check/i)
      expect(await tryQuery(client, INSERT_REPORT, [TENANT_PATITAS, '   '])).toMatch(/check/i)
      expect(await tryQuery(client, INSERT_REPORT, [TENANT_PATITAS, 'a'.repeat(2001)])).toMatch(/check/i)
      expect(await tryQuery(client, INSERT_REPORT, [TENANT_PATITAS, 'a'.repeat(2000)])).toBeNull()
    })
  })

  it('un negocio suspendido (solo lectura) no puede enviar', async () => {
    // Decisión de la tarea: la regla general de solo lectura no tiene excepciones.
    await withTransaction(async (client) => {
      await client.query(
        `update tenant_platform_info set status = 'suspended' where tenant_id = $1`,
        [TENANT_PATITAS],
      )
      await setRole(client, 'authenticated', USER_DUENO)
      const error = await tryQuery(client, INSERT_REPORT, [TENANT_PATITAS, 'x'])
      expect(error).toMatch(/solo lectura/i)
    })
  })
})

describe('feedback_reports: nadie del negocio lee ni modifica', () => {
  it('ni el autor ni un compañero ven los reportes', async () => {
    // Los reportes son para la plataforma. Sin esto un empleado leería las
    // quejas (a veces sobre sus compañeros) que otros enviaron.
    await withTransaction(async (client) => {
      await seedReport(client)
      for (const user of [USER_DUENO, USER_GROOMER]) {
        await setRole(client, 'authenticated', user)
        const { rows } = await client.query('select id from feedback_reports')
        expect(rows).toHaveLength(0)
      }
    })
  })

  it('un reporte enviado no se puede editar ni borrar', async () => {
    // Sin política de UPDATE/DELETE, Postgres afecta 0 filas: lo enviado queda
    // tal cual lo vio la plataforma.
    await withTransaction(async (client) => {
      const id = await seedReport(client)
      await setRole(client, 'authenticated', USER_DUENO)
      const upd = await client.query(`update feedback_reports set message = 'otro' where id = $1`, [id])
      const del = await client.query('delete from feedback_reports where id = $1', [id])
      expect(upd.rowCount).toBe(0)
      expect(del.rowCount).toBe(0)
    })
  })
})

describe('platform_list_feedback()', () => {
  it('el superadmin ve los reportes de todos los negocios con empresa y autor', async () => {
    // Es la única vía de lectura: si devolviera el negocio o el autor
    // equivocado, la plataforma contestaría a quien no es.
    await withTransaction(async (client) => {
      await makePlatformAdmin(client, USER_SUPERADMIN)
      await seedReport(client, TENANT_PATITAS, USER_DUENO)
      await setRole(client, 'authenticated', USER_SUPERADMIN)
      const { rows } = await client.query('select * from platform_list_feedback()')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        tenant_id: TENANT_PATITAS,
        tenant_name: 'Patitas Felices',
        user_id: USER_DUENO,
        message: 'El botón de cobrar no responde',
      })
      expect(rows[0].user_email).toBe('dueno@patitasfelices.mx')
    })
  })

  it('un dueño de negocio NO puede usarla', async () => {
    // SECURITY DEFINER salta RLS: la primera línea de la función es la única
    // puerta. Si fallara, cualquier dueño leería las quejas de todos los negocios.
    await withTransaction(async (client) => {
      await seedReport(client)
      await setRole(client, 'authenticated', USER_DUENO)
      const error = await tryQuery(client, 'select * from platform_list_feedback()')
      expect(error).toMatch(/No tienes permiso/)
    })
  })

  it('el visitante anónimo NO puede usarla', async () => {
    // A anon se le revoca EXECUTE: ni siquiera llega a la validación interna.
    await asAnon(async (client) => {
      const error = await tryQuery(client, 'select * from platform_list_feedback()')
      expect(error).toMatch(/permission denied/i)
    })
  })
})

describe('bucket feedback-screenshots', () => {
  const INSERT_OBJECT = `insert into storage.objects (bucket_id, name) values ('feedback-screenshots', $1)`

  it('un miembro sube una captura bajo la carpeta de su negocio', async () => {
    // Caso de control: si esto fallara, el envío con captura nunca funcionaría.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_GROOMER)
      expect(await tryQuery(client, INSERT_OBJECT, [`${TENANT_PATITAS}/abc.png`])).toBeNull()
    })
  })

  it('aislamiento: no puede subir bajo la carpeta de OTRO negocio', async () => {
    // La ruta ES la seguridad (primer segmento = tenant_id): sin esta política
    // alguien llenaría el almacenamiento a nombre de otra empresa.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      expect(await tryQuery(client, INSERT_OBJECT, [`${TENANT_HUELLITAS}/abc.png`])).toMatch(
        /row-level security/i,
      )
    })
  })

  it('un negocio suspendido no puede subir capturas', async () => {
    // El trigger de la tabla no cubre Storage; sin la revisión propia de la
    // política, un negocio en solo lectura dejaría archivos huérfanos.
    await withTransaction(async (client) => {
      await client.query(
        `update tenant_platform_info set status = 'suspended' where tenant_id = $1`,
        [TENANT_PATITAS],
      )
      await setRole(client, 'authenticated', USER_DUENO)
      expect(await tryQuery(client, INSERT_OBJECT, [`${TENANT_PATITAS}/abc.png`])).toMatch(
        /row-level security/i,
      )
    })
  })

  it('los miembros no leen capturas, el superadmin sí', async () => {
    // Las capturas pueden mostrar datos de clientes: solo las ve la plataforma.
    await withTransaction(async (client) => {
      await makePlatformAdmin(client, USER_SUPERADMIN)
      await setRole(client, 'service_role')
      await client.query(INSERT_OBJECT, [`${TENANT_PATITAS}/abc.png`])

      await setRole(client, 'authenticated', USER_DUENO)
      const asMember = await client.query(
        `select name from storage.objects where bucket_id = 'feedback-screenshots'`,
      )
      expect(asMember.rows).toHaveLength(0)

      await setRole(client, 'authenticated', USER_SUPERADMIN)
      const asAdmin = await client.query(
        `select name from storage.objects where bucket_id = 'feedback-screenshots'`,
      )
      expect(asAdmin.rows).toHaveLength(1)
    })
  })
})
