// Prueba las RPC de plataforma (migración 20260924120400_platform_rpcs.sql,
// fase 10): platform_list_tenants, platform_tenant_metrics,
// platform_set_tenant_status, platform_update_notes y
// platform_create_tenant.
//
// Estas funciones son SECURITY DEFINER: se saltan RLS. Eso las hace la
// pieza más delicada de la fase — la única protección real es la primera
// línea de cada una (`if not app.is_platform_admin() then raise`). Por eso
// el primer bloque de tests es el más importante del archivo: prueba esa
// línea en las cinco funciones, contra los tres tipos de intruso.
//
// Mismo patrón que create-employee-membership-rpc.spec.ts: sesión
// simulada vía pg y SAVEPOINT (helpers.ts#tryQuery) para poder seguir
// consultando la misma transacción después de un error esperado.
import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

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
  BRANCH_CENTRO,
  CUSTOMER_SOFIA,
  NONEXISTENT_UUID,
  PET_ROCKY,
  TENANT_HUELLITAS,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_NUEVO_DUENO,
  USER_SUPERADMIN,
} from './fixtures'

afterAll(closePool)

/** Deja la transacción lista y con la sesión simulada como superadmin. */
async function asSuperadmin(client: PoolClient): Promise<void> {
  await makePlatformAdmin(client, USER_SUPERADMIN)
  await setRole(client, 'authenticated', USER_SUPERADMIN)
}

// Las cinco llamadas, con argumentos válidos: si una fallara por argumentos
// malos en vez de por permisos, el test pasaría por la razón equivocada.
const ALL_RPC_CALLS: [string, string, unknown[]][] = [
  ['platform_list_tenants', 'select * from platform_list_tenants()', []],
  ['platform_tenant_metrics', 'select * from platform_tenant_metrics($1)', [TENANT_PATITAS]],
  [
    'platform_set_tenant_status',
    "select * from platform_set_tenant_status($1, 'suspended', 'prueba')",
    [TENANT_PATITAS],
  ],
  ['platform_update_notes', "select * from platform_update_notes($1, 'x')", [TENANT_PATITAS]],
  [
    'platform_create_tenant',
    "select * from platform_create_tenant($1, 'Intruso SA', 'Matriz', 'Intruso', null)",
    [USER_DUENO],
  ],
]

describe('las 5 RPC de plataforma rechazan a quien no es superadmin', () => {
  it.each(ALL_RPC_CALLS)(
    '%s: un dueño de negocio recibe "sin permiso" (y no se ejecuta nada)',
    async (_name, sql, params) => {
      // Si una sola de estas funciones olvidara su primera línea, el
      // dueño de CUALQUIER negocio podría listar, suspender o editar los
      // demás negocios de la plataforma con una llamada HTTP normal.
      await withTransaction(async (client) => {
        await setRole(client, 'authenticated', USER_DUENO)
        expect(await tryQuery(client, sql, params)).toMatch(/No tienes permiso/i)
      })
    },
  )

  it.each(ALL_RPC_CALLS)(
    '%s: un superadmin al que ya se le quitó el acceso también es rechazado',
    async (_name, sql, params) => {
      // Un ex-superadmin (deleted_at) con su sesión todavía abierta no
      // debe conservar nada: el acceso se revoca al instante, sin esperar
      // a que caduque su token (mismo criterio que CLAUDE.md §7.2).
      await withTransaction(async (client) => {
        await makePlatformAdmin(client, USER_SUPERADMIN)
        await client.query('update platform_admins set deleted_at = now() where user_id = $1', [
          USER_SUPERADMIN,
        ])
        await setRole(client, 'authenticated', USER_SUPERADMIN)
        expect(await tryQuery(client, sql, params)).toMatch(/No tienes permiso/i)
      })
    },
  )

  it.each(ALL_RPC_CALLS)(
    '%s: el visitante anónimo ni siquiera puede ejecutarla',
    async (_name, sql, params) => {
      // `anon` es el rol del link público sin login. Además del chequeo
      // interno, el permiso EXECUTE está revocado: dos capas.
      await asAnon(async (client) => {
        expect(await tryQuery(client, sql, params)).toMatch(/permission denied/i)
      })
    },
  )
})

