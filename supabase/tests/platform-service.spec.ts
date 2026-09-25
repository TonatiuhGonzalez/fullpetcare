// Prueba services/platform.ts (fase 10, tarea 10.7) contra Supabase LOCAL de
// verdad, con el mismo cliente que usa la app (`@/services/supabase`) y
// sesiones reales de Auth — igual que customers-service.spec.ts, pero aquí
// además se llama a la Edge Function platform-admin (REQUIERE `supabase
// functions serve` corriendo).
//
// Qué aporta esta capa y por eso se prueba (las RPC y la función ya tienen
// sus propios tests): (1) que las respuestas se conviertan a los tipos de
// dominio (`camelCase`, `null` donde corresponde, números y no cadenas),
// (2) que los errores lleguen a la UI en español y sin jerga técnica
// (CLAUDE.md §5.4), y (3) que un servicio caído se distinga de un error de
// negocio.
//
// La limpieza de lo que crean estos tests está explicada en
// platform-test-helpers.ts.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { FunctionsHttpError } from '@supabase/supabase-js'

import { supabase } from '@/services/supabase'
import {
  addAdmin,
  createTenant,
  getTenantMetrics,
  isPlatformAdmin,
  listAdmins,
  listAuditLog,
  listTenants,
  removeAdmin,
  resetOwnerPassword,
  setTenantStatus,
  updateTenantNotes,
} from '@/services/platform'
import { closePool, runCommitted } from './helpers'
import { NONEXISTENT_UUID, TENANT_PATITAS, USER_DUENO, USER_SUPERADMIN_DEMO } from './fixtures'
import {
  adminClient,
  cleanupPlatformTestData,
  created,
  createScratchTenant,
  createSuperadmin,
  uniqueEmail,
} from './platform-test-helpers'

afterAll(closePool)

afterEach(async () => {
  vi.restoreAllMocks()
  await supabase.auth.signOut()
  await cleanupPlatformTestData()
})

/**
 * Reemplaza la respuesta de `supabase.functions.invoke` por `result`.
 *
 * `supabase.functions` es un getter que construye un cliente NUEVO en cada
 * acceso, así que `vi.spyOn(supabase.functions, 'invoke')` se aplicaría a un
 * objeto que se descarta al instante y la llamada real saldría igual. Se
 * espía el getter mismo para que todo acceso devuelva el falso.
 */
function mockFunctionsInvoke(result: { data: null; error: unknown }) {
  vi.spyOn(supabase, 'functions', 'get').mockReturnValue({
    invoke: vi.fn().mockResolvedValue(result),
  } as unknown as typeof supabase.functions)
}

/** Crea un superadmin real y deja la sesión de `supabase` iniciada con él. */
async function signInAsSuperadmin() {
  const admin = await createSuperadmin()
  const { error } = await supabase.auth.signInWithPassword({
    email: admin.email,
    password: 'Demo1234!',
  })
  if (error) throw error
  return admin
}

async function signInAsSeedOwner() {
  const { error } = await supabase.auth.signInWithPassword({
    email: 'dueno@patitasfelices.mx',
    password: 'Demo1234!',
  })
  if (error) throw error
}

describe('isPlatformAdmin', () => {
  it('true para un superadmin, false para un dueño de negocio', async () => {
    // Es lo que decide si la app muestra /superadmin. Si un dueño recibiera
    // true, vería un panel al que las RPC igual le negarían todo — pero
    // también sería la primera señal de que RLS de platform_admins se abrió.
    const admin = await signInAsSuperadmin()
    expect(await isPlatformAdmin(admin.userId)).toBe(true)

    await supabase.auth.signOut()
    await signInAsSeedOwner()
    expect(await isPlatformAdmin(USER_DUENO)).toBe(false)
  })

  it('false para un superadmin al que ya se le quitó el acceso', async () => {
    // Quitar a un superadmin (deleted_at) debe apagar el panel en su
    // siguiente carga, aunque la fila siga existiendo.
    const admin = await signInAsSuperadmin()
    // Se marca como quitado con service_role: mientras siga siendo admin
    // activo la política le deja ver su fila.
    await adminClient
      .from('platform_admins')
      .update({ deleted_at: new Date().toISOString() })
      .eq('user_id', admin.userId)

    expect(await isPlatformAdmin(admin.userId)).toBe(false)
  })
})

