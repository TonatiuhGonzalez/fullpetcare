// Prueba el bloque de "estado de plataforma" de supabase/seed/demo_reset.sql
// (el que oculta empresas dadas de alta durante una demo).
//
// El script se ejecuta ENTERO, tal cual lo corre `npm run demo:reset`, pero
// dentro de una transacción de prueba: al terminar el test se hace rollback y
// la base queda exactamente como estaba. Así se prueba el archivo real, no
// una copia de su lógica.
//
// Por qué importa: este script corre contra producción. Si ocultara una
// empresa que no debe (un cliente real), esa empresa desaparecería de la
// lista del superadmin en plena operación.
import { readFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'

import { closePool, withTransaction } from './helpers'
import { TENANT_HUELLITAS, TENANT_MIMOS, TENANT_PATITAS } from './fixtures'

afterAll(closePool)

const DEMO_RESET_SQL = readFileSync(new URL('../seed/demo_reset.sql', import.meta.url), 'utf8')

describe('demo_reset.sql — empresas fuera de la semilla', () => {
  it('oculta las empresas marcadas is_demo y NO toca las que no lo están', async () => {
    // Caso central de la marca is_demo: una empresa de demostración (creada
    // en una presentación) se oculta; un cliente real, sin marca, se queda
    // visible. Si el reset volviera a ocultar todo lo que no es semilla, el
    // cliente real desaparecería.
    await withTransaction(async (client) => {
      const demo = await client.query("insert into tenants (name) values ('Empresa de una demo') returning id")
      const real = await client.query("insert into tenants (name) values ('Cliente Real SA') returning id")
      await client.query('update tenant_platform_info set is_demo = true where tenant_id = $1', [demo.rows[0].id])

      await client.query(DEMO_RESET_SQL)

      const rows = await client.query(
        'select id, deleted_at is not null as is_hidden from tenants where id = any($1)',
        [[demo.rows[0].id, real.rows[0].id]],
      )
      const hiddenById = Object.fromEntries(rows.rows.map((r) => [r.id, r.is_hidden]))
      expect(hiddenById[demo.rows[0].id]).toBe(true)
      expect(hiddenById[real.rows[0].id]).toBe(false)
    })
  })

  it('nunca oculta las 3 empresas de la semilla', async () => {
    // Borde: aunque una empresa de la semilla tuviera is_demo = true (de
    // hecho lo tienen), el reset las excluye por id. Sin esa exclusión, el
    // primer reset dejaría la demo sin ninguno de sus negocios.
    await withTransaction(async (client) => {
      await client.query(DEMO_RESET_SQL)

      const rows = await client.query(
        'select count(*)::int as n from tenants where id = any($1) and deleted_at is null',
        [[TENANT_PATITAS, TENANT_HUELLITAS, TENANT_MIMOS]],
      )
      expect(rows.rows[0].n).toBe(3)
    })
  })

  it('una empresa sin marcar sobrevive aunque el reset se corra dos veces', async () => {
    // Borde: el reset es repetible (se corre antes de cada demo). La segunda
    // corrida no debe "descubrir" a un cliente real que la primera respetó.
    await withTransaction(async (client) => {
      const real = await client.query("insert into tenants (name) values ('Cliente Real SA') returning id")

      await client.query(DEMO_RESET_SQL)
      await client.query(DEMO_RESET_SQL)

      const rows = await client.query('select deleted_at from tenants where id = $1', [real.rows[0].id])
      expect(rows.rows[0].deleted_at).toBeNull()
    })
  })
})
