// RLS de las tablas de plataforma (fase 10, migraciones platform_admins.sql y
// tenant_platform_info.sql): platform_admins, tenant_platform_info y
// platform_audit_log.
//
// La idea de fondo de todo este archivo: estas tablas guardan lo que la
// PLATAFORMA sabe de los negocios (quién administra, notas internas, estado
// de suspensión). El dueño de un negocio es el usuario más "poderoso" que
// existe dentro de su tenant, así que es el que mejor prueba si la puerta
// está bien cerrada: si ÉL no puede ver ni tocar nada de esto, nadie con
// menos privilegios puede tampoco.
//
// Cada `it` explica qué caso cubre y qué se rompería en producción si
// fallara (CLAUDE.md §9).
import { afterAll, describe, expect, it } from 'vitest'

import {
  asAnon,
  asUser,
  closePool,
  makePlatformAdmin,
  setRole,
  tryQuery,
  withTransaction,
} from './helpers'
import { TENANT_HUELLITAS, TENANT_PATITAS, USER_DUENO, USER_SUPERADMIN } from './fixtures'

afterAll(closePool)

describe('app.is_platform_admin()', () => {
  it('es true para un superadmin activo y false para un dueño de negocio', async () => {
    // Si un dueño normal recibiera true, TODAS las RPC de plataforma
    // (listar negocios, suspenderlos, cambiar notas) quedarían abiertas
    // para él: es la puerta de todo lo demás.
    await withTransaction(async (client) => {
      await makePlatformAdmin(client, USER_SUPERADMIN)

      await setRole(client, 'authenticated', USER_SUPERADMIN)
      const admin = await client.query('select app.is_platform_admin() as ok')
      expect(admin.rows[0].ok).toBe(true)

      await setRole(client, 'authenticated', USER_DUENO)
      const owner = await client.query('select app.is_platform_admin() as ok')
      expect(owner.rows[0].ok).toBe(false)
    })
  })

  it('es false para un superadmin al que ya se le quitó el acceso (deleted_at)', async () => {
    // Quitar a un superadmin es un borrado suave. Si la función ignorara
    // `deleted_at`, un ex-empleado de la plataforma conservaría acceso a
    // todos los negocios para siempre.
    await withTransaction(async (client) => {
      await makePlatformAdmin(client, USER_SUPERADMIN)
      await client.query('update platform_admins set deleted_at = now() where user_id = $1', [
        USER_SUPERADMIN,
      ])

      await setRole(client, 'authenticated', USER_SUPERADMIN)
      const { rows } = await client.query('select app.is_platform_admin() as ok')
      expect(rows[0].ok).toBe(false)
    })
  })

  it('es false para el visitante anónimo (y ni siquiera puede ejecutar la función)', async () => {
    // `anon` es el rol del link público que se manda por WhatsApp. No
    // debe poder ni preguntar "¿soy admin?": menos superficie expuesta.
    await asAnon(async (client) => {
      await expect(client.query('select app.is_platform_admin()')).rejects.toThrow(
        /permission denied/i,
      )
    })
  })
})

describe('platform_admins: quién puede leer y escribir', () => {
  it('un dueño de negocio ve CERO filas, aunque existan superadmins', async () => {
    // Si un dueño pudiera listar a los superadmins, sabría quién administra
    // la plataforma (correos, ids) — información para un ataque dirigido.
    await withTransaction(async (client) => {
      await makePlatformAdmin(client, USER_SUPERADMIN)

      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query('select id from platform_admins')
      expect(rows).toHaveLength(0)
    })
  })

  it('control: un superadmin sí ve la lista de superadmins', async () => {
    // Sin este control, el test anterior pasaría igual si la tabla
    // estuviera vacía o mal creada: prueba que "0 filas" es por RLS y no
    // porque no hubiera nada que ver.
    await withTransaction(async (client) => {
      await makePlatformAdmin(client, USER_SUPERADMIN)

      await setRole(client, 'authenticated', USER_SUPERADMIN)
      const { rows } = await client.query('select user_id from platform_admins')
      expect(rows.map((r) => r.user_id)).toContain(USER_SUPERADMIN)
    })
  })

  it('un dueño NO puede hacerse superadmin insertándose en la tabla', async () => {
    // El ataque más directo posible: `insert into platform_admins
    // (user_id) values (mi_id)`. Si funcionara, cualquier dueño se
    // convertiría en superadmin con una línea. La tabla no tiene política
    // de INSERT, así que Postgres lo rechaza.
    await asUser(USER_DUENO, async (client) => {
      await expect(
        client.query('insert into platform_admins (user_id) values ($1)', [USER_DUENO]),
      ).rejects.toThrow(/row-level security/i)
    })
  })

  it('ni siquiera un superadmin puede escribir platform_admins directo (solo por RPC/Edge Function)', async () => {
    // Agregar o quitar superadmins pasa por una vía controlada (10.5/10.8)
    // que puede, por ejemplo, impedir quitar al último. Si la tabla fuera
    // escribible directo desde PostgREST, esa vía se podría rodear.
    await withTransaction(async (client) => {
      await makePlatformAdmin(client, USER_SUPERADMIN)

      await setRole(client, 'authenticated', USER_SUPERADMIN)
      expect(
        await tryQuery(client, 'insert into platform_admins (user_id) values ($1)', [USER_DUENO]),
      ).toMatch(/row-level security/i)

      // UPDATE y DELETE sin política no dan error: la fila simplemente
      // "no es visible" para ese comando, y afectan 0 filas.
      const upd = await client.query('update platform_admins set deleted_at = now()')
      expect(upd.rowCount).toBe(0)
      const del = await client.query('delete from platform_admins')
      expect(del.rowCount).toBe(0)
    })
  })

  it('el visitante anónimo ve cero filas', async () => {
    // Regla dura de CLAUDE.md §7.3.3: `anon` no debe poder leer tablas.
    await withTransaction(async (client) => {
      await makePlatformAdmin(client, USER_SUPERADMIN)

      await setRole(client, 'anon')
      const { rows } = await client.query('select id from platform_admins')
      expect(rows).toHaveLength(0)
    })
  })
})