describe('listTenants', () => {
  it('devuelve las empresas en tipos de dominio: camelCase, vigencia null = indefinida, dueño con su correo', async () => {
    // La pantalla depende de estos nombres y de los `null`: si una
    // columna llegara como `owner_name` (snake_case) el tipo TypeScript no
    // la encontraría, y si "sin vigencia" llegara como cadena vacía la UI
    // mostraría una fecha inválida en lugar de "Indefinida".
    await signInAsSuperadmin()

    const tenants = await listTenants()

    const patitas = tenants.find((t) => t.id === TENANT_PATITAS)
    expect(patitas).toEqual({
      id: TENANT_PATITAS,
      name: 'Patitas Felices',
      createdAt: expect.any(String),
      plan: 'Básico',
      planExpiresAt: null,
      status: 'active',
      statusReason: null,
      internalNotes: null,
      ownerUserId: USER_DUENO,
      ownerName: 'Fernanda Ruiz Gómez',
      ownerEmail: 'dueno@patitasfelices.mx',
      ownerPhone: null,
    })
  })

  it('a un dueño de negocio le llega el mensaje de "sin permiso" en español', async () => {
    // Es un error que NOSOTROS escribimos en la RPC (código 42501): se
    // muestra tal cual. Si el servicio lo cambiara por un mensaje genérico,
    // el usuario no sabría que el problema es de permisos.
    await signInAsSeedOwner()
    await expect(listTenants()).rejects.toThrow('No tienes permiso para administrar la plataforma.')
  })

  it('sin sesión, el error técnico de Postgres NO llega a la pantalla', async () => {
    // Sin sesión Postgres responde "permission denied for function ..."
    // (inglés, técnico, también código 42501). CLAUDE.md §5.4 prohíbe
    // mostrarlo: el servicio lo reemplaza por un mensaje genérico. Este es
    // el caso que distingue "42501 nuestro" de "42501 de Postgres".
    await supabase.auth.signOut()
    const result = await listTenants().then(
      () => null,
      (e: Error) => e.message,
    )
    expect(result).not.toBeNull()
    expect(result).not.toMatch(/permission denied|function|row-level/i)
  })
})

describe('getTenantMetrics', () => {
  it('devuelve números (no cadenas) y el último acceso como fecha o null', async () => {
    // PostgREST entrega los `bigint` según cómo se serialicen; si llegaran
    // como cadenas, la pantalla haría "6" + 1 = "61" al sumarlos. Se
    // comprueba el tipo real, no solo el valor.
    await signInAsSuperadmin()

    const metrics = await getTenantMetrics(TENANT_PATITAS)

    expect(metrics.branches).toEqual(expect.any(Number))
    expect(metrics.activeEmployees).toEqual(expect.any(Number))
    expect(metrics.customers).toBeGreaterThan(0)
    expect(metrics.pets).toBeGreaterThan(0)
    expect(metrics.appointmentsThisMonth).toEqual(expect.any(Number))
    expect(metrics.lastAccessAt === null || typeof metrics.lastAccessAt === 'string').toBe(true)
  })

  it('una empresa que no existe da un error legible', async () => {
    await signInAsSuperadmin()
    await expect(getTenantMetrics(NONEXISTENT_UUID)).rejects.toThrow('La empresa no existe.')
  })
})

describe('setTenantStatus y updateTenantNotes', () => {
  it('suspender sin motivo se rechaza con el mensaje de la base, en español', async () => {
    // "Indica el motivo." lo escribe la RPC (código 23514). Si el servicio
    // lo tragara y mostrara un error genérico, la persona no sabría qué
    // campo le falta llenar.
    await signInAsSuperadmin()
    const tenantId = await createScratchTenant()
    await expect(setTenantStatus(tenantId, 'suspended', '  ')).rejects.toThrow(
      'Indica el motivo.',
    )
  })

  it('suspender con motivo se refleja en la lista, y reactivar limpia el motivo', async () => {
    await signInAsSuperadmin()
    const tenantId = await createScratchTenant()

    await setTenantStatus(tenantId, 'suspended', 'Falta de pago')
    let scratch = (await listTenants()).find((t) => t.id === tenantId)
    expect(scratch).toMatchObject({ status: 'suspended', statusReason: 'Falta de pago' })

    // `null` como motivo al reactivar: el tipo generado no lo admite pero
    // Postgres sí (ver comentario en platform.ts) — si esa conversión se
    // rompiera, reactivar fallaría en el navegador.
    await setTenantStatus(tenantId, 'active', null)
    scratch = (await listTenants()).find((t) => t.id === tenantId)
    expect(scratch).toMatchObject({ status: 'active', statusReason: null })
  })

  it('las notas se guardan y texto en blanco vuelve a null', async () => {
    await signInAsSuperadmin()
    const tenantId = await createScratchTenant()

    await updateTenantNotes(tenantId, 'Cliente piloto')
    expect((await listTenants()).find((t) => t.id === tenantId)?.internalNotes).toBe(
      'Cliente piloto',
    )

    await updateTenantNotes(tenantId, '   ')
    expect((await listTenants()).find((t) => t.id === tenantId)?.internalNotes).toBeNull()
  })
})

