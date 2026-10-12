// Búsqueda sin acentos en la base (Correcciones 1, tarea C1.5, PLAN.md D26
// punto 5; migración 20261014140000_accent_insensitive_search.sql):
// app.search_norm() y las RPC search_customers(), search_pets() y
// search_products().
//
// Cada test arma sus propios datos con nombres inventados y raros (para no
// chocar con la semilla) dentro de una transacción que se revierte sola, y
// consulta como un usuario real (rol authenticated), así que RLS aplica igual
// que en la app.
import type { PoolClient } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { closePool, setRole, withTransaction } from './helpers'
import { TENANT_HUELLITAS, TENANT_PATITAS, USER_DUENO } from './fixtures'

afterAll(closePool)

async function addCustomer(
  client: PoolClient,
  first: string,
  last: string,
  opts: { tenantId?: string; phone?: string; email?: string; deleted?: boolean } = {},
): Promise<string> {
  const { rows } = await client.query(
    `insert into customers (tenant_id, first_name, last_name, phone, email, deleted_at)
     values ($1, $2, $3, $4, $5, case when $6::boolean then now() end) returning id`,
    [opts.tenantId ?? TENANT_PATITAS, first, last, opts.phone ?? null, opts.email ?? null, !!opts.deleted],
  )
  return rows[0].id
}

async function addPet(
  client: PoolClient,
  customerId: string,
  name: string,
  opts: { species?: string; tenantId?: string; deleted?: boolean } = {},
): Promise<string> {
  const { rows } = await client.query(
    `insert into pets (tenant_id, customer_id, name, species, deleted_at)
     values ($1, $2, $3, $4::pet_species, case when $5::boolean then now() end) returning id`,
    [opts.tenantId ?? TENANT_PATITAS, customerId, name, opts.species ?? 'dog', !!opts.deleted],
  )
  return rows[0].id
}

async function addProduct(
  client: PoolClient,
  name: string,
  opts: { sku?: string; tenantId?: string; deleted?: boolean } = {},
): Promise<string> {
  const { rows } = await client.query(
    `insert into products (tenant_id, name, sku, price_cents, deleted_at)
     values ($1, $2, $3, 10000, case when $4::boolean then now() end) returning id`,
    [opts.tenantId ?? TENANT_PATITAS, name, opts.sku ?? null, !!opts.deleted],
  )
  return rows[0].id
}

/** Los ids que devuelve una búsqueda, consultada como el dueño de Patitas. */
async function ids(client: PoolClient, fn: string, term: string | null, tenant = TENANT_PATITAS) {
  const { rows } = await client.query(`select id from ${fn}($1, $2)`, [tenant, term])
  return rows.map((r) => r.id as string)
}

describe('app.search_norm()', () => {
  it('quita acentos y mayúsculas, pero conserva la ñ', async () => {
    // Si la ñ se confundiera con la n, buscar "ano" traería "año": en español
    // son palabras distintas. Si no se quitaran los acentos, "jose" no
    // encontraría a "José", que es el problema que se reportó.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query(
        `select app.search_norm('  JOSÉ Peña ÑANDÚ  ') as a,
                app.search_norm('Jose') as b,
                app.search_norm('n' || chr(771)) as nfd,
                app.search_norm(null) as nulo`,
      )
      expect(rows[0].a).toBe('jose peña ñandu')
      expect(rows[0].b).toBe('jose')
      // "n" + tilde combinada (NFD) es la misma ñ que la de una sola pieza.
      expect(rows[0].nfd).toBe('ñ')
      expect(rows[0].nulo).toBeNull()
    })
  })

  it('es IMMUTABLE (indexable) y PARALLEL SAFE', async () => {
    // IMMUTABLE es lo que permite crear un índice sobre la expresión si un
    // negocio crece; la unaccent original es STABLE y no lo permite.
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `select provolatile, proparallel from pg_proc
          where proname = 'search_norm' and pronamespace = 'app'::regnamespace`,
      )
      expect(rows[0].provolatile).toBe('i')
      expect(rows[0].proparallel).toBe('s')
    })
  })
})

