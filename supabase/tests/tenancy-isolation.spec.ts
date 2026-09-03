// EL test más importante del repositorio (CLAUDE.md §7, PLAN.md §1.3).
//
// Todo lo demás en el proyecto puede tener bugs de UI, de estilo, de
// nombres — molestos, pero recuperables. Que un negocio vea los datos de
// otro no es recuperable: es una fuga de información de clientes reales.
// Por eso este archivo no prueba "¿el código de la app filtra bien?" —
// prueba directamente contra Postgres, con el mecanismo real de RLS
// (ver supabase/tests/helpers.ts), que la respuesta sea NO pase lo que
// pase del lado de la aplicación.
import { afterAll, describe, expect, it } from 'vitest'

import { asAnon, closePool, setRole, withTransaction, asUser } from './helpers'
import {
  BRANCH_CENTRO,
  BRANCH_DEL_VALLE,
  BRANCH_TIJUANA,
  TENANT_HUELLITAS,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
} from './fixtures'

afterAll(closePool)

describe('Aislamiento entre tenants', () => {
  it('un usuario del tenant A solo ve las sucursales de su propio tenant', async () => {
    // Caso base: sin ningún filtro explícito, "el dueño de Patitas
    // Felices" debe ver exactamente sus 2 sucursales (Centro y Del
    // Valle) — nunca la de Huellitas Spa (Tijuana), que es de otro
    // tenant. Si este caso fallara, cualquier pantalla de la app que
    // liste sucursales, empleados o citas sin querer mostraría negocios
    // ajenos.
    const { rows } = await asUser(USER_DUENO, (c) =>
      c.query('select id, tenant_id from branches order by name'),
    )

    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.id).sort()).toEqual([BRANCH_CENTRO, BRANCH_DEL_VALLE].sort())
    for (const row of rows) {
      expect(row.tenant_id).toBe(TENANT_PATITAS)
    }
  })

  it('pedir el tenant ajeno EXPLÍCITAMENTE en el WHERE tampoco funciona', async () => {
    // Este es el caso que de verdad importa. No es que el usuario nunca
    // vaya a pedir datos de otro tenant "sin querer" — es que aunque el
    // frontend tuviera un bug (o alguien manipulara la consulta desde la
    // consola del navegador) y pidiera el tenant ajeno A PROPÓSITO,
    // Postgres igual debe devolver cero filas. Esta es la prueba de que
    // el aislamiento no depende de que el código de arriba se porte bien
    // (CLAUDE.md §7: "no confíes en que el código de la app filtre
    // bien").
    const { rows } = await asUser(USER_DUENO, (c) =>
      c.query('select id from branches where tenant_id = $1', [TENANT_HUELLITAS]),
    )

    expect(rows).toHaveLength(0)
  })

  it('pedir por id una fila de otro tenant da 0 filas, no un error ni la fila', async () => {
    // Importa la FORMA del fallo: RLS no lanza una excepción de "acceso
    // denegado" que delate que la fila existe — la vuelve invisible, como
    // si no existiera. Es el comportamiento correcto para no filtrar ni
    // siquiera la existencia de datos de otro negocio.
    const { rows } = await asUser(USER_DUENO, (c) =>
      c.query('select id from branches where id = $1', [BRANCH_TIJUANA]),
    )

    expect(rows).toHaveLength(0)
  })

  it('el aislamiento sigue a la membresía, no a la persona: reasignar el tenant cambia lo que se ve', async () => {
    // Prueba que la regla no está "harcodeada" para Patitas Felices en
    // particular: se reasigna al groomer sembrado a Huellitas Spa (con
    // service_role, que sí puede escribir memberships) y se confirma que,
    // ahora, ve la sucursal de Huellitas y NINGUNA de Patitas Felices.
    // Todo dentro de una sola transacción que se revierte al final —
    // nunca se guarda de verdad.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query('update memberships set tenant_id = $1 where user_id = $2', [
        TENANT_HUELLITAS,
        USER_GROOMER,
      ])

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows } = await client.query(
        'select id, tenant_id from branches order by name',
      )

      expect(rows).toHaveLength(1)
      expect(rows[0].tenant_id).toBe(TENANT_HUELLITAS)
      expect(rows[0].id).toBe(BRANCH_TIJUANA)
    })
  })
})

describe('Membresía inactiva', () => {
  it('un usuario con is_active = false no ve nada de ningún tenant', async () => {
    // No es solo "no pertenecer" — es "haber pertenecido y que le
    // revocaron el acceso" (un empleado que ya no trabaja ahí). Esta es
    // la decisión de diseño de CLAUDE.md §7.2 (memberships como fuente de
    // verdad en vez de un claim en el JWT): el acceso se corta al
    // instante, sin esperar a que caduque una sesión.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query('update memberships set is_active = false where user_id = $1', [
        USER_GROOMER,
      ])

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows } = await client.query('select id from branches')

      expect(rows).toHaveLength(0)
    })
  })
})

describe('El rol anon no lee ninguna tabla de tenencia', () => {
  it('anon no ve ningún tenant', async () => {
    const { rows } = await asAnon((c) => c.query('select id from tenants'))
    expect(rows).toHaveLength(0)
  })

  it('anon no ve ninguna sucursal', async () => {
    const { rows } = await asAnon((c) => c.query('select id from branches'))
    expect(rows).toHaveLength(0)
  })

  it('anon no ve ninguna membresía', async () => {
    const { rows } = await asAnon((c) => c.query('select id from memberships'))
    expect(rows).toHaveLength(0)
  })

  it('anon no ve ningún profile', async () => {
    const { rows } = await asAnon((c) => c.query('select id from profiles'))
    expect(rows).toHaveLength(0)
  })
})