describe('platform_list_tenants()', () => {
  it('lista los negocios con plan, estado y los datos del dueño (nombre, correo)', async () => {
    // Es la tabla principal del panel. El correo vive en auth.users, que
    // el frontend no puede leer: si la RPC no lo uniera, la pantalla
    // mostraría dueños sin correo y no se podría reenviar acceso.
    await withTransaction(async (client) => {
      await asSuperadmin(client)

      const { rows } = await client.query(
        'select name, plan, status, plan_expires_at, owner_name, owner_email from platform_list_tenants() where tenant_id = $1',
        [TENANT_PATITAS],
      )
      expect(rows).toEqual([
        {
          name: 'Patitas Felices',
          plan: 'Básico',
          status: 'active',
          plan_expires_at: null,
          owner_name: 'Fernanda Ruiz Gómez',
          owner_email: 'dueno@patitasfelices.mx',
        },
      ])
    })
  })

  it('un negocio SIN dueño aparece igual, con el dueño vacío', async () => {
    // Un alta a medias o un dato corrupto no debe hacer que la empresa
    // desaparezca de la lista: justo ese es el caso que el superadmin
    // necesita ver para arreglarlo. Un JOIN normal (en vez de LEFT JOIN) la
    // ocultaría en silencio.
    await withTransaction(async (client) => {
      await client.query("insert into tenants (id, name) values ($1, 'Sin dueño SA')", [
        NONEXISTENT_UUID,
      ])
      await asSuperadmin(client)

      const { rows } = await client.query(
        'select name, owner_name, owner_email from platform_list_tenants() where tenant_id = $1',
        [NONEXISTENT_UUID],
      )
      expect(rows).toEqual([{ name: 'Sin dueño SA', owner_name: null, owner_email: null }])
    })
  })

  it('un dueño con la membresía desactivada ya no cuenta como dueño', async () => {
    // Si se desactiva al dueño (is_active = false), mostrarlo en el panel
    // como "el dueño" mandaría al superadmin a resetear la contraseña de
    // alguien que ya no tiene acceso a ese negocio.
    await withTransaction(async (client) => {
      await client.query(
        'update memberships set is_active = false where tenant_id = $1 and user_id = $2',
        [TENANT_PATITAS, USER_DUENO],
      )
      await asSuperadmin(client)

      const { rows } = await client.query(
        'select owner_name from platform_list_tenants() where tenant_id = $1',
        [TENANT_PATITAS],
      )
      expect(rows).toEqual([{ owner_name: null }])
    })
  })

  it('un negocio borrado suavemente (deleted_at) no aparece', async () => {
    // Regla de borrado suave (CLAUDE.md §8.5): lo "borrado" no se lista.
    await withTransaction(async (client) => {
      await client.query('update tenants set deleted_at = now() where id = $1', [TENANT_HUELLITAS])
      await asSuperadmin(client)

      const { rows } = await client.query(
        'select tenant_id from platform_list_tenants() where tenant_id = $1',
        [TENANT_HUELLITAS],
      )
      expect(rows).toHaveLength(0)
    })
  })
})

