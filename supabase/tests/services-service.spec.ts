// Prueba services/services.ts (tarea 3.9) — sesión real, mismo patrón
// que customers-service.spec.ts.
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import pg from 'pg'

import * as servicesService from '@/services/services'
import { supabase } from '@/services/supabase'

import { TENANT_PATITAS } from './fixtures'

const DUENO_EMAIL = 'dueno@patitasfelices.mx'
const DUENO_PASSWORD = 'Demo1234!'
const RECEPCION_EMAIL = 'recepcion@patitasfelices.mx'
const RECEPCION_PASSWORD = 'Demo1234!'

const { Pool } = pg
const cleanupPool = new Pool({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})

async function hardDeleteServices(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const client = await cleanupPool.connect()
  try {
    await client.query('set role service_role')
    await client.query('delete from services where id = any($1::uuid[])', [ids])
  } finally {
    await client.query('reset role')
    client.release()
  }
}

afterAll(() => cleanupPool.end())

describe('services/services.ts contra Supabase local', () => {
  const createdIds: string[] = []

  afterEach(async () => {
    await supabase.auth.signOut()
    await hardDeleteServices(createdIds)
    createdIds.length = 0
  })

  it('el dueño puede dar de alta un servicio nuevo', async () => {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (signInError) throw signInError

    const created = await servicesService.create({
      tenant_id: TENANT_PATITAS,
      kind: 'grooming',
      name: 'Servicio de prueba',
      duration_minutes: 45,
      price_cents: 30000,
      tax_rate_bp: 1600,
    })
    createdIds.push(created.id)

    expect(created.name).toBe('Servicio de prueba')
  })

  it('recepción NO puede dar de alta un servicio (es configuración del negocio, solo owner)', async () => {
    // CLAUDE.md §6.1 no le da esto a receptionist — a diferencia de
    // clientes/mascotas, el catálogo es exclusivo del dueño.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: RECEPCION_EMAIL,
      password: RECEPCION_PASSWORD,
    })
    if (signInError) throw signInError

    await expect(
      servicesService.create({
        tenant_id: TENANT_PATITAS,
        kind: 'grooming',
        name: 'No debería crearse',
        duration_minutes: 30,
        price_cents: 10000,
        tax_rate_bp: 1600,
      }),
    ).rejects.toThrow()
  })

  it('listByKind separa estética de veterinaria', async () => {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (signInError) throw signInError

    const grooming = await servicesService.listByKind(TENANT_PATITAS, 'grooming')
    const veterinary = await servicesService.listByKind(TENANT_PATITAS, 'veterinary')

    expect(grooming.every((s) => s.kind === 'grooming')).toBe(true)
    expect(veterinary.every((s) => s.kind === 'veterinary')).toBe(true)
    expect(grooming.some((s) => s.name === 'Baño')).toBe(true)
    expect(veterinary.some((s) => s.name === 'Consulta general')).toBe(true)
  })

  it('setActive(false) apaga is_active pero el servicio sigue en listByKind', async () => {
    // "Desactivar" no es borrar (CLAUDE.md, migración services.sql): las
    // citas viejas que usaron este servicio necesitan que siga
    // existiendo, solo ya no se ofrece para agendar una cita nueva. Si
    // el switch borrara la fila, esas citas perderían su servicio.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (signInError) throw signInError

    const created = await servicesService.create({
      tenant_id: TENANT_PATITAS,
      kind: 'veterinary',
      name: 'Servicio a desactivar',
      duration_minutes: 20,
      price_cents: 15000,
      tax_rate_bp: 1600,
    })
    createdIds.push(created.id)

    await servicesService.setActive(created.id, false)

    const list = await servicesService.listByKind(TENANT_PATITAS, 'veterinary')
    const found = list.find((s) => s.id === created.id)
    expect(found).toBeDefined()
    expect(found?.is_active).toBe(false)
  })

  it('setActive(true) reactiva un servicio desactivado', async () => {
    // Con el checkbox fuera del dialog, el switch de CatalogPage es la
    // ÚNICA forma de reactivar. Si esto fallara, un servicio desactivado
    // por error quedaría fuera del agendado para siempre.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (signInError) throw signInError

    const created = await servicesService.create({
      tenant_id: TENANT_PATITAS,
      kind: 'veterinary',
      name: 'Servicio a reactivar',
      duration_minutes: 20,
      price_cents: 15000,
      tax_rate_bp: 1600,
    })
    createdIds.push(created.id)

    await servicesService.setActive(created.id, false)
    await servicesService.setActive(created.id, true)

    const list = await servicesService.listByKind(TENANT_PATITAS, 'veterinary')
    expect(list.find((s) => s.id === created.id)?.is_active).toBe(true)
  })

  it('un servicio sin claves del SAT recibe las sugeridas por defecto', async () => {
    // Las claves son NOT NULL con default: el servicio nuevo (o el que ya
    // existía antes de la migración) nunca queda sin clave. Si faltara el
    // default, el alta de servicios fallaría en toda la app.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (signInError) throw signInError

    const created = await servicesService.create({
      tenant_id: TENANT_PATITAS,
      kind: 'grooming',
      name: 'Servicio con claves por defecto',
      duration_minutes: 30,
      price_cents: 10000,
      tax_rate_bp: 1600,
    })
    createdIds.push(created.id)

    expect(created.sat_product_code).toBe('70122000')
    expect(created.sat_unit_code).toBe('E48')
  })

  it('la base rechaza una clave del SAT con formato imposible', async () => {
    // El check de la tabla es la defensa final: aunque la UI se salte la
    // validación, una clave de 7 dígitos no puede llegar a una factura.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (signInError) throw signInError

    await expect(
      servicesService.create({
        tenant_id: TENANT_PATITAS,
        kind: 'grooming',
        name: 'Servicio con clave mala',
        duration_minutes: 30,
        price_cents: 10000,
        tax_rate_bp: 1600,
        sat_product_code: '1234567',
      }),
    ).rejects.toMatchObject({ code: '23514' })

    await expect(
      servicesService.create({
        tenant_id: TENANT_PATITAS,
        kind: 'grooming',
        name: 'Servicio con unidad mala',
        duration_minutes: 30,
        price_cents: 10000,
        tax_rate_bp: 1600,
        sat_unit_code: 'e48',
      }),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('remove() oculta el servicio del catálogo pero la fila sigue existiendo', async () => {
    // Borrado suave (CLAUDE.md §8.5): si remove() borrara la fila de verdad, las
    // citas y ventas que usaron el servicio perderían su vínculo (o la base
    // rechazaría el borrado). Aquí verificamos que solo se marca deleted_at.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (signInError) throw signInError

    const created = await servicesService.create({
      tenant_id: TENANT_PATITAS,
      kind: 'grooming',
      name: 'Servicio a eliminar',
      duration_minutes: 30,
      price_cents: 12000,
      tax_rate_bp: 1600,
    })
    createdIds.push(created.id)

    await servicesService.remove(created.id)

    const list = await servicesService.listByKind(TENANT_PATITAS, 'grooming')
    expect(list.some((s) => s.id === created.id)).toBe(false)
    const { data } = await supabase
      .from('services')
      .select('deleted_at')
      .eq('id', created.id)
    expect(data?.[0]?.deleted_at).not.toBeNull()
  })

  it('recepción NO puede eliminar un servicio', async () => {
    // Eliminar es configuración del negocio, solo owner: sin esto, cualquier
    // recepcionista podría vaciar el catálogo llamando a la API directo. RLS
    // responde con 0 filas afectadas, así que el servicio debe seguir visible.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: RECEPCION_EMAIL,
      password: RECEPCION_PASSWORD,
    })
    if (signInError) throw signInError

    const before = await servicesService.listByKind(TENANT_PATITAS, 'grooming')
    const target = before.find((s) => s.name === 'Baño')
    if (!target) throw new Error('falta el servicio Baño de la semilla')

    await servicesService.remove(target.id)

    const after = await servicesService.listByKind(TENANT_PATITAS, 'grooming')
    expect(after.some((s) => s.id === target.id)).toBe(true)
  })

  it('findDeletedByName encuentra el eliminado sin importar mayúsculas, solo del mismo tipo', async () => {
    // Es lo que dispara el aviso "ya existía". Si distinguiera mayúsculas, "baño"
    // crearía un duplicado; si ignorara el tipo, reactivaría uno de otra categoría.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (signInError) throw signInError

    const created = await servicesService.create({
      tenant_id: TENANT_PATITAS,
      kind: 'grooming',
      name: 'Spa de prueba',
      duration_minutes: 30,
      price_cents: 12000,
      tax_rate_bp: 1600,
    })
    createdIds.push(created.id)
    await servicesService.remove(created.id)

    const found = await servicesService.findDeletedByName(
      TENANT_PATITAS,
      'grooming',
      '  SPA DE PRUEBA ',
    )
    expect(found?.id).toBe(created.id)
    expect(
      await servicesService.findDeletedByName(
        TENANT_PATITAS,
        'veterinary',
        'Spa de prueba',
      ),
    ).toBeNull()
    // Los comodines de ilike no deben coincidir con cualquier cosa.
    expect(
      await servicesService.findDeletedByName(TENANT_PATITAS, 'grooming', '%'),
    ).toBeNull()
  })

  it('restore() reactiva el eliminado con los datos nuevos y el mismo id', async () => {
    // Reusar el mismo id mantiene ligado el historial. Si en vez de eso se creara
    // una fila nueva, habría dos servicios con el mismo nombre.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (signInError) throw signInError

    const created = await servicesService.create({
      tenant_id: TENANT_PATITAS,
      kind: 'grooming',
      name: 'Servicio a reactivar',
      duration_minutes: 30,
      price_cents: 12000,
      tax_rate_bp: 1600,
    })
    createdIds.push(created.id)
    await servicesService.remove(created.id)

    const restored = await servicesService.restore(created.id, {
      duration_minutes: 50,
      price_cents: 20000,
    })

    expect(restored.id).toBe(created.id)
    expect(restored.deleted_at).toBeNull()
    expect(restored.is_active).toBe(true)
    expect(restored.price_cents).toBe(20000)
    const list = await servicesService.listByKind(TENANT_PATITAS, 'grooming')
    expect(list.some((s) => s.id === created.id)).toBe(true)
  })
})
