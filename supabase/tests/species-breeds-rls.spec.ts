// RLS y reglas de la base del catálogo de especies y razas (fase 27, tareas 27.3 a 27.5).
// El catálogo lo leen todos los miembros y lo escriben dueño y veterinario; cada negocio
// tiene el suyo, y la mascota no puede mezclar la raza de una especie con otra.
import { afterAll, describe, expect, it } from 'vitest'

import { asUser, closePool, setRole, withTransaction } from './helpers'
import {
  PET_ROCKY,
  TENANT_HUELLITAS,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
  USER_VET,
} from './fixtures'

afterAll(closePool)

async function speciesId(client: import('pg').PoolClient, tenant: string, name: string) {
  const { rows } = await client.query(
    'select id from species where tenant_id = $1 and name = $2 and deleted_at is null',
    [tenant, name],
  )
  return rows[0].id as string
}

describe('catálogo base de especies y razas', () => {
  // Qué prueba: que cada negocio de la semilla trae el catálogo (6 grupos, perros y gatos con
  // razas, aves y reptiles sin ellas).
  // Qué se rompería: un negocio nuevo tendría el formulario de mascota vacío.
  it('cada negocio trae grupos, especies y razas', async () => {
    const { rows } = await asUser(USER_DUENO, (c) =>
      c.query(
        `select
           (select count(*) from species_groups where tenant_id = $1 and deleted_at is null)::int as groups,
           (select count(*) from species where tenant_id = $1 and deleted_at is null)::int as species,
           (select count(*) from breeds where tenant_id = $1 and deleted_at is null)::int as breeds`,
        [TENANT_PATITAS],
      ),
    )
    expect(rows[0].groups).toBe(6)
    expect(rows[0].species).toBeGreaterThan(20)
    expect(rows[0].breeds).toBeGreaterThan(30)
  })

  // Qué prueba: que solo Perro y Gato llevan razas (D30 punto 1).
  it('solo perros y gatos llevan razas', async () => {
    const { rows } = await asUser(USER_DUENO, (c) =>
      c.query(
        `select s.name from species s
         where s.tenant_id = $1 and s.has_breeds and s.deleted_at is null order by s.name`,
        [TENANT_PATITAS],
      ),
    )
    expect(rows.map((r) => r.name)).toEqual(['Gato', 'Perro'])
  })

  // Qué prueba: que el Xoloitzcuintle quedó con su variante "xolo" (la queja original).
  it('la raza Xoloitzcuintle trae la variante "xolo"', async () => {
    const { rows } = await asUser(USER_DUENO, (c) =>
      c.query(
        "select search_aliases from breeds where tenant_id = $1 and name = 'Xoloitzcuintle'",
        [TENANT_PATITAS],
      ),
    )
    expect(rows[0].search_aliases).toContain('xolo')
  })

  // Qué prueba: que un negocio recién creado recibe el catálogo por el trigger de `tenants`.
  // Qué se rompería: los negocios dados de alta por el superadmin empezarían sin especies.
  it('un negocio nuevo recibe el catálogo base solo', async () => {
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        "insert into tenants (name) values ('Negocio de prueba') returning id",
      )
      const count = await client.query(
        'select count(*)::int as n from species where tenant_id = $1',
        [rows[0].id],
      )
      expect(count.rows[0].n).toBeGreaterThan(20)
    })
  })
})

