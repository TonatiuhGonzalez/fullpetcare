// Prueba las RPC de soporte de la fase 10 (migración
// 20260924120600_platform_admin_support.sql): gestión de superadmins,
// registro de eventos en la bitácora y cierre de sesiones.
//
// La más delicada es revoke_user_sessions(): NO revalida a quien llama (la
// invoca la Edge Function con la llave secreta), así que su única defensa
// es el permiso EXECUTE. Si ese permiso se abriera por accidente, cualquier
// usuario podría cerrar la sesión de cualquier otro con una llamada HTTP.
import { afterAll, describe, expect, it } from 'vitest'

import {
  asAnon,
  closePool,
  insertAuthUser,
  makePlatformAdmin,
  setRole,
  tryQuery,
  withTransaction,
} from './helpers'
import {
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_SUPERADMIN,
  USER_SUPERADMIN_2,
  USER_SUPERADMIN_DEMO,
} from './fixtures'

afterAll(closePool)

describe('revoke_user_sessions(): solo service_role', () => {
  it('cierra todas las sesiones del usuario (y sus refresh tokens) y no toca las de otros', async () => {
    // Es lo que hace que restablecer una contraseña saque de verdad a quien
    // ya estaba dentro con la contraseña vieja. Si los refresh tokens no
    // cayeran junto con la sesión, esa persona podría renovar su acceso
    // indefinidamente.
    await withTransaction(async (client) => {
      await client.query(
        "insert into auth.sessions (id, user_id) values ('a0000000-0000-4000-8000-0000000000e1', $1), ('a0000000-0000-4000-8000-0000000000e2', $1), ('a0000000-0000-4000-8000-0000000000e3', $2)",
        [USER_DUENO, USER_GROOMER],
      )
      await client.query(
        "insert into auth.refresh_tokens (token, user_id, session_id) values ('t1', $1::text, 'a0000000-0000-4000-8000-0000000000e1'), ('t3', $2::text, 'a0000000-0000-4000-8000-0000000000e3')",
        [USER_DUENO, USER_GROOMER],
      )

      await setRole(client, 'service_role')
      const { rows } = await client.query('select revoke_user_sessions($1) as deleted', [USER_DUENO])
      expect(rows[0].deleted).toBe(2)

      await client.query('reset role')
      const remaining = await client.query(
        'select user_id from auth.sessions where id in ($1, $2, $3)',
        [
          'a0000000-0000-4000-8000-0000000000e1',
          'a0000000-0000-4000-8000-0000000000e2',
          'a0000000-0000-4000-8000-0000000000e3',
        ],
      )
      expect(remaining.rows).toEqual([{ user_id: USER_GROOMER }])
      const tokens = await client.query("select token from auth.refresh_tokens where token in ('t1', 't3')")
      expect(tokens.rows).toEqual([{ token: 't3' }])
    })
  })

  it('un usuario autenticado, ni siquiera un superadmin, puede ejecutarla', async () => {
    // Esta función no pregunta "¿quién eres?": confía en que solo la llama
    // la Edge Function. Que `authenticated` tenga EXECUTE sería una
    // puerta abierta para cerrarle la sesión a cualquiera.
    await withTransaction(async (client) => {
      await makePlatformAdmin(client, USER_SUPERADMIN)

      for (const user of [USER_DUENO, USER_SUPERADMIN]) {
        await setRole(client, 'authenticated', user)
        expect(await tryQuery(client, 'select revoke_user_sessions($1)', [USER_GROOMER])).toMatch(
          /permission denied/i,
        )
      }
    })
  })

  it('el visitante anónimo tampoco', async () => {
    await asAnon(async (client) => {
      expect(await tryQuery(client, 'select revoke_user_sessions($1)', [USER_GROOMER])).toMatch(
        /permission denied/i,
      )
    })
  })
})

const NON_ADMIN_CALLS: [string, string, unknown[]][] = [
  ['platform_list_admins', 'select * from platform_list_admins()', []],
  ['platform_add_admin', 'select * from platform_add_admin($1)', [USER_GROOMER]],
  ['platform_remove_admin', 'select * from platform_remove_admin($1)', [USER_SUPERADMIN]],
  [
    'platform_log_event',
    "select platform_log_event($1, 'password_reset', $2, '{}'::jsonb)",
    [TENANT_PATITAS, USER_DUENO],
  ],
]

describe('RPC de superadmins y eventos: rechazan a quien no es superadmin', () => {
  it.each(NON_ADMIN_CALLS)('%s: un dueño de negocio recibe "sin permiso"', async (_n, sql, params) => {
    // Sin este chequeo, un dueño podría hacerse superadmin él mismo
    // llamando platform_add_admin, o quitarle el acceso a todos los demás.
    await withTransaction(async (client) => {
      await makePlatformAdmin(client, USER_SUPERADMIN)
      await setRole(client, 'authenticated', USER_DUENO)
      expect(await tryQuery(client, sql, params)).toMatch(/No tienes permiso/i)
    })
  })

  it.each(NON_ADMIN_CALLS)('%s: el visitante anónimo no puede ejecutarla', async (_n, sql, params) => {
    await asAnon(async (client) => {
      expect(await tryQuery(client, sql, params)).toMatch(/permission denied/i)
    })
  })
})

