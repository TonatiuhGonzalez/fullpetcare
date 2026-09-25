// Prueba el control de acceso por estado y vigencia de un negocio
// (migraciones 20260925140000 a 20260925170000, tarea #1905):
//
//   full       todo normal              (vigencia futura o indefinida)
//   grace      todo normal + aviso      (venció hace menos de 2 días)
//   read_only  se ve todo, no se escribe (suspendido, o vencido y sin gracia)
//   blocked    no se ve nada            (dado de baja)
//
// Por qué se prueba en la base y no en la pantalla: la pantalla es solo
// comodidad. Quien llame a la API directo con su sesión debe recibir lo mismo
// que ve la interfaz.
//
// Cada test corre en una transacción que se deshace sola (withTransaction).
// El estado del negocio se cambia con UPDATE directo, como postgres, para
// probar la regla de la base sin depender de las RPC de plataforma.
import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import { closePool, setRole, tryQuery, withTransaction } from './helpers'
import { TENANT_HUELLITAS, TENANT_PATITAS, USER_DUENO, USER_GROOMER } from './fixtures'

afterAll(closePool)

type Status = 'active' | 'suspended' | 'closed'

/** Cambia estado y vigencia de un negocio (aún como postgres, sin RLS). `expiresIn` en días (negativo = ya venció). */
async function setTenantInfo(
  client: PoolClient,
  tenantId: string,
  status: Status,
  expiresIn: number | null = null,
): Promise<void> {
  await client.query(
    `update tenant_platform_info
        set status = $2::tenant_status,
            status_reason = case when $2 = 'active' then null else 'comentario interno' end,
            public_reason = case when $2 = 'active' then null else 'Falta de pago' end,
            plan_expires_at = case when $3::numeric is null then null
                                   else now() + make_interval(secs => $3::numeric * 86400) end
      where tenant_id = $1`,
    [tenantId, status, expiresIn],
  )
}

async function countCustomers(client: PoolClient, tenantId: string): Promise<number> {
  const { rows } = await client.query('select id from customers where tenant_id = $1', [
    tenantId,
  ])
  return rows.length
}

/** Intenta crear un cliente; devuelve el mensaje de error o null si se pudo. */
function tryInsertCustomer(client: PoolClient, tenantId: string): Promise<string | null> {
  return tryQuery(
    client,
    `insert into customers (tenant_id, first_name, last_name) values ($1, 'Prueba', 'Bloqueo')`,
    [tenantId],
  )
}