describe('search_customers()', () => {
  it('"jose" encuentra a "José" y "JOSÉ" encuentra a "jose"', async () => {
    // El caso reportado: la gente teclea sin acentos y el acento en la base
    // hacía que el cliente "no existiera".
    await withTransaction(async (client) => {
      const acentuado = await addCustomer(client, 'José', 'Zzbusqueda')
      const plano = await addCustomer(client, 'jose', 'Yybusqueda')
      await setRole(client, 'authenticated', USER_DUENO)
      for (const term of ['jose', 'JOSE', 'José', 'JOSÉ']) {
        const found = await ids(client, 'search_customers', term)
        expect(found).toContain(acentuado)
        expect(found).toContain(plano)
      }
    })
  })

  it('la ñ no se confunde con la n', async () => {
    await withTransaction(async (client) => {
      const conEnie = await addCustomer(client, 'Ana', 'Muñozzz')
      const sinEnie = await addCustomer(client, 'Ana', 'Munozzz')
      await setRole(client, 'authenticated', USER_DUENO)

      const a = await ids(client, 'search_customers', 'muñozzz')
      expect(a).toContain(conEnie)
      expect(a).not.toContain(sinEnie)

      const b = await ids(client, 'search_customers', 'MUNOZZZ')
      expect(b).toContain(sinEnie)
      expect(b).not.toContain(conEnie)
    })
  })

  it('es "empieza con", no "contiene": "ose" no encuentra a José', async () => {
    // Conserva el criterio de hoy de la pantalla Clientes (customers.sql).
    await withTransaction(async (client) => {
      const id = await addCustomer(client, 'José', 'Zzempieza')
      await setRole(client, 'authenticated', USER_DUENO)
      expect(await ids(client, 'search_customers', 'ose')).not.toContain(id)
      expect(await ids(client, 'search_customers', 'jos')).toContain(id)
    })
  })

  it('busca también por apellido, teléfono y correo (empieza con)', async () => {
    await withTransaction(async (client) => {
      const id = await addCustomer(client, 'Lupe', 'Ñoño Zzcampos', {
        phone: '5598761234',
        email: 'Lupe.Campos@Example.mx',
      })
      await setRole(client, 'authenticated', USER_DUENO)
      expect(await ids(client, 'search_customers', 'ñoño')).toContain(id)
      expect(await ids(client, 'search_customers', '559876')).toContain(id)
      expect(await ids(client, 'search_customers', 'LUPE.campos@')).toContain(id)
      // Un fragmento del medio del correo no cuenta.
      expect(await ids(client, 'search_customers', 'campos@example')).not.toContain(id)
    })
  })

  it('no devuelve eliminados ni clientes de otro negocio', async () => {
    // El borrado suave debe esconderlos (el filtro vive en la función, §7.2) y
    // RLS debe impedir ver otro negocio aunque se pida su tenant_id.
    await withTransaction(async (client) => {
      const eliminado = await addCustomer(client, 'Zzfantasma', 'Eliminado', { deleted: true })
      const ajeno = await addCustomer(client, 'Zzfantasma', 'Ajeno', { tenantId: TENANT_HUELLITAS })
      await setRole(client, 'authenticated', USER_DUENO)

      const propios = await ids(client, 'search_customers', 'zzfantasma')
      expect(propios).not.toContain(eliminado)
      expect(propios).not.toContain(ajeno)

      // Pidiendo explícitamente el negocio ajeno: RLS no deja ver nada.
      expect(await ids(client, 'search_customers', 'zzfantasma', TENANT_HUELLITAS)).toEqual([])
      expect(await ids(client, 'search_customers', '', TENANT_HUELLITAS)).toEqual([])
    })
  })

  it('un término vacío, nulo o de espacios devuelve todos los no eliminados', async () => {
    await withTransaction(async (client) => {
      await addCustomer(client, 'Zzvisible', 'Uno')
      await addCustomer(client, 'Zzoculto', 'Dos', { deleted: true })
      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query(
        `select count(*)::int as n from customers where tenant_id = $1 and deleted_at is null`,
        [TENANT_PATITAS],
      )
      for (const term of ['', '   ', null]) {
        expect(await ids(client, 'search_customers', term)).toHaveLength(rows[0].n)
      }
    })
  })

  it('los comodines del término se tratan como texto', async () => {
    // Sin escapar, buscar "%" traería a todos y "_" a cualquiera con una letra.
    await withTransaction(async (client) => {
      const literal = await addCustomer(client, 'A_B', 'Zzcomodin')
      const parecido = await addCustomer(client, 'AxB', 'Zzcomodin')
      await setRole(client, 'authenticated', USER_DUENO)

      const guionBajo = await ids(client, 'search_customers', 'a_b')
      expect(guionBajo).toContain(literal)
      expect(guionBajo).not.toContain(parecido)

      expect(await ids(client, 'search_customers', '%')).toEqual([])
      expect(await ids(client, 'search_customers', '\\')).toEqual([])
    })
  })

  it('ordena por apellido y luego nombre, como la lista de hoy', async () => {
    await withTransaction(async (client) => {
      const b = await addCustomer(client, 'Beto', 'Zzorden')
      const a = await addCustomer(client, 'Ana', 'Zzorden')
      const c = await addCustomer(client, 'Ana', 'Zzordenb')
      await setRole(client, 'authenticated', USER_DUENO)
      const found = (await ids(client, 'search_customers', 'ana')).filter((id) => [a, b, c].includes(id))
      expect(found).toEqual([a, c])
      const all = (await ids(client, 'search_customers', '')).filter((id) => [a, b, c].includes(id))
      expect(all).toEqual([a, b, c])
    })
  })

  it('un visitante sin sesión no puede ejecutarla', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'anon')
      await expect(ids(client, 'search_customers', 'a')).rejects.toThrow(/permission denied/i)
    })
  })
})