describe('tenant_platform_info: lo que la plataforma anota de cada negocio', () => {
  it('cada negocio nace con su fila de plataforma: plan Básico, activo, vigencia indefinida', async () => {
    // Si el trigger de `tenants` no la creara, un negocio dado de alta
    // por seed.sql, un script o el panel de Supabase no aparecería en la
    // lista del superadmin: existiría pero sería invisible para quien lo
    // administra.
    await withTransaction(async (client) => {
      await client.query("insert into tenants (id, name) values ($1, 'Negocio de prueba')", [
        'b0000000-0000-4000-8000-0000000000aa',
      ])

      const { rows } = await client.query(
        'select plan, status, plan_expires_at from tenant_platform_info where tenant_id = $1',
        ['b0000000-0000-4000-8000-0000000000aa'],
      )
      expect(rows).toEqual([{ plan: 'Básico', status: 'active', plan_expires_at: null }])
    })
  })

  it('la semilla existente ya tiene su fila (backfill): un registro por cada negocio', async () => {
    // Si la migración no rellenara los negocios que YA existían, los
    // tenants demo no saldrían en la lista de superadmin hasta el
    // próximo reset.
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `select (select count(*) from tenants)::int as tenants,
                (select count(*) from tenant_platform_info)::int as infos`,
      )
      expect(rows[0].infos).toBe(rows[0].tenants)
    })
  })

  it('el DUEÑO del negocio no ve la fila de su propio negocio (ni sus notas internas)', async () => {
    // Es la razón de existir de esta tabla aparte: lo que la plataforma
    // anota ("cliente moroso", "no renovar") no puede ser legible por el
    // negocio al que se refiere. Si estas notas vivieran en `tenants`, este
    // test sería imposible de pasar.
    await withTransaction(async (client) => {
      await client.query('update tenant_platform_info set internal_notes = $1 where tenant_id = $2', [
        'Cliente moroso, no renovar',
        TENANT_PATITAS,
      ])

      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query(
        'select internal_notes from tenant_platform_info where tenant_id = $1',
        [TENANT_PATITAS],
      )
      expect(rows).toHaveLength(0)
    })
  })

  it('la tabla `tenants` que SÍ ve el dueño no trae plan, estado ni notas', async () => {
    // Complemento del anterior: `select * from tenants` es lo que hace
    // cualquier pantalla del negocio. Si alguien "simplificara" moviendo
    // las notas de vuelta a una columna de `tenants`, este test lo
    // detecta antes de que las lea un cliente.
    await asUser(USER_DUENO, async (client) => {
      const { rows } = await client.query('select * from tenants where id = $1', [TENANT_PATITAS])
      expect(rows).toHaveLength(1)
      const columns = Object.keys(rows[0])
      expect(columns).not.toContain('internal_notes')
      expect(columns).not.toContain('status')
      expect(columns).not.toContain('plan')
    })
  })

  it('control: un superadmin sí ve las filas de todos los negocios', async () => {
    // Confirma que los "0 filas" de los tests anteriores son por RLS y
    // no porque la tabla esté vacía.
    await withTransaction(async (client) => {
      await makePlatformAdmin(client, USER_SUPERADMIN)

      await setRole(client, 'authenticated', USER_SUPERADMIN)
      const { rows } = await client.query('select tenant_id from tenant_platform_info')
      const ids = rows.map((r) => r.tenant_id)
      expect(ids).toContain(TENANT_PATITAS)
      expect(ids).toContain(TENANT_HUELLITAS)
    })
  })

  it('nadie escribe la tabla directo: ni el dueño ni el superadmin (solo por las RPC)', async () => {
    // Las RPC piden motivo al suspender y limpian el motivo al reactivar.
    // Si se pudiera hacer `update ... set status = 'closed'` directo,
    // esas reglas (y su bitácora con motivo) se podrían saltar.
    await withTransaction(async (client) => {
      await makePlatformAdmin(client, USER_SUPERADMIN)

      for (const user of [USER_DUENO, USER_SUPERADMIN]) {
        await setRole(client, 'authenticated', user)
        const upd = await client.query(
          "update tenant_platform_info set status = 'closed' where tenant_id = $1",
          [TENANT_PATITAS],
        )
        expect(upd.rowCount).toBe(0)
        const del = await client.query('delete from tenant_platform_info')
        expect(del.rowCount).toBe(0)
        expect(
          await tryQuery(client, 'insert into tenant_platform_info (tenant_id) values ($1)', [
            TENANT_PATITAS,
          ]),
        ).toMatch(/row-level security/i)
      }
    })
  })
})