describe('niveles de acceso', () => {
  it('suspendido: se ve todo pero no se puede escribir', async () => {
    // Es la decisión de producto: nadie pierde acceso a su información. Si
    // fallara la lectura, un negocio sin pagar quedaría "secuestrado"; si
    // fallara la escritura, "suspender" no impediría seguir operando.
    await withTransaction(async (client) => {
      await setTenantInfo(client, TENANT_PATITAS, 'suspended')
      await setRole(client, 'authenticated', USER_DUENO)
      expect(await countCustomers(client, TENANT_PATITAS)).toBeGreaterThan(0)
      expect(await tryInsertCustomer(client, TENANT_PATITAS)).toMatch(/solo lectura/i)
    })
  })

  it('suspendido: tampoco se pueden modificar filas existentes', async () => {
    // El trigger cubre UPDATE, no solo INSERT: editar o "borrar" (borrado
    // suave) un cliente es una escritura igual.
    await withTransaction(async (client) => {
      await setTenantInfo(client, TENANT_PATITAS, 'suspended')
      await setRole(client, 'authenticated', USER_DUENO)
      expect(
        await tryQuery(client, `update customers set notes = 'x' where tenant_id = $1`, [
          TENANT_PATITAS,
        ]),
      ).toMatch(/solo lectura/i)
    })
  })

  it('dado de baja: no se ve nada', async () => {
    // "closed" es el único estado que niega también la lectura.
    await withTransaction(async (client) => {
      await setTenantInfo(client, TENANT_PATITAS, 'closed')
      await setRole(client, 'authenticated', USER_DUENO)
      expect(await countCustomers(client, TENANT_PATITAS)).toBe(0)
      expect(await tryInsertCustomer(client, TENANT_PATITAS)).not.toBeNull()
    })
  })

  it('vigencia vencida hace más de 2 días: solo lectura aunque siga "activo"', async () => {
    // El vencimiento debe bastar por sí solo: aunque la tarea diaria aún no
    // haya corrido, nadie sigue escribiendo con el plan vencido.
    await withTransaction(async (client) => {
      await setTenantInfo(client, TENANT_PATITAS, 'active', -3)
      await setRole(client, 'authenticated', USER_DUENO)
      expect(await countCustomers(client, TENANT_PATITAS)).toBeGreaterThan(0)
      expect(await tryInsertCustomer(client, TENANT_PATITAS)).toMatch(/solo lectura/i)
    })
  })

  it('vencida hace menos de 2 días (gracia): todo sigue funcionando', async () => {
    // Borde de la gracia: si contara como solo lectura, un negocio que paga
    // con un día de retraso perdería su agenda del día.
    await withTransaction(async (client) => {
      await setTenantInfo(client, TENANT_PATITAS, 'active', -1)
      await setRole(client, 'authenticated', USER_DUENO)
      expect(await tryInsertCustomer(client, TENANT_PATITAS)).toBeNull()
    })
  })

  it('vigencia futura o indefinida (NULL) no limita nada', async () => {
    // Todos los negocios de hoy tienen vigencia NULL: si NULL contara como
    // vencida, se limitaría a todos al desplegar.
    await withTransaction(async (client) => {
      await setTenantInfo(client, TENANT_PATITAS, 'active', 400)
      await setRole(client, 'authenticated', USER_DUENO)
      expect(await tryInsertCustomer(client, TENANT_PATITAS)).toBeNull()
    })
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      expect(await tryInsertCustomer(client, TENANT_PATITAS)).toBeNull()
    })
  })

  it('reactivar el negocio devuelve la escritura al instante', async () => {
    // Un error de suspensión debe corregirse sin esperar a que caduque nada.
    await withTransaction(async (client) => {
      await setTenantInfo(client, TENANT_PATITAS, 'suspended')
      await setTenantInfo(client, TENANT_PATITAS, 'active')
      await setRole(client, 'authenticated', USER_DUENO)
      expect(await tryInsertCustomer(client, TENANT_PATITAS)).toBeNull()
    })
  })

  it('limitar a otro negocio no afecta a este', async () => {
    // El bloqueo es por negocio: suspender Huellitas Spa no tumba a Patitas.
    await withTransaction(async (client) => {
      await setTenantInfo(client, TENANT_HUELLITAS, 'suspended')
      await setRole(client, 'authenticated', USER_DUENO)
      expect(await tryInsertCustomer(client, TENANT_PATITAS)).toBeNull()
    })
  })

  it('un empleado (no solo el dueño) también conserva la lectura en un negocio suspendido', async () => {
    // Suspender es por negocio, no por rol: un groomer debe seguir viendo lo
    // suyo (y, por el mismo trigger, tampoco podría escribir).
    await withTransaction(async (client) => {
      await setTenantInfo(client, TENANT_PATITAS, 'suspended')
      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows } = await client.query('select app.role_in($1) as role', [
        TENANT_PATITAS,
      ])
      expect(rows[0].role).toBe('groomer')
    })
  })

  it('los scripts sin sesión (semilla, Edge Functions) siguen pudiendo escribir', async () => {
    // El trigger solo frena a personas (auth.uid() no nulo). Si frenara a
    // service_role, se rompería demo:reset y el registro de accesos de la
    // vista pública sobre un negocio suspendido.
    await withTransaction(async (client) => {
      await setTenantInfo(client, TENANT_PATITAS, 'suspended')
      expect(await tryInsertCustomer(client, TENANT_PATITAS)).toBeNull()
    })
  })

  it('TODA tabla de negocio con tenant_id tiene el trigger de solo lectura', async () => {
    // Guardia contra el olvido: una tabla futura sin el trigger sería una
    // grieta por donde un negocio suspendido seguiría escribiendo. Si este
    // test falla, la migración de esa tabla debe agregar el trigger
    // (create trigger enforce_tenant_writable ...).
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `select c.table_name
           from information_schema.columns c
           join information_schema.tables t
             on t.table_schema = c.table_schema and t.table_name = c.table_name
          where c.table_schema = 'public' and c.column_name = 'tenant_id'
            and t.table_type = 'BASE TABLE'
            and c.table_name not in ('audit_log', 'platform_audit_log', 'tenant_platform_info')
            and not exists (
              select 1 from pg_trigger g
               where g.tgrelid = format('public.%I', c.table_name)::regclass
                 and g.tgname = 'enforce_tenant_writable')`,
      )
      expect(rows).toEqual([])
    })
  })
})