describe('platform_list_admins()', () => {
  it('lista solo los superadmins activos, con su correo', async () => {
    // Un superadmin quitado no debe seguir apareciendo como si tuviera
    // acceso: la pantalla de superadmins es la que se usa para auditar
    // quién puede entrar.
    await withTransaction(async (client) => {
      await makePlatformAdmin(client, USER_SUPERADMIN)
      await makePlatformAdmin(client, USER_SUPERADMIN_2)
      await client.query('update platform_admins set deleted_at = now() where user_id = $1', [
        USER_SUPERADMIN_2,
      ])

      await setRole(client, 'authenticated', USER_SUPERADMIN)
      const { rows } = await client.query('select user_id, email from platform_list_admins()')
      // La semilla ya trae un superadmin (USER_SUPERADMIN_DEMO), así que no
      // se compara la lista completa: se comprueba quién SÍ y quién NO.
      const ids = rows.map((r) => r.user_id)
      expect(ids).toContain(USER_SUPERADMIN)
      expect(ids).toContain(USER_SUPERADMIN_DEMO)
      expect(ids).not.toContain(USER_SUPERADMIN_2) // el que se quitó
      expect(rows.find((r) => r.user_id === USER_SUPERADMIN)?.email).toBe(
        `${USER_SUPERADMIN}@superadmin.test`,
      )
    })
  })
})

describe('platform_add_admin()', () => {
  it('agrega a un usuario existente, y ese usuario ya es superadmin al instante', async () => {
    await withTransaction(async (client) => {
      await makePlatformAdmin(client, USER_SUPERADMIN)
      await insertAuthUser(client, USER_SUPERADMIN_2, 'segundo@superadmin.test')

      await setRole(client, 'authenticated', USER_SUPERADMIN)
      await client.query('select platform_add_admin($1)', [USER_SUPERADMIN_2])

      await setRole(client, 'authenticated', USER_SUPERADMIN_2)
      const { rows } = await client.query('select app.is_platform_admin() as ok')
      expect(rows[0].ok).toBe(true)
    })
  })

  it('rechaza a quien ya es superadmin y a un usuario que no existe', async () => {
    // Un mensaje claro en cada caso: sin ellos la UI mostraría un error
    // de restricción de la base de datos.
    await withTransaction(async (client) => {
      await makePlatformAdmin(client, USER_SUPERADMIN)
      await setRole(client, 'authenticated', USER_SUPERADMIN)

      expect(await tryQuery(client, 'select platform_add_admin($1)', [USER_SUPERADMIN])).toMatch(
        /ya es superadmin/i,
      )
      expect(
        await tryQuery(client, 'select platform_add_admin($1)', [
          'ffffffff-ffff-4fff-8fff-ffffffffffff',
        ]),
      ).toMatch(/usuario no existe/i)
    })
  })

  it('reactiva a un superadmin que se había quitado, sin chocar con el unique de user_id', async () => {
    // `platform_admins.user_id` es unique: insertar otra fila para alguien
    // que ya tuvo una fallaría con un error de restricción. La RPC debe
    // reactivar la fila existente.
    await withTransaction(async (client) => {
      await makePlatformAdmin(client, USER_SUPERADMIN)
      await makePlatformAdmin(client, USER_SUPERADMIN_2)
      await client.query('update platform_admins set deleted_at = now() where user_id = $1', [
        USER_SUPERADMIN_2,
      ])

      await setRole(client, 'authenticated', USER_SUPERADMIN)
      await client.query('select platform_add_admin($1)', [USER_SUPERADMIN_2])

      await setRole(client, 'authenticated', USER_SUPERADMIN_2)
      const { rows } = await client.query('select app.is_platform_admin() as ok')
      expect(rows[0].ok).toBe(true)
    })
  })
})