describe('platform_tenant_metrics()', () => {
  it('devuelve SOLO conteos: ninguna columna con datos de clientes ni de expediente', async () => {
    // Es la decisión "el superadmin ve datos de la empresa, nunca datos de
    // negocio", convertida en test. Si alguien agregara una columna
    // (nombre del último cliente, una nota) esta lista cambia y el test
    // obliga a discutirlo antes de que llegue a producción.
    await withTransaction(async (client) => {
      await asSuperadmin(client)

      const { rows } = await client.query('select * from platform_tenant_metrics($1)', [
        TENANT_PATITAS,
      ])
      expect(rows).toHaveLength(1)
      expect(Object.keys(rows[0])).toEqual([
        'branches_count',
        'active_employees_count',
        'customers_count',
        'pets_count',
        'appointments_this_month_count',
        'last_access_at',
      ])
    })
  })

  it('los conteos coinciden con las tablas, aunque el superadmin no pertenezca al negocio', async () => {
    // El superadmin no tiene membresía en ningún negocio, así que por RLS
    // normal vería 0 clientes en todos. Este test prueba que la RPC de
    // verdad cuenta con permisos propios y que el número es el real (se
    // compara contra un conteo directo, sin RLS).
    await withTransaction(async (client) => {
      const expected = await client.query(
        `select
           (select count(*)::int from branches where tenant_id = $1 and deleted_at is null) as branches,
           (select count(*)::int from memberships where tenant_id = $1 and is_active and deleted_at is null) as employees,
           (select count(*)::int from customers where tenant_id = $1 and deleted_at is null) as customers,
           (select count(*)::int from pets where tenant_id = $1 and deleted_at is null) as pets`,
        [TENANT_PATITAS],
      )
      await asSuperadmin(client)

      const { rows } = await client.query(
        `select branches_count::int as branches, active_employees_count::int as employees,
                customers_count::int as customers, pets_count::int as pets
         from platform_tenant_metrics($1)`,
        [TENANT_PATITAS],
      )
      expect(rows[0]).toEqual(expected.rows[0])
      expect(rows[0].customers).toBeGreaterThan(0) // control: no es un 0 == 0 vacío
    })
  })

  it('no cuenta clientes ni sucursales con borrado suave', async () => {
    // Un cliente "borrado" por recepción no debe inflar el número de uso
    // del negocio que ve la plataforma.
    await withTransaction(async (client) => {
      await asSuperadmin(client)
      const before = await client.query(
        'select customers_count::int as n from platform_tenant_metrics($1)',
        [TENANT_PATITAS],
      )

      await client.query('reset role')
      await client.query('update customers set deleted_at = now() where id = $1', [CUSTOMER_SOFIA])
      await setRole(client, 'authenticated', USER_SUPERADMIN)

      const after = await client.query(
        'select customers_count::int as n from platform_tenant_metrics($1)',
        [TENANT_PATITAS],
      )
      expect(after.rows[0].n).toBe(before.rows[0].n - 1)
    })
  })

  it('"citas del mes" usa el mes en la zona horaria del NEGOCIO, no en UTC', async () => {
    // El caso frontera que importa (CLAUDE.md §8.3): en Tijuana (UTC−7/−8)
    // el mes empieza 7–8 horas DESPUÉS de la medianoche UTC. Una cita una
    // hora antes de ese instante es del mes ANTERIOR para el negocio, pero
    // un cálculo "ingenuo" en UTC la contaría en este mes y el negocio vería
    // una cifra equivocada cada inicio de mes. Se insertan tres citas:
    //   A) justo al inicio del mes local  → cuenta
    //   B) una hora antes                 → NO cuenta (mes anterior local)
    //   C) dentro del mes pero borrada    → NO cuenta
    await withTransaction(async (client) => {
      await client.query('update tenants set timezone = $1 where id = $2', [
        'America/Tijuana',
        TENANT_PATITAS,
      ])
      await asSuperadmin(client)
      const before = await client.query(
        'select appointments_this_month_count::int as n from platform_tenant_metrics($1)',
        [TENANT_PATITAS],
      )

      await client.query('reset role')
      const insertAppointment = (startsAtSql: string, deleted: boolean) =>
        client.query(
          `with m as (
             select date_trunc('month', now() at time zone 'America/Tijuana') at time zone 'America/Tijuana' as month_start
           )
           insert into appointments
             (tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, created_by, deleted_at)
           select $1, $2, $3, $4, 'grooming', $5, ${startsAtSql}, ${startsAtSql} + interval '30 minutes', $5,
                  case when $6::boolean then now() else null end
           from m`,
          [TENANT_PATITAS, BRANCH_CENTRO, CUSTOMER_SOFIA, PET_ROCKY, USER_GROOMER, deleted],
        )
      await insertAppointment('m.month_start', false) // A
      await insertAppointment("m.month_start - interval '1 hour'", false) // B
      await insertAppointment("m.month_start + interval '1 hour'", true) // C
      await setRole(client, 'authenticated', USER_SUPERADMIN)

      const after = await client.query(
        'select appointments_this_month_count::int as n from platform_tenant_metrics($1)',
        [TENANT_PATITAS],
      )
      expect(after.rows[0].n).toBe(before.rows[0].n + 1)
    })
  })

  it('"último acceso" es el inicio de sesión más reciente de cualquier miembro activo, y NULL si nadie ha entrado', async () => {
    // Es la señal de "¿este negocio sigue usando la plataforma?". Si
    // tomara el mínimo, o contara miembros desactivados, el panel diría
    // que un negocio abandonado sigue activo.
    await withTransaction(async (client) => {
      await client.query('update auth.users set last_sign_in_at = null')
      await client.query("update auth.users set last_sign_in_at = '2026-09-01T10:00:00Z' where id = $1", [USER_DUENO])
      await client.query("update auth.users set last_sign_in_at = '2026-09-10T10:00:00Z' where id = $1", [USER_GROOMER])
      await asSuperadmin(client)

      const latest = await client.query(
        "select last_access_at = '2026-09-10T10:00:00Z'::timestamptz as ok from platform_tenant_metrics($1)",
        [TENANT_PATITAS],
      )
      expect(latest.rows[0].ok).toBe(true)

      // Se desactiva al groomer: su acceso más reciente deja de contar.
      await client.query('reset role')
      await client.query(
        'update memberships set is_active = false where tenant_id = $1 and user_id = $2',
        [TENANT_PATITAS, USER_GROOMER],
      )
      await setRole(client, 'authenticated', USER_SUPERADMIN)
      const withoutGroomer = await client.query(
        "select last_access_at = '2026-09-01T10:00:00Z'::timestamptz as ok from platform_tenant_metrics($1)",
        [TENANT_PATITAS],
      )
      expect(withoutGroomer.rows[0].ok).toBe(true)

      // Un negocio que nadie ha usado devuelve NULL, no un error.
      const unused = await client.query('select last_access_at from platform_tenant_metrics($1)', [
        TENANT_HUELLITAS,
      ])
      expect(unused.rows[0].last_access_at).toBeNull()
    })
  })

  it('un negocio que no existe da un error legible, no una fila de ceros', async () => {
    // Una fila de ceros haría creer al superadmin que el negocio existe y
    // está vacío (p. ej. un id copiado mal).
    await withTransaction(async (client) => {
      await asSuperadmin(client)
      expect(
        await tryQuery(client, 'select * from platform_tenant_metrics($1)', [NONEXISTENT_UUID]),
      ).toMatch(/La empresa no existe/i)
    })
  })
})