describe('my_tenant_notices()', () => {
  it('suspendido: avisa solo lectura con el motivo PÚBLICO y sin comentarios internos', async () => {
    // Es lo que alimenta el aviso del login. Si filtrara el comentario
    // interno, el cliente leería lo que el superadmin escribió para sí mismo.
    await withTransaction(async (client) => {
      await setTenantInfo(client, TENANT_PATITAS, 'suspended')
      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query('select * from my_tenant_notices()')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        tenant_id: TENANT_PATITAS,
        role: 'owner',
        notice: 'read_only',
        public_reason: 'Falta de pago',
      })
      expect(JSON.stringify(rows[0])).not.toContain('comentario interno')
    })
  })

  it('dado de baja: aparece aunque la base ya lo oculte del resto', async () => {
    // Sin esto, un negocio dado de baja solo se vería como "sin negocio".
    await withTransaction(async (client) => {
      await setTenantInfo(client, TENANT_PATITAS, 'closed')
      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query('select notice from my_tenant_notices()')
      expect(rows).toEqual([{ notice: 'blocked' }])
    })
  })

  it('vencida en gracia: avisa "grace" con la fecha en que termina la gracia', async () => {
    // El banner debe poder decir "tienes hasta el ...".
    await withTransaction(async (client) => {
      await setTenantInfo(client, TENANT_PATITAS, 'active', -1)
      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query('select * from my_tenant_notices()')
      expect(rows[0].notice).toBe('grace')
      const ends = new Date(rows[0].grace_ends_at).getTime()
      const expires = new Date(rows[0].plan_expires_at).getTime()
      expect(ends - expires).toBe(2 * 86400 * 1000)
    })
  })

  it('por vencer en 3 días o menos: avisa "expiring"; en 4 o más, no avisa', async () => {
    // Borde del aviso previo: 3 días exactos entra, más lejos sería ruido.
    await withTransaction(async (client) => {
      await setTenantInfo(client, TENANT_PATITAS, 'active', 2.9)
      await setRole(client, 'authenticated', USER_DUENO)
      const near = await client.query('select notice from my_tenant_notices()')
      expect(near.rows).toEqual([{ notice: 'expiring' }])
    })
    await withTransaction(async (client) => {
      await setTenantInfo(client, TENANT_PATITAS, 'active', 3.5)
      await setRole(client, 'authenticated', USER_DUENO)
      const far = await client.query('select notice from my_tenant_notices()')
      expect(far.rows).toEqual([])
    })
  })

  it('negocio normal (vigencia indefinida): sin avisos', async () => {
    // Con lista vacía el login sigue normal.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query('select * from my_tenant_notices()')
      expect(rows).toEqual([])
    })
  })

  it('no revela avisos de negocios ajenos', async () => {
    // Fuga entre negocios (CLAUDE.md §7.3.4): el dueño de Patitas no debe
    // enterarse de que Huellitas está suspendido.
    await withTransaction(async (client) => {
      await setTenantInfo(client, TENANT_HUELLITAS, 'suspended')
      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query('select * from my_tenant_notices()')
      expect(rows).toEqual([])
    })
  })

  it('el rol anónimo no puede ejecutarla', async () => {
    // Sin sesión no hay a quién avisar, y no debe poder sondearse.
    await withTransaction(async (client) => {
      await setRole(client, 'anon')
      expect(await tryQuery(client, 'select * from my_tenant_notices()')).toMatch(
        /permission denied/i,
      )
    })
  })
})

