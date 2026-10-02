// Configuración fiscal del negocio (tarea 11.15, migración
// tenant_invoicing_settings.sql). Cubre tres cosas que se rompen en silencio:
//   1. QUIÉN lee y escribe el estado del PAC (solo el dueño lee; nadie
//      escribe desde el navegador: lo escribe la Edge Function),
//   2. la RPC update_tenant_fiscal_data (solo dueño, valida formas),
//   3. can_manage_invoicing, la pregunta que usa la Edge Function.
import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import { closePool, setRole, withTransaction } from './helpers'
import {
  TENANT_HUELLITAS,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
} from './fixtures'

afterAll(closePool)

// Deja una fila de configuración como la dejaría la Edge Function (service_role).
async function seedSettings(client: PoolClient, tenantId: string): Promise<void> {
  await setRole(client, 'service_role')
  await client.query(
    `insert into tenant_invoicing_settings (tenant_id, pac_organization_id, csd_valid_until)
     values ($1, 'org_test', '2030-01-01')`,
    [tenantId],
  )
}

const VALID = ['PFE120515AB1', 'Patitas Felices SA de CV', '601', '97000']

describe('tenant_invoicing_settings: lectura y escritura', () => {
  it('el dueño ve la configuración de su negocio', async () => {
    // Si fallara, la pantalla no podría mostrar si el certificado está vigente.
    await withTransaction(async (client) => {
      await seedSettings(client, TENANT_PATITAS)
      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query(
        'select pac_organization_id from tenant_invoicing_settings',
      )
      expect(rows).toHaveLength(1)
    })
  })

  it('recepción y groomer NO la ven', async () => {
    // Es información de facturación del negocio: solo del dueño.
    await withTransaction(async (client) => {
      await seedSettings(client, TENANT_PATITAS)
      for (const user of [USER_RECEPCION, USER_GROOMER]) {
        await setRole(client, 'authenticated', user)
        const { rows } = await client.query('select 1 from tenant_invoicing_settings')
        expect(rows).toHaveLength(0)
      }
    })
  })

  it('aislamiento: el dueño de Patitas no ve la de Huellitas Spa', async () => {
    await withTransaction(async (client) => {
      await seedSettings(client, TENANT_HUELLITAS)
      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query('select 1 from tenant_invoicing_settings')
      expect(rows).toHaveLength(0)
    })
  })

  it('ni el dueño puede escribirla desde el navegador', async () => {
    // Si pudiera, marcaría "certificado vigente hasta 2099" sin subir nada.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      await expect(
        client.query(
          `insert into tenant_invoicing_settings (tenant_id, csd_valid_until) values ($1, '2099-01-01')`,
          [TENANT_PATITAS],
        ),
      ).rejects.toThrow(/row-level security/i)
    })
  })

  it('anon no ve nada', async () => {
    // CLAUDE.md §7.3.3: sin política para anon (RLS forzado) devuelve 0 filas.
    // Si alguien agregara una política abierta por error, este test falla.
    await withTransaction(async (client) => {
      await seedSettings(client, TENANT_PATITAS)
      await setRole(client, 'anon')
      const { rows } = await client.query('select 1 from tenant_invoicing_settings')
      expect(rows).toHaveLength(0)
    })
  })
})

