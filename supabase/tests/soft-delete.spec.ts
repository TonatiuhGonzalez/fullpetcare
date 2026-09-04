// Prueba app.prevent_hard_delete() (CLAUDE.md §8.5). Como las tablas
// reales de expediente clínico (grooming_records, medical_records,
// vaccinations) todavía no existen — llegan en fases posteriores — este
// test crea una tabla temporal DENTRO de la misma transacción que se
// revierte al final (withTransaction), le engancha el trigger, y prueba
// el mecanismo directamente. Cuando el expediente real exista, sus
// propias migraciones enganchan este mismo trigger y quedan cubiertas
// por el mismo mecanismo — no hace falta repetir este test por tabla.
import { afterAll, describe, expect, it } from 'vitest'

import { closePool, setRole, withTransaction } from './helpers'

afterAll(closePool)

describe('app.prevent_hard_delete()', () => {
  it('un DELETE directo falla incluso con service_role', async () => {
    // Este es el caso que de verdad importa: service_role tiene el
    // atributo BYPASSRLS, así que "ninguna política de DELETE" (el
    // mecanismo que protege al resto de las tablas de negocio) no lo
    // detiene a él. Si este trigger no existiera, cualquier script de
    // administración con la service_role key podría borrar un
    // expediente clínico de verdad. Un trigger no distingue roles: se
    // ejecuta para cualquiera, y eso es justo lo que se prueba aquí.
    await withTransaction(async (client) => {
      await client.query(`
        create table temp_expediente (
          id uuid primary key default gen_random_uuid(),
          nota text
        )
      `)
      await client.query(`
        create trigger temp_expediente_no_delete
          before delete on temp_expediente
          for each row execute function app.prevent_hard_delete()
      `)

      const { rows } = await client.query(
        "insert into temp_expediente (nota) values ('consulta de rutina') returning id",
      )
      const id = rows[0].id

      // Cambia de rol SIN salir de la transacción actual — la tabla
      // temporal solo existe aquí adentro, así que no sirve usar
      // asServiceRole() de helpers.ts (esa abre su propia transacción).
      await setRole(client, 'service_role')

      await expect(
        client.query('delete from temp_expediente where id = $1', [id]),
      ).rejects.toThrow(/no se puede borrar directamente/i)
    })
  })
})