describe('listAuditLog', () => {
  it('trae la bitácora de UNA empresa, con lo más reciente primero y el superadmin como actor', async () => {
    // La pestaña Bitácora depende del orden (lo último arriba) y de quién
    // hizo cada cambio. Si el orden se invirtiera, el superadmin leería la
    // historia al revés.
    const admin = await signInAsSuperadmin()
    const tenantId = await createScratchTenant()
    await updateTenantNotes(tenantId, 'primera nota')
    await setTenantStatus(tenantId, 'suspended', 'segundo cambio')

    const log = await listAuditLog(tenantId)

    const mine = log.filter((e) => e.actorUserId === admin.userId)
    expect(mine).toHaveLength(2)
    expect(mine[0].newData).toMatchObject({ status: 'suspended' }) // el más reciente primero
    expect(mine[1].newData).toMatchObject({ internal_notes: 'primera nota' })
    expect(mine.every((e) => e.tableName === 'tenant_platform_info' && e.action === 'UPDATE')).toBe(
      true,
    )
    // Solo de ESTA empresa: ninguna entrada de otro negocio.
    const other = await listAuditLog(NONEXISTENT_UUID)
    expect(other).toEqual([])
  })
})

describe('Edge Function platform-admin desde el servicio', () => {
  it('createTenant da de alta la empresa y devuelve la contraseña temporal UNA vez', async () => {
    // Prueba de punta a punta del camino que usará el diálogo de alta.
    await signInAsSuperadmin()
    const ownerEmail = uniqueEmail('dueno.servicio')

    const result = await createTenant({
      tenantName: 'Estética Servicio',
      branchName: 'Matriz',
      ownerFullName: 'Ana Servicio',
      ownerEmail,
      ownerPhone: '5512345678',
    })
    created.tenantIds.add(result.tenantId)
    created.userIds.add(result.ownerUserId)

    expect(result.temporaryPassword).toHaveLength(14)
    const listed = (await listTenants()).find((t) => t.id === result.tenantId)
    expect(listed).toMatchObject({
      name: 'Estética Servicio',
      ownerEmail,
      ownerPhone: '5512345678',
    })
  })

  it('un correo ya registrado llega como el mensaje en español de la función, no como "Edge Function returned a non-2xx"', async () => {
    // supabase-js oculta el cuerpo de la respuesta de error de una función
    // detrás de un mensaje genérico en inglés. El servicio lo desenvuelve;
    // si no, la UI mostraría jerga técnica en un caso muy normal (correo
    // repetido).
    await signInAsSuperadmin()
    await expect(
      createTenant({
        tenantName: 'X',
        branchName: 'Y',
        ownerFullName: 'Z',
        ownerEmail: 'dueno@patitasfelices.mx',
        ownerPhone: null,
      }),
    ).rejects.toThrow('Este correo ya está registrado. Usa otro correo.')
  })

  it('resetOwnerPassword devuelve la contraseña nueva y avisa si se cerraron las sesiones', async () => {
    await signInAsSuperadmin()
    const { tenantId, ownerUserId } = await createTenant({
      tenantName: 'Reset Servicio',
      branchName: 'Matriz',
      ownerFullName: 'Dueño Reset',
      ownerEmail: uniqueEmail('dueno.reset.servicio'),
      ownerPhone: null,
    })
    created.tenantIds.add(tenantId)
    created.userIds.add(ownerUserId)

    const result = await resetOwnerPassword(tenantId)

    expect(result.temporaryPassword).toHaveLength(14)
    expect(result.sessionsRevoked).toBe(true)
    expect(result.ownerEmail).toMatch(/dueno\.reset\.servicio/)
  })

  it('una empresa sin dueño: el 404 de LA FUNCIÓN se muestra con su mensaje, no como "servicio no disponible"', async () => {
    // El servicio trata 404 como "el gateway no encontró la función" (texto
    // técnico que se reemplaza). Pero esta función TAMBIÉN responde 404, con
    // un mensaje útil, cuando la empresa no tiene dueño. Este es el caso
    // borde que obliga a mirar el cuerpo y no solo el código de estado.
    await signInAsSuperadmin()
    await runCommitted((client) =>
      client.query("insert into tenants (id, name) values ($1, 'Sin dueño servicio')", [
        NONEXISTENT_UUID,
      ]),
    )
    created.tenantIds.add(NONEXISTENT_UUID)

    await expect(resetOwnerPassword(NONEXISTENT_UUID)).rejects.toThrow(
      'Esta empresa no tiene un dueño activo.',
    )
  })

  it.each([404, 503, 504])(
    'un %s del gateway (función apagada o sin desplegar) se reemplaza por un mensaje accionable',
    async (status) => {
      // En local: `supabase functions serve` apagado; en la nube: función
      // sin desplegar. El gateway responde con texto técnico en inglés que
      // no le sirve a nadie. No se puede apagar el runtime en un test, así
      // que se simula la respuesta del gateway con la clase de error real de
      // supabase-js.
      mockFunctionsInvoke({
        data: null,
        error: new FunctionsHttpError(new Response('name resolution failed', { status })),
      })

      await expect(resetOwnerPassword('x')).rejects.toThrow(
        'El servicio de administración no está disponible en este momento. Intenta más tarde.',
      )
    },
  )

  it('si ni siquiera hay respuesta (sin red), el mensaje sugiere revisar la conexión', async () => {
    mockFunctionsInvoke({ data: null, error: new Error('Failed to fetch') })

    await expect(resetOwnerPassword('x')).rejects.toThrow(
      'No se pudo completar la operación. Revisa tu conexión.',
    )
  })
})