describe('update_tenant_fiscal_data', () => {
  it('el dueño guarda sus datos fiscales (RFC en mayúsculas)', async () => {
    // El camino feliz de la pantalla. Se normaliza el RFC porque el PAC lo
    // rechaza en minúsculas.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      await client.query('select update_tenant_fiscal_data($1, $2, $3, $4, $5)', [
        TENANT_PATITAS,
        ' pfe120515ab1 ',
        ...VALID.slice(1),
      ])
      const { rows } = await client.query(
        'select rfc, legal_name, tax_regime_code, postal_code from tenants where id = $1',
        [TENANT_PATITAS],
      )
      expect(rows[0]).toEqual({
        rfc: 'PFE120515AB1',
        legal_name: 'Patitas Felices SA de CV',
        tax_regime_code: '601',
        postal_code: '97000',
      })
    })
  })

  it('recepción no puede cambiar los datos fiscales', async () => {
    // Cambiar el RFC cambia a nombre de quién se factura: solo el dueño.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_RECEPCION)
      await expect(
        client.query('select update_tenant_fiscal_data($1, $2, $3, $4, $5)', [
          TENANT_PATITAS,
          ...VALID,
        ]),
      ).rejects.toThrow(/solo el dueño/i)
    })
  })

  it('el dueño de otro negocio no puede tocar el de Patitas', async () => {
    // Huellitas no tiene personal en la semilla: ningún usuario es dueño ahí.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      await expect(
        client.query('select update_tenant_fiscal_data($1, $2, $3, $4, $5)', [
          TENANT_HUELLITAS,
          ...VALID,
        ]),
      ).rejects.toThrow(/solo el dueño/i)
    })
  })

  it.each([
    ['RFC mal formado', ['XYZ', VALID[1], VALID[2], VALID[3]], /RFC/],
    ['razón social vacía', [VALID[0], '  ', VALID[2], VALID[3]], /razón social/],
    ['régimen fuera de catálogo', [VALID[0], VALID[1], '999', VALID[3]], /régimen/],
    [
      'código postal de 4 dígitos',
      [VALID[0], VALID[1], VALID[2], '9700'],
      /código postal/,
    ],
  ])('rechaza %s', async (_name, args, message) => {
    // La pantalla ya valida, pero la API se puede llamar directo: la base es
    // la última barrera antes de que un dato malo llegue al PAC.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      await expect(
        client.query('select update_tenant_fiscal_data($1, $2, $3, $4, $5)', [
          TENANT_PATITAS,
          ...args,
        ]),
      ).rejects.toThrow(message)
    })
  })

  it('cambiar el RFC borra la vigencia del certificado; cambiar otro dato no', async () => {
    // Un certificado se emite para UN RFC: con RFC nuevo el viejo no sirve y
    // no debe seguir marcando "listo para facturar". El borde contrario: un
    // cambio de domicilio NO debe obligar a pedir otro certificado.
    await withTransaction(async (client) => {
      await seedSettings(client, TENANT_PATITAS)
      await setRole(client, 'authenticated', USER_DUENO)
      const csd = async () =>
        (await client.query('select csd_valid_until from tenant_invoicing_settings'))
          .rows[0].csd_valid_until

      await client.query('select update_tenant_fiscal_data($1, $2, $3, $4, $5)', [
        TENANT_PATITAS,
        'PFE120515AB1',
        'Patitas Felices SA de CV',
        '601',
        '97000',
      ])
      // Primera captura: el RFC de la semilla puede ser otro, así que se
      // vuelve a poner el certificado y se cambia SOLO el código postal.
      await setRole(client, 'service_role')
      await client.query(
        `update tenant_invoicing_settings set csd_valid_until = '2030-01-01'`,
      )
      await setRole(client, 'authenticated', USER_DUENO)
      await client.query('select update_tenant_fiscal_data($1, $2, $3, $4, $5)', [
        TENANT_PATITAS,
        'PFE120515AB1',
        'Patitas Felices SA de CV',
        '601',
        '97100',
      ])
      expect(await csd()).not.toBeNull()

      await client.query('select update_tenant_fiscal_data($1, $2, $3, $4, $5)', [
        TENANT_PATITAS,
        'ABC010101AA1',
        'Patitas Felices SA de CV',
        '601',
        '97100',
      ])
      expect(await csd()).toBeNull()
    })
  })
})

describe('can_manage_invoicing', () => {
  it('true para el dueño; false para recepción y para un negocio ajeno', async () => {
    // La Edge Function confía en esta respuesta antes de gastar una llamada
    // al PAC: si diera true de más, cualquiera configuraría la facturación.
    await withTransaction(async (client) => {
      const ask = async (user: string, tenant: string) =>
        (await client.query('select can_manage_invoicing($1) as ok', [tenant])).rows[0].ok
      await setRole(client, 'authenticated', USER_DUENO)
      expect(await ask(USER_DUENO, TENANT_PATITAS)).toBe(true)
      expect(await ask(USER_DUENO, TENANT_HUELLITAS)).toBe(false)
      await setRole(client, 'authenticated', USER_RECEPCION)
      expect(await ask(USER_RECEPCION, TENANT_PATITAS)).toBe(false)
    })
  })

  it('false si el negocio está suspendido (solo lectura)', async () => {
    // La función escribe con service_role y se saltaría el bloqueo de §6.8;
    // esta pregunta lo repite a mano.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query(
        `update tenant_platform_info set status = 'suspended' where tenant_id = $1`,
        [TENANT_PATITAS],
      )
      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query('select can_manage_invoicing($1) as ok', [
        TENANT_PATITAS,
      ])
      expect(rows[0].ok).toBe(false)
    })
  })
})