describe('suspensión automática por vencimiento', () => {
  it('suspende solo los negocios con la vigencia vencida Y la gracia terminada', async () => {
    // Si suspendiera durante la gracia, se rompería la promesa de 2 días; si
    // tocara los de vigencia NULL, suspendería a todos los clientes de hoy.
    await withTransaction(async (client) => {
      await setTenantInfo(client, TENANT_PATITAS, 'active', -3)
      await setTenantInfo(client, TENANT_HUELLITAS, 'active', -1)
      const { rows } = await client.query('select app.suspend_expired_tenants() as n')
      expect(rows[0].n).toBe(1)

      const info = await client.query(
        `select tenant_id, status, public_reason from tenant_platform_info
          where tenant_id in ($1, $2) order by status`,
        [TENANT_PATITAS, TENANT_HUELLITAS],
      )
      expect(info.rows).toEqual([
        { tenant_id: TENANT_HUELLITAS, status: 'active', public_reason: null },
        {
          tenant_id: TENANT_PATITAS,
          status: 'suspended',
          public_reason: 'Falta de pago',
        },
      ])
    })
  })

  it('deja el cambio en la bitácora de plataforma, con actor nulo (el sistema)', async () => {
    // El superadmin debe poder ver por qué un negocio amaneció suspendido.
    await withTransaction(async (client) => {
      await setTenantInfo(client, TENANT_PATITAS, 'active', -3)
      await client.query('select app.suspend_expired_tenants()')
      const { rows } = await client.query(
        `select actor_user_id from platform_audit_log
          where tenant_id = $1 and action = 'UPDATE' and new_data ->> 'status' = 'suspended'`,
        [TENANT_PATITAS],
      )
      expect(rows).toEqual([{ actor_user_id: null }])
    })
  })

  it('ningún usuario de la app puede ejecutarla, y la tarea diaria está programada', async () => {
    // Si un dueño pudiera ejecutarla, podría suspender a todos los negocios
    // vencidos a voluntad. Y sin el job en cron.job, nada la correría sola.
    await withTransaction(async (client) => {
      const job = await client.query(
        `select schedule from cron.job where jobname = 'suspend-expired-tenants'`,
      )
      expect(job.rows).toEqual([{ schedule: '0 6 * * *' }])

      await setRole(client, 'authenticated', USER_DUENO)
      expect(await tryQuery(client, 'select app.suspend_expired_tenants()')).toMatch(
        /permission denied/i,
      )
    })
  })
})

describe('cancel_my_tenant()', () => {
  it('el dueño da de baja su negocio: queda invisible y con motivo del cliente', async () => {
    // Es la cancelación por el propio dueño. Debe dejar el negocio en
    // "closed" con el motivo público "solicitada por el cliente".
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      await client.query('select cancel_my_tenant($1, $2)', [
        TENANT_PATITAS,
        'Cierro el local',
      ])
      expect(await countCustomers(client, TENANT_PATITAS)).toBe(0)

      const { rows } = await client.query('select * from my_tenant_notices()')
      expect(rows[0]).toMatchObject({
        notice: 'blocked',
        public_reason: 'Cancelación solicitada por el cliente',
      })
    })
  })

  it('el comentario del dueño queda solo como comentario interno', async () => {
    // El comentario libre lo escribe una persona: nunca debe salir hacia el
    // motivo público que ve el negocio.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      await client.query('select cancel_my_tenant($1, $2)', [
        TENANT_PATITAS,
        'Cierro el local',
      ])
      await setRole(client, 'service_role')
      const { rows } = await client.query(
        'select status_reason, public_reason from tenant_platform_info where tenant_id = $1',
        [TENANT_PATITAS],
      )
      expect(rows[0].status_reason).toContain('Cierro el local')
      expect(rows[0].public_reason).not.toContain('Cierro el local')
    })
  })

  it('un empleado que no es dueño no puede cancelar el negocio', async () => {
    // Si un groomer pudiera, cualquier empleado descontento cerraría el negocio.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_GROOMER)
      expect(
        await tryQuery(client, 'select cancel_my_tenant($1)', [TENANT_PATITAS]),
      ).toMatch(/No tienes permiso/i)
    })
  })

  it('el dueño de otro negocio no puede cancelar este', async () => {
    // Fuga entre negocios: la función es SECURITY DEFINER y debe revalidar la membresía.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      expect(
        await tryQuery(client, 'select cancel_my_tenant($1)', [TENANT_HUELLITAS]),
      ).toMatch(/No tienes permiso/i)
    })
  })
})