describe('search_pets()', () => {
  it('encuentra por nombre sin acentos, y "contiene" en cualquier parte', async () => {
    await withTransaction(async (client) => {
      const dueno = await addCustomer(client, 'Dueño', 'Zzmascotas')
      const pet = await addPet(client, dueno, 'Peluchín')
      await setRole(client, 'authenticated', USER_DUENO)
      expect(await ids(client, 'search_pets', 'peluchin')).toContain(pet)
      expect(await ids(client, 'search_pets', 'LUCH')).toContain(pet)
    })
  })

  it('encuentra por especie en español, sin acentos', async () => {
    // La persona escribe "gato", no "cat": la base guarda el valor en inglés
    // del enum, así que la función lo traduce igual que lib/petLabels.ts.
    await withTransaction(async (client) => {
      const dueno = await addCustomer(client, 'Zzespecie', 'Dueno')
      const gato = await addPet(client, dueno, 'Zzmichi', { species: 'cat' })
      const perro = await addPet(client, dueno, 'Zzrocky', { species: 'dog' })
      await setRole(client, 'authenticated', USER_DUENO)
      const gatos = await ids(client, 'search_pets', 'GATO')
      expect(gatos).toContain(gato)
      expect(gatos).not.toContain(perro)
      expect(await ids(client, 'search_pets', 'perro')).toContain(perro)
    })
  })

  it('encuentra por nombre completo del dueño (nombre y apellido juntos)', async () => {
    await withTransaction(async (client) => {
      const dueno = await addCustomer(client, 'Raúl', 'Zzgutiérrez')
      const pet = await addPet(client, dueno, 'Zzfirulais')
      await setRole(client, 'authenticated', USER_DUENO)
      expect(await ids(client, 'search_pets', 'raul zzgutierrez')).toContain(pet)
      expect(await ids(client, 'search_pets', 'RAÚL')).toContain(pet)
    })
  })

  it('la ñ no se confunde con la n en mascotas', async () => {
    await withTransaction(async (client) => {
      const dueno = await addCustomer(client, 'Zzñ', 'Dueno')
      const conEnie = await addPet(client, dueno, 'Zzcariño')
      const sinEnie = await addPet(client, dueno, 'Zzcarino')
      await setRole(client, 'authenticated', USER_DUENO)
      const found = await ids(client, 'search_pets', 'zzcariño')
      expect(found).toContain(conEnie)
      expect(found).not.toContain(sinEnie)
    })
  })

  it('no devuelve mascotas eliminadas, de dueños eliminados ni de otro negocio', async () => {
    await withTransaction(async (client) => {
      const dueno = await addCustomer(client, 'Zzdueno', 'Activo')
      const eliminada = await addPet(client, dueno, 'Zzpetfantasma', { deleted: true })
      const ajenoDueno = await addCustomer(client, 'Zzdueno', 'Ajeno', { tenantId: TENANT_HUELLITAS })
      const ajena = await addPet(client, ajenoDueno, 'Zzpetfantasma', { tenantId: TENANT_HUELLITAS })
      await setRole(client, 'authenticated', USER_DUENO)
      const found = await ids(client, 'search_pets', 'zzpetfantasma')
      expect(found).not.toContain(eliminada)
      expect(found).not.toContain(ajena)
      expect(await ids(client, 'search_pets', 'zzpetfantasma', TENANT_HUELLITAS)).toEqual([])
    })
  })

  it('término vacío devuelve todas las no eliminadas; los comodines son texto', async () => {
    await withTransaction(async (client) => {
      const dueno = await addCustomer(client, 'Zzvacio', 'Dueno')
      await addPet(client, dueno, 'Zzuno')
      await addPet(client, dueno, 'Zzoculta', { deleted: true })
      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query(
        `select count(*)::int as n from pets p join customers c on c.id = p.customer_id
          where p.tenant_id = $1 and p.deleted_at is null and c.deleted_at is null`,
        [TENANT_PATITAS],
      )
      expect(await ids(client, 'search_pets', '')).toHaveLength(rows[0].n)
      expect(await ids(client, 'search_pets', '%')).toEqual([])
      expect(await ids(client, 'search_pets', '_')).toEqual([])
    })
  })
})