describe('superadmins', () => {
  it('addAdmin crea un superadmin nuevo y listAdmins lo muestra con su correo', async () => {
    const me = await signInAsSuperadmin()
    const email = uniqueEmail('admin.servicio')

    const { userId, temporaryPassword } = await addAdmin({ fullName: 'Admin Servicio', email })
    created.userIds.add(userId)

    expect(temporaryPassword).toHaveLength(14)
    const admins = await listAdmins()
    expect(admins.map((a) => a.email)).toEqual(expect.arrayContaining([me.email, email]))
    expect(admins.find((a) => a.userId === userId)).toMatchObject({
      email,
      fullName: 'Admin Servicio',
    })
  })

  it('removeAdmin quita a uno, y la base impide quitar al ÚLTIMO con su mensaje en español', async () => {
    // "No se puede quitar al único superadmin." (código 23514) debe llegar
    // tal cual: es la explicación de por qué el botón no funcionó.
    const me = await signInAsSuperadmin()
    const { userId } = await addAdmin({
      fullName: 'Admin Temporal',
      email: uniqueEmail('admin.temporal'),
    })
    created.userIds.add(userId)

    await removeAdmin(userId)
    expect((await listAdmins()).map((a) => a.userId)).not.toContain(userId)

    // La semilla trae un superadmin más (USER_SUPERADMIN_DEMO). Para que
    // `me` quede como el ÚNICO, se le quita el acceso con service_role y se
    // le devuelve en el `finally`: este test hace commit de verdad, y dejar
    // sin superadmin sembrado a la base local rompería el login de demo.
    await adminClient
      .from('platform_admins')
      .update({ deleted_at: new Date().toISOString() })
      .eq('user_id', USER_SUPERADMIN_DEMO)
    try {
      await expect(removeAdmin(me.userId)).rejects.toThrow(
        'No se puede quitar al único superadmin.',
      )
    } finally {
      await adminClient
        .from('platform_admins')
        .update({ deleted_at: null })
        .eq('user_id', USER_SUPERADMIN_DEMO)
      // Quitar y devolver el acceso dejó dos entradas de bitácora sin actor
      // (service_role); se borran para no acumularlas en la base local.
      await runCommitted((client) =>
        client.query(
          `delete from platform_audit_log
           where table_name = 'platform_admins' and action = 'UPDATE'
             and new_data ->> 'user_id' = $1`,
          [USER_SUPERADMIN_DEMO],
        ),
      )
    }
  })
})