describe('platform_remove_admin()', () => {
  it('NO deja quitar al único superadmin', async () => {
    // Sin superadmins nadie puede volver a administrar la plataforma desde
    // la interfaz; el único remedio sería un script con service_role.
    await withTransaction(async (client) => {
      await makePlatformAdmin(client, USER_SUPERADMIN)
      // La semilla trae otro superadmin: se quita (dentro de esta
      // transacción, que se revierte) para que USER_SUPERADMIN quede solo.
      await client.query('update platform_admins set deleted_at = now() where user_id <> $1', [
        USER_SUPERADMIN,
      ])
      await setRole(client, 'authenticated', USER_SUPERADMIN)

      expect(await tryQuery(client, 'select platform_remove_admin($1)', [USER_SUPERADMIN])).toMatch(
        /único superadmin/i,
      )
      const { rows } = await client.query('select app.is_platform_admin() as ok')
      expect(rows[0].ok).toBe(true)
    })
  })

  it('con dos superadmins sí se puede quitar uno, y pierde el acceso al instante', async () => {
    await withTransaction(async (client) => {
      await makePlatformAdmin(client, USER_SUPERADMIN)
      await makePlatformAdmin(client, USER_SUPERADMIN_2)

      await setRole(client, 'authenticated', USER_SUPERADMIN)
      await client.query('select platform_remove_admin($1)', [USER_SUPERADMIN_2])

      await setRole(client, 'authenticated', USER_SUPERADMIN_2)
      const { rows } = await client.query('select app.is_platform_admin() as ok')
      expect(rows[0].ok).toBe(false)
      expect(await tryQuery(client, 'select * from platform_list_tenants()')).toMatch(
        /No tienes permiso/i,
      )
    })
  })

  it('un superadmin puede quitarse a sí mismo mientras quede otro', async () => {
    // Decisión documentada en la migración: la regla que protege la
    // plataforma es "nunca cero superadmins", no "nadie se quita a sí mismo".
    await withTransaction(async (client) => {
      await makePlatformAdmin(client, USER_SUPERADMIN)
      await makePlatformAdmin(client, USER_SUPERADMIN_2)

      await setRole(client, 'authenticated', USER_SUPERADMIN)
      expect(await tryQuery(client, 'select platform_remove_admin($1)', [USER_SUPERADMIN])).toBeNull()
    })
  })

  it('rechaza quitar a alguien que no es superadmin', async () => {
    await withTransaction(async (client) => {
      await makePlatformAdmin(client, USER_SUPERADMIN)
      await makePlatformAdmin(client, USER_SUPERADMIN_2)
      await setRole(client, 'authenticated', USER_SUPERADMIN)

      expect(await tryQuery(client, 'select platform_remove_admin($1)', [USER_DUENO])).toMatch(
        /no es superadmin/i,
      )
    })
  })

  it('agregar y quitar quedan en la bitácora con el superadmin como actor', async () => {
    // "¿Quién le dio acceso total a la plataforma a esta persona?" es la
    // pregunta más seria de auditoría que existe en el sistema.
    await withTransaction(async (client) => {
      await makePlatformAdmin(client, USER_SUPERADMIN)
      await insertAuthUser(client, USER_SUPERADMIN_2, 'segundo@superadmin.test')

      await setRole(client, 'authenticated', USER_SUPERADMIN)
      await client.query('select platform_add_admin($1)', [USER_SUPERADMIN_2])
      await client.query('select platform_remove_admin($1)', [USER_SUPERADMIN_2])

      const { rows } = await client.query(
        `select action, actor_user_id from platform_audit_log
         where table_name = 'platform_admins' and actor_user_id is not null order by changed_at`,
      )
      expect(rows).toEqual([
        { action: 'INSERT', actor_user_id: USER_SUPERADMIN },
        { action: 'UPDATE', actor_user_id: USER_SUPERADMIN },
      ])
    })
  })
})

describe('platform_log_event()', () => {
  it('registra el evento con el superadmin como actor, y el dueño no lo ve', async () => {
    // Restablecer una contraseña no cambia ninguna tabla nuestra, así que
    // ningún trigger la vería: sin esta función no quedaría rastro de la
    // acción más sensible del panel.
    await withTransaction(async (client) => {
      await makePlatformAdmin(client, USER_SUPERADMIN)
      await setRole(client, 'authenticated', USER_SUPERADMIN)
      await client.query(
        "select platform_log_event($1, ' password_reset ', $2, '{\"owner_email\":\"dueno@x.mx\"}'::jsonb)",
        [TENANT_PATITAS, USER_DUENO],
      )

      const { rows } = await client.query(
        `select event, actor_user_id, record_id, new_data ->> 'owner_email' as email
         from platform_audit_log where event is not null`,
      )
      expect(rows).toEqual([
        { event: 'password_reset', actor_user_id: USER_SUPERADMIN, record_id: USER_DUENO, email: 'dueno@x.mx' },
      ])

      await setRole(client, 'authenticated', USER_DUENO)
      const owner = await client.query('select id from platform_audit_log')
      expect(owner.rows).toHaveLength(0)
      const ownerAudit = await client.query("select id from audit_log where table_name = 'auth.users'")
      expect(ownerAudit.rows).toHaveLength(0)
    })
  })

  it('rechaza un nombre de evento en blanco', async () => {
    // Una entrada de bitácora sin nombre de evento no dice qué pasó.
    await withTransaction(async (client) => {
      await makePlatformAdmin(client, USER_SUPERADMIN)
      await setRole(client, 'authenticated', USER_SUPERADMIN)
      expect(
        await tryQuery(client, "select platform_log_event($1, '   ', $2, '{}'::jsonb)", [
          TENANT_PATITAS,
          USER_DUENO,
        ]),
      ).toMatch(/Indica el evento/i)
    })
  })
})