describe('species_groups, species y breeds: aislamiento y permisos', () => {
  // Qué prueba: un negocio no ve el catálogo de otro.
  // Qué se rompería: un negocio vería y podría tocar razas editadas por otro.
  it('el dueño de Patitas no ve el catálogo de Huellitas', async () => {
    const { rows } = await asUser(USER_DUENO, (c) =>
      c.query('select id from species where tenant_id = $1', [TENANT_HUELLITAS]),
    )
    expect(rows).toHaveLength(0)
  })

  // Qué prueba: cualquier miembro lee, incluido el groomer (necesita la raza para el corte).
  it('cualquier miembro activo lo lee, incluido groomer', async () => {
    const { rows } = await asUser(USER_GROOMER, (c) =>
      c.query('select id from breeds where tenant_id = $1 limit 1', [TENANT_PATITAS]),
    )
    expect(rows).toHaveLength(1)
  })

  // Qué prueba: el veterinario agrega una raza y la oculta (borrado suave con UPDATE).
  // Qué se rompería: el vet tendría que pedirle al dueño cada raza nueva.
  it('el veterinario puede agregar y ocultar una raza', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_VET)
      const perro = await speciesId(client, TENANT_PATITAS, 'Perro')
      const created = await client.query(
        "insert into breeds (tenant_id, species_id, name, search_aliases) values ($1, $2, 'Raza de prueba', '{prueba}') returning id",
        [TENANT_PATITAS, perro],
      )
      expect(created.rows).toHaveLength(1)

      const hidden = await client.query(
        'update breeds set deleted_at = now() where id = $1 returning id',
        [created.rows[0].id],
      )
      expect(hidden.rows).toHaveLength(1)
    })
  })

  // Qué prueba: recepción y groomer no escriben el catálogo.
  // Qué se rompería: cualquiera de recepción cambiaría las opciones de todos los formularios.
  it('recepción y groomer no pueden escribir', async () => {
    for (const user of [USER_RECEPCION, USER_GROOMER]) {
      await withTransaction(async (client) => {
        await setRole(client, 'authenticated', user)
        await expect(
          client.query(
            "insert into species_groups (tenant_id, name) values ($1, 'No debería')",
            [TENANT_PATITAS],
          ),
        ).rejects.toThrow(/row-level security/i)
      })
    }
  })

  // Qué prueba: el nombre no se repite dentro de un negocio, sin importar mayúsculas.
  it('no deja repetir el nombre de una especie ni de una raza en la misma especie', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const perro = await speciesId(client, TENANT_PATITAS, 'Perro')
      await expect(
        client.query(
          "insert into breeds (tenant_id, species_id, name) values ($1, $2, 'xoloitzcuintle')",
          [TENANT_PATITAS, perro],
        ),
      ).rejects.toThrow(/duplicate key|unique/i)
    })
  })

  // Qué prueba: una especie no puede colgar de un grupo de otro negocio (llave compuesta).
  it('una especie no cuelga del grupo de otro negocio', async () => {
    await withTransaction(async (client) => {
      const group = await client.query(
        'select id from species_groups where tenant_id = $1 limit 1',
        [TENANT_HUELLITAS],
      )
      await expect(
        client.query(
          "insert into species (tenant_id, group_id, name) values ($1, $2, 'Cruzada')",
          [TENANT_PATITAS, group.rows[0].id],
        ),
      ).rejects.toThrow(/foreign key/i)
    })
  })
})

describe('pets: especie, raza y edad estimada', () => {
  // Qué prueba: la mascota acepta una raza de SU especie.
  it('acepta una raza de la especie elegida', async () => {
    await withTransaction(async (client) => {
      const perro = await speciesId(client, TENANT_PATITAS, 'Perro')
      const breed = await client.query(
        "select id from breeds where species_id = $1 and name = 'Xoloitzcuintle'",
        [perro],
      )
      const { rowCount } = await client.query(
        'update pets set species_id = $2, breed_id = $3, birth_date_is_estimated = true where id = $1',
        [PET_ROCKY, perro, breed.rows[0].id],
      )
      expect(rowCount).toBe(1)
    })
  })

  // Qué prueba: no se puede combinar una raza con la especie equivocada.
  // Qué se rompería: un gato con raza "Labrador"; las pantallas mostrarían datos absurdos.
  it('rechaza una raza que no es de la especie', async () => {
    await withTransaction(async (client) => {
      const gato = await speciesId(client, TENANT_PATITAS, 'Gato')
      const perroBreed = await client.query(
        "select id from breeds where tenant_id = $1 and name = 'Xoloitzcuintle'",
        [TENANT_PATITAS],
      )
      await expect(
        client.query('update pets set species_id = $2, breed_id = $3 where id = $1', [
          PET_ROCKY,
          gato,
          perroBreed.rows[0].id,
        ]),
      ).rejects.toThrow(/foreign key/i)
    })
  })

  // Qué prueba: una raza sin especie no se acepta (MATCH SIMPLE no la evaluaría solo).
  it('rechaza una raza sin especie', async () => {
    await withTransaction(async (client) => {
      const breed = await client.query(
        "select id from breeds where tenant_id = $1 and name = 'Xoloitzcuintle'",
        [TENANT_PATITAS],
      )
      await expect(
        client.query('update pets set species_id = null, breed_id = $2 where id = $1', [
          PET_ROCKY,
          breed.rows[0].id,
        ]),
      ).rejects.toThrow(/pets_breed_requires_species/i)
    })
  })

  // Qué prueba: las mascotas de la semilla quedaron enlazadas a perro/gato y a su raza.
  it('las mascotas de la semilla quedaron enlazadas al catálogo', async () => {
    const { rows } = await asUser(USER_DUENO, (c) =>
      c.query(
        `select p.name, s.name as species, b.name as breed
         from pets p
         left join species s on s.id = p.species_id
         left join breeds b on b.id = p.breed_id
         where p.id = $1`,
        [PET_ROCKY],
      ),
    )
    expect(rows[0]).toMatchObject({ species: 'Perro', breed: 'Labrador' })
  })
})