describe('platform_set_tenant_status()', () => {
  it('suspender guarda el estado y el motivo (sin espacios sobrantes)', async () => {
    // El motivo es lo que hace útil la bitácora ("¿por qué se suspendió
    // esta cuenta hace tres meses?").
    await withTransaction(async (client) => {
      await asSuperadmin(client)
      const { rows } = await client.query(
        "select status, status_reason from platform_set_tenant_status($1, 'suspended', '  Falta de pago  ')",
        [TENANT_PATITAS],
      )
      expect(rows).toEqual([{ status: 'suspended', status_reason: 'Falta de pago' }])
    })
  })

  it.each([
    ['suspended', "'   '"],
    ['suspended', 'null'],
    ['closed', "''"],
  ])('%s con motivo %s se rechaza', async (status, reason) => {
    // Sin motivo obligatorio, la bitácora se llenaría de "suspendido"
    // sin explicación, justo cuando más se necesita saber por qué.
    await withTransaction(async (client) => {
      await asSuperadmin(client)
      expect(
        await tryQuery(
          client,
          `select * from platform_set_tenant_status($1, '${status}', ${reason})`,
          [TENANT_PATITAS],
        ),
      ).toMatch(/Indica el motivo/i)
    })
  })

  it('reactivar limpia el motivo (el anterior queda en la bitácora)', async () => {
    // Si el motivo viejo se quedara, un negocio "activo" mostraría
    // "Falta de pago" en su detalle. Pero tampoco se pierde: el UPDATE lo
    // deja en old_data de platform_audit_log.
    await withTransaction(async (client) => {
      await asSuperadmin(client)
      await client.query("select platform_set_tenant_status($1, 'closed', 'Cierre voluntario')", [
        TENANT_PATITAS,
      ])
      const { rows } = await client.query(
        "select status, status_reason from platform_set_tenant_status($1, 'active', 'ignorado')",
        [TENANT_PATITAS],
      )
      expect(rows).toEqual([{ status: 'active', status_reason: null }])

      const audit = await client.query(
        `select old_data ->> 'status_reason' as previous
         from platform_audit_log
         where tenant_id = $1 and action = 'UPDATE' and new_data ->> 'status' = 'active'`,
        [TENANT_PATITAS],
      )
      expect(audit.rows).toEqual([{ previous: 'Cierre voluntario' }])
    })
  })

  it('un negocio suspendido o dado de baja SIGUE operando: el estado es solo una etiqueta', async () => {
    // Decisión explícita de la fase 10: por ahora no se bloquea el acceso.
    // Este test documenta esa decisión: el día que se implemente el
    // bloqueo real, este test debe cambiar a propósito, no romperse por
    // sorpresa a alguien que toque `app.is_member_of()`.
    await withTransaction(async (client) => {
      await asSuperadmin(client)
      await client.query("select platform_set_tenant_status($1, 'closed', 'Baja de prueba')", [
        TENANT_PATITAS,
      ])

      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query('select id from customers where tenant_id = $1', [
        TENANT_PATITAS,
      ])
      expect(rows.length).toBeGreaterThan(0)
    })
  })

  it('un negocio que no existe da un error legible', async () => {
    // Un UPDATE sobre 0 filas no falla solo: sin este chequeo la UI
    // mostraría "guardado" para un negocio inexistente.
    await withTransaction(async (client) => {
      await asSuperadmin(client)
      expect(
        await tryQuery(client, "select * from platform_set_tenant_status($1, 'active', null)", [
          NONEXISTENT_UUID,
        ]),
      ).toMatch(/La empresa no existe/i)
    })
  })
})