describe('search_products()', () => {
  it('encuentra por nombre sin acentos y por código, "contiene"', async () => {
    await withTransaction(async (client) => {
      const id = await addProduct(client, 'Shampóo hipoalergénico', { sku: 'ZZ-SHA-001' })
      await setRole(client, 'authenticated', USER_DUENO)
      expect(await ids(client, 'search_products', 'shampoo')).toContain(id)
      expect(await ids(client, 'search_products', 'HIPOALERGENICO')).toContain(id)
      expect(await ids(client, 'search_products', 'sha-00')).toContain(id)
    })
  })

  it('la ñ no se confunde con la n en productos', async () => {
    await withTransaction(async (client) => {
      const conEnie = await addProduct(client, 'Zzcuñete')
      const sinEnie = await addProduct(client, 'Zzcunete')
      await setRole(client, 'authenticated', USER_DUENO)
      const found = await ids(client, 'search_products', 'zzcuñete')
      expect(found).toContain(conEnie)
      expect(found).not.toContain(sinEnie)
    })
  })

  it('no devuelve eliminados ni productos de otro negocio', async () => {
    await withTransaction(async (client) => {
      const eliminado = await addProduct(client, 'Zzprodfantasma', { deleted: true })
      const ajeno = await addProduct(client, 'Zzprodfantasma', { tenantId: TENANT_HUELLITAS })
      await setRole(client, 'authenticated', USER_DUENO)
      const found = await ids(client, 'search_products', 'zzprodfantasma')
      expect(found).not.toContain(eliminado)
      expect(found).not.toContain(ajeno)
      expect(await ids(client, 'search_products', 'zzprodfantasma', TENANT_HUELLITAS)).toEqual([])
    })
  })

  it('término vacío devuelve todo; % y _ se buscan como texto', async () => {
    // "50%" es un nombre real de producto ("Croquetas 50% carne"): con el
    // comodín sin escapar, buscar "%" traería todo el catálogo.
    await withTransaction(async (client) => {
      const id = await addProduct(client, 'Zzcroquetas 50% carne')
      const otro = await addProduct(client, 'Zzcroquetas pollo')
      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query(
        `select count(*)::int as n from products where tenant_id = $1 and deleted_at is null`,
        [TENANT_PATITAS],
      )
      expect(await ids(client, 'search_products', '')).toHaveLength(rows[0].n)
      expect(await ids(client, 'search_products', '50%')).toEqual([id])
      expect(await ids(client, 'search_products', '%')).toEqual([id])
      expect(await ids(client, 'search_products', '_')).toEqual([])
      expect(await ids(client, 'search_products', 'zzcroquetas')).toEqual(
        expect.arrayContaining([id, otro]),
      )
    })
  })
})