describe('platform_audit_log: la bitácora de plataforma', () => {
  it('un cambio de plataforma queda registrado y el dueño NO lo ve en la bitácora de SU negocio', async () => {
    // El riesgo que motivó una bitácora separada: `audit_log` la lee el
    // dueño de cada negocio. Si las acciones del superadmin (estado,
    // notas internas) se registraran ahí, el dueño leería en `new_data`
    // exactamente lo que este archivo se esfuerza en ocultarle.
    await withTransaction(async (client) => {
      await makePlatformAdmin(client, USER_SUPERADMIN)
      await setRole(client, 'authenticated', USER_SUPERADMIN)
      await client.query(
        "select platform_update_notes($1, 'Nota que el dueño no debe ver')",
        [TENANT_PATITAS],
      )

      // El superadmin sí la ve en la bitácora de plataforma, con su id
      // como actor y la nota en new_data.
      const adminView = await client.query(
        `select actor_user_id, new_data ->> 'internal_notes' as notes
         from platform_audit_log
         where tenant_id = $1 and table_name = 'tenant_platform_info' and action = 'UPDATE'`,
        [TENANT_PATITAS],
      )
      expect(adminView.rows).toEqual([
        { actor_user_id: USER_SUPERADMIN, notes: 'Nota que el dueño no debe ver' },
      ])

      // El dueño, en cambio, ni ve la bitácora de plataforma...
      await setRole(client, 'authenticated', USER_DUENO)
      const ownerPlatform = await client.query('select id from platform_audit_log')
      expect(ownerPlatform.rows).toHaveLength(0)

      // ...ni encuentra rastro en SU bitácora normal (audit_log, que sí lee).
      const ownerAudit = await client.query(
        "select id from audit_log where table_name = 'tenant_platform_info'",
      )
      expect(ownerAudit.rows).toHaveLength(0)
    })
  })

  it('agregar un superadmin queda registrado aunque la fila no tenga tenant_id', async () => {
    // El trigger genérico app.log_change() del resto del proyecto lee
    // `new.tenant_id` y fallaría en platform_admins (no tiene esa
    // columna): sin app.log_platform_change(), dar de alta un superadmin
    // revertiría con un error críptico, o peor, se haría sin dejar rastro.
    await withTransaction(async (client) => {
      await makePlatformAdmin(client, USER_SUPERADMIN)

      await setRole(client, 'authenticated', USER_SUPERADMIN)
      // Se filtra por ESTE usuario para que el test no dependa de que la
      // bitácora esté vacía de antes.
      const { rows } = await client.query(
        `select tenant_id, action from platform_audit_log
         where table_name = 'platform_admins' and new_data ->> 'user_id' = $1`,
        [USER_SUPERADMIN],
      )
      expect(rows).toEqual([{ tenant_id: null, action: 'INSERT' }])
    })
  })

  it('es inmutable: ni el superadmin puede insertar, editar ni borrar entradas', async () => {
    // Una bitácora que su propio auditado puede reescribir no sirve. Las
    // únicas escrituras posibles son las del trigger (SECURITY DEFINER).
    await withTransaction(async (client) => {
      await makePlatformAdmin(client, USER_SUPERADMIN)

      await setRole(client, 'authenticated', USER_SUPERADMIN)
      expect(
        await tryQuery(
          client,
          `insert into platform_audit_log (table_name, record_id, action)
           values ('tenants', gen_random_uuid(), 'INSERT')`,
        ),
      ).toMatch(/row-level security/i)

      const upd = await client.query("update platform_audit_log set table_name = 'x'")
      expect(upd.rowCount).toBe(0)
      const del = await client.query('delete from platform_audit_log')
      expect(del.rowCount).toBe(0)
    })
  })

  it('el visitante anónimo no ve la bitácora', async () => {
    // Misma regla dura que las demás tablas: `anon` no lee tablas.
    await withTransaction(async (client) => {
      await makePlatformAdmin(client, USER_SUPERADMIN)

      await setRole(client, 'anon')
      const { rows } = await client.query('select id from platform_audit_log')
      expect(rows).toHaveLength(0)
    })
  })
})