describe('platform_update_notes()', () => {
  it('guarda la nota sin espacios sobrantes y texto en blanco se guarda como NULL', async () => {
    // "Sin notas" debe tener una sola forma (NULL): con '' y NULL
    // mezclados, la UI tendría que revisar ambos para saber si mostrar el
    // aviso "aún no hay notas".
    await withTransaction(async (client) => {
      await asSuperadmin(client)

      const saved = await client.query(
        "select internal_notes from platform_update_notes($1, '  Cliente piloto  ')",
        [TENANT_PATITAS],
      )
      expect(saved.rows[0].internal_notes).toBe('Cliente piloto')

      const blank = await client.query(
        "select internal_notes from platform_update_notes($1, '   ')",
        [TENANT_PATITAS],
      )
      expect(blank.rows[0].internal_notes).toBeNull()
    })
  })

  it('un negocio que no existe da un error legible', async () => {
    await withTransaction(async (client) => {
      await asSuperadmin(client)
      expect(
        await tryQuery(client, "select * from platform_update_notes($1, 'x')", [NONEXISTENT_UUID]),
      ).toMatch(/La empresa no existe/i)
    })
  })
})

describe('platform_create_tenant()', () => {
  it('crea negocio + una sucursal + dueño, y el dueño queda listo para entrar', async () => {
    // Es el alta completa. Se verifica cada pieza: negocio en zona México
    // Centro, UNA sucursal con el nombre capturado, membresía 'owner', su
    // fila de plataforma (plan Básico, activo, vigencia indefinida),
    // catálogo VACÍO, y el nombre/teléfono del dueño en su perfil. Si
    // faltara cualquiera, el dueño entraría a un negocio roto.
    await withTransaction(async (client) => {
      await insertAuthUser(client, USER_NUEVO_DUENO, 'nuevo.dueno@example.test')
      await asSuperadmin(client)

      const created = await client.query(
        "select (platform_create_tenant($1, '  Estética Nueva  ', ' Matriz ', ' Ana Pérez ', ' 5512345678 ')).id as tenant_id",
        [USER_NUEVO_DUENO],
      )
      const tenantId: string = created.rows[0].tenant_id

      const listed = await client.query(
        `select name, plan, status, plan_expires_at, owner_name, owner_email, owner_phone
         from platform_list_tenants() where tenant_id = $1`,
        [tenantId],
      )
      expect(listed.rows).toEqual([
        {
          name: 'Estética Nueva',
          plan: 'Básico',
          status: 'active',
          plan_expires_at: null,
          owner_name: 'Ana Pérez',
          owner_email: 'nuevo.dueno@example.test',
          owner_phone: '5512345678',
        },
      ])

      // Lo que el superadmin NO puede leer directo (branches, services)
      // se comprueba sin RLS.
      await client.query('reset role')
      const branches = await client.query('select name, timezone from branches where tenant_id = $1', [tenantId])
      expect(branches.rows).toEqual([{ name: 'Matriz', timezone: 'America/Mexico_City' }])
      const tenant = await client.query('select timezone from tenants where id = $1', [tenantId])
      expect(tenant.rows[0].timezone).toBe('America/Mexico_City')
      const services = await client.query('select count(*)::int as n from services where tenant_id = $1', [tenantId])
      expect(services.rows[0].n).toBe(0)

      // El dueño nuevo ya entra a SU negocio, como owner, y a ningún otro.
      await setRole(client, 'authenticated', USER_NUEVO_DUENO)
      const mine = await client.query("select id, app.role_in(id) as role from tenants")
      expect(mine.rows).toEqual([{ id: tenantId, role: 'owner' }])
    })
  })

  it('un teléfono en blanco se guarda como NULL', async () => {
    // Igual que las notas: "sin teléfono" con una sola forma.
    await withTransaction(async (client) => {
      await insertAuthUser(client, USER_NUEVO_DUENO, 'nuevo.dueno@example.test')
      await asSuperadmin(client)

      const created = await client.query(
        "select (platform_create_tenant($1, 'Sin Tel SA', 'Matriz', 'Ana', '   ')).id as tenant_id",
        [USER_NUEVO_DUENO],
      )
      const listed = await client.query(
        'select owner_phone from platform_list_tenants() where tenant_id = $1',
        [created.rows[0].tenant_id],
      )
      expect(listed.rows).toEqual([{ owner_phone: null }])
    })
  })

  it.each([
    ['nombre de empresa en blanco', "'   ', 'Matriz', 'Ana'", /nombre de la empresa/i],
    ['nombre de sucursal en blanco', "'Empresa', '', 'Ana'", /nombre de la sucursal/i],
    ['nombre del dueño en blanco', "'Empresa', 'Matriz', '  '", /nombre del dueño/i],
  ])('rechaza %s y no deja nada creado', async (_caso, args, message) => {
    // Los datos incompletos se rechazan ANTES de escribir nada: no debe
    // quedar un negocio sin sucursal ni un dueño sin negocio (el mismo
    // "todo o nada" de create_employee_membership).
    await withTransaction(async (client) => {
      await insertAuthUser(client, USER_NUEVO_DUENO, 'nuevo.dueno@example.test')
      await asSuperadmin(client)
      const before = await client.query('select count(*)::int as n from platform_list_tenants()')

      expect(
        await tryQuery(client, `select * from platform_create_tenant($1, ${args}, null)`, [
          USER_NUEVO_DUENO,
        ]),
      ).toMatch(message)

      const after = await client.query('select count(*)::int as n from platform_list_tenants()')
      expect(after.rows[0].n).toBe(before.rows[0].n)
    })
  })

  it('rechaza un usuario de dueño que no existe y no deja nada creado', async () => {
    // Si la Edge Function fallara al crear el usuario y el frontend
    // llamara igual a esta RPC, debe frenarse aquí con un mensaje claro y
    // sin dejar un negocio sin dueño.
    await withTransaction(async (client) => {
      await asSuperadmin(client)
      const before = await client.query('select count(*)::int as n from platform_list_tenants()')

      expect(
        await tryQuery(
          client,
          "select * from platform_create_tenant($1, 'Empresa', 'Matriz', 'Ana', null)",
          [NONEXISTENT_UUID],
        ),
      ).toMatch(/usuario del dueño no existe/i)

      const after = await client.query('select count(*)::int as n from platform_list_tenants()')
      expect(after.rows[0].n).toBe(before.rows[0].n)
    })
  })

  it('el alta queda en la bitácora de plataforma con el superadmin como actor', async () => {
    // "¿Quién dio de alta esta empresa y cuándo?" es la pregunta más
    // básica de soporte. El trigger de `tenants` crea la fila de
    // plataforma y esa inserción hereda auth.uid() del superadmin.
    await withTransaction(async (client) => {
      await insertAuthUser(client, USER_NUEVO_DUENO, 'nuevo.dueno@example.test')
      await asSuperadmin(client)

      const created = await client.query(
        "select (platform_create_tenant($1, 'Bitácora SA', 'Matriz', 'Ana', null)).id as tenant_id",
        [USER_NUEVO_DUENO],
      )
      const audit = await client.query(
        `select action, actor_user_id from platform_audit_log
         where tenant_id = $1 and table_name = 'tenant_platform_info'`,
        [created.rows[0].tenant_id],
      )
      expect(audit.rows).toEqual([{ action: 'INSERT', actor_user_id: USER_SUPERADMIN }])
    })
  })

  it('sin indicarlo, la empresa nace como real (is_demo = false)', async () => {
    // El default en false es la garantía de seguridad de demo:reset: si el
    // formulario o la Edge Function olvidan mandar la marca, la empresa se
    // trata como cliente REAL y el reset no la oculta. Si este test fallara
    // (default true), un cliente real desaparecería de la lista en el
    // siguiente reset.
    await withTransaction(async (client) => {
      await insertAuthUser(client, USER_NUEVO_DUENO, 'nuevo.dueno@example.test')
      await asSuperadmin(client)

      const created = await client.query(
        "select (platform_create_tenant($1, 'Cliente Real SA', 'Matriz', 'Ana', null)).id as tenant_id",
        [USER_NUEVO_DUENO],
      )

      await client.query('reset role')
      const info = await client.query('select is_demo from tenant_platform_info where tenant_id = $1', [
        created.rows[0].tenant_id,
      ])
      expect(info.rows).toEqual([{ is_demo: false }])
    })
  })

  it('con p_is_demo = true la empresa queda marcada como de demostración', async () => {
    // Es la otra mitad: sin esta marca, las empresas que se crean en una
    // demo nunca se limpiarían solas y la lista del superadmin se llenaría
    // de basura de presentaciones anteriores.
    await withTransaction(async (client) => {
      await insertAuthUser(client, USER_NUEVO_DUENO, 'nuevo.dueno@example.test')
      await asSuperadmin(client)

      const created = await client.query(
        "select (platform_create_tenant($1, 'Empresa Demo', 'Matriz', 'Ana', null, true)).id as tenant_id",
        [USER_NUEVO_DUENO],
      )

      await client.query('reset role')
      const info = await client.query('select is_demo from tenant_platform_info where tenant_id = $1', [
        created.rows[0].tenant_id,
      ])
      expect(info.rows).toEqual([{ is_demo: true }])
    })
  })

  it('un NULL explícito en p_is_demo no marca la empresa como demo', async () => {
    // Borde: si algún cliente manda null en vez de omitir el parámetro, el
    // `coalesce` lo trata como false. Sin él, `if null` en plpgsql se
    // comporta como falso de todos modos, pero este test fija que así sea
    // a propósito y no por accidente.
    await withTransaction(async (client) => {
      await insertAuthUser(client, USER_NUEVO_DUENO, 'nuevo.dueno@example.test')
      await asSuperadmin(client)

      const created = await client.query(
        "select (platform_create_tenant($1, 'Empresa Nula', 'Matriz', 'Ana', null, null)).id as tenant_id",
        [USER_NUEVO_DUENO],
      )

      await client.query('reset role')
      const info = await client.query('select is_demo from tenant_platform_info where tenant_id = $1', [
        created.rows[0].tenant_id,
      ])
      expect(info.rows).toEqual([{ is_demo: false }])
    })
  })
})
