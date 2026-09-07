// Prueba la Edge Function public-pet-view (tareas 7.5-7.9) contra
// Supabase LOCAL de verdad — no se puede probar con `pg` porque no es una
// consulta a Postgres, es una petición HTTP a otro proceso (Deno). Se le
// llama con `fetch()`, exactamente como la haría el navegador de un
// dueño de mascota abriendo `/c/:token`.
import { afterAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { createHash, randomBytes } from 'node:crypto'
import { execSync } from 'node:child_process'

import { asAnon, closePool } from './helpers'
import {
  PET_BRUNO,
  PET_ROCKY,
  TENANT_HUELLITAS,
  TENANT_PATITAS,
  USER_DUENO,
} from './fixtures'

const FUNCTIONS_URL = 'http://127.0.0.1:54321/functions/v1/public-pet-view'

/**
 * La Edge Function usa `@supabase/server` (tarea 7.4), que exige el
 * formato NUEVO de llave (`sb_publishable_...`) — la `ANON_KEY` clásica
 * (un JWT) que sí usan PostgREST y supabase-js NO sirve aquí. A
 * diferencia del `ANON_KEY` clásico (CLAUDE.md: "la misma para cualquier
 * proyecto Supabase local"), no hay garantía de que esta llave nueva sea
 * idéntica en cada máquina — se lee de `supabase status` en vez de
 * dejarla fija en el archivo (misma lección de `.github/workflows/ci.yml`,
 * fase 6: un valor fijo que "siempre funcionó en mi Mac" es exactamente
 * el tipo de cosa que puede tronar en un runner distinto).
 */
function readPublishableKey(): string {
  const output = execSync('supabase status -o env', { encoding: 'utf-8' })
  const match = output.match(/^PUBLISHABLE_KEY="(.+)"$/m)
  if (!match) {
    throw new Error('No se encontró PUBLISHABLE_KEY en "supabase status -o env".')
  }
  return match[1]
}

const PUBLISHABLE_KEY = readPublishableKey()

const { Pool } = pg
const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' })

afterAll(async () => {
  await pool.end()
  await closePool()
})

function generateTokenPair(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  const hash = createHash('sha256').update(token).digest('hex')
  return { token, hash }
}

interface SeedLinkOptions {
  tenantId: string
  petId: string
  expiresAt?: Date
  revokedAt?: Date | null
}

/** Inserta un share_link de verdad (service_role) y devuelve el token EN CLARO. */
async function seedShareLink(options: SeedLinkOptions): Promise<{ id: string; token: string }> {
  const { token, hash } = generateTokenPair()
  const client = await pool.connect()
  try {
    await client.query('set role service_role')
    const { rows } = await client.query(
      `insert into share_links (tenant_id, scope, pet_id, token_hash, token_prefix, expires_at, revoked_at, created_by)
       values ($1, 'pet', $2, $3, $4, $5, $6, $7)
       returning id`,
      [
        options.tenantId,
        options.petId,
        hash,
        token.slice(0, 8),
        (options.expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)).toISOString(),
        options.revokedAt ? options.revokedAt.toISOString() : null,
        USER_DUENO,
      ],
    )
    return { id: rows[0].id, token }
  } finally {
    await client.query('reset role')
    client.release()
  }
}

async function readAccessStats(
  id: string,
): Promise<{ access_count: number; last_accessed_at: string | null }> {
  const client = await pool.connect()
  try {
    await client.query('set role service_role')
    const { rows } = await client.query(
      'select access_count, last_accessed_at from share_links where id = $1',
      [id],
    )
    return rows[0]
  } finally {
    await client.query('reset role')
    client.release()
  }
}

async function hardDeleteShareLink(id: string): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('set role service_role')
    await client.query('delete from share_links where id = $1', [id])
  } finally {
    await client.query('reset role')
    client.release()
  }
}

interface CallResult {
  status: number
  body: Record<string, unknown>
}

async function callPublicPetView(payload: Record<string, unknown>): Promise<CallResult> {
  const res = await fetch(FUNCTIONS_URL, {
    method: 'POST',
    headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return { status: res.status, body: await res.json() }
}

describe('public-pet-view: token válido (tarea 7.5)', () => {
  it('devuelve exactamente esa mascota, con la lista blanca de campos', async () => {
    const { id, token } = await seedShareLink({ tenantId: TENANT_PATITAS, petId: PET_ROCKY })
    try {
      const { status, body } = await callPublicPetView({ token })

      expect(status).toBe(200)
      expect(body.pet).toMatchObject({ name: 'Rocky', species: 'dog' })
    } finally {
      await hardDeleteShareLink(id)
    }
  })
})

describe('public-pet-view: registro de acceso (tarea 7.10)', () => {
  it('un uso válido incrementa access_count y actualiza last_accessed_at', async () => {
    const { id, token } = await seedShareLink({ tenantId: TENANT_PATITAS, petId: PET_ROCKY })
    try {
      const before = await readAccessStats(id)
      expect(before.access_count).toBe(0)
      expect(before.last_accessed_at).toBeNull()

      const { status } = await callPublicPetView({ token })
      expect(status).toBe(200)

      const after = await readAccessStats(id)
      expect(after.access_count).toBe(1)
      expect(after.last_accessed_at).not.toBeNull()
    } finally {
      await hardDeleteShareLink(id)
    }
  })

  it('un intento con token inválido NO cuenta como acceso', async () => {
    const { id, token } = await seedShareLink({
      tenantId: TENANT_PATITAS,
      petId: PET_ROCKY,
      revokedAt: new Date(),
    })
    try {
      await callPublicPetView({ token })

      const after = await readAccessStats(id)
      expect(after.access_count).toBe(0)
    } finally {
      await hardDeleteShareLink(id)
    }
  })
})

describe('public-pet-view: aislamiento (tarea 7.6)', () => {
  it('ignora un pet_id/tenant_id ajeno en el body — usa SIEMPRE el del link', async () => {
    const { id, token } = await seedShareLink({ tenantId: TENANT_PATITAS, petId: PET_ROCKY })
    try {
      // Intento de "escape": el token es de Rocky (Patitas), pero el
      // cuerpo pide la mascota de Huellitas Spa. Si la función leyera el
      // pet_id/tenant_id del body en vez del link, esto devolvería a
      // Bruno — la fuga entre tenants que este diseño existe para evitar.
      const { status, body } = await callPublicPetView({
        token,
        pet_id: PET_BRUNO,
        tenant_id: TENANT_HUELLITAS,
      })

      expect(status).toBe(200)
      expect(body.pet).toMatchObject({ name: 'Rocky' })
    } finally {
      await hardDeleteShareLink(id)
    }
  })

  it('un token real de OTRO tenant solo devuelve SU propia mascota, nunca la de Patitas', async () => {
    const { id, token } = await seedShareLink({ tenantId: TENANT_HUELLITAS, petId: PET_BRUNO })
    try {
      const { status, body } = await callPublicPetView({ token })

      expect(status).toBe(200)
      expect(body.pet).toMatchObject({ name: 'Bruno' })
    } finally {
      await hardDeleteShareLink(id)
    }
  })
})

describe('public-pet-view: casos inválidos, todos con la MISMA respuesta (tarea 7.7)', () => {
  it('token revocado, expirado, inexistente y malformado dan exactamente el mismo 404 genérico', async () => {
    const revokedLink = await seedShareLink({
      tenantId: TENANT_PATITAS,
      petId: PET_ROCKY,
      revokedAt: new Date(),
    })
    const expiredLink = await seedShareLink({
      tenantId: TENANT_PATITAS,
      petId: PET_ROCKY,
      expiresAt: new Date(Date.now() - 1000),
    })

    try {
      const revoked = await callPublicPetView({ token: revokedLink.token })
      const expired = await callPublicPetView({ token: expiredLink.token })
      const inexistente = await callPublicPetView({ token: 'un-token-que-nunca-existio' })
      const malformado = await callPublicPetView({})

      // Ninguno revela CUÁL fue el problema — status y cuerpo idénticos
      // en los cuatro casos, para que adivinar por ensayo y error no
      // sirva de nada.
      for (const result of [revoked, expired, inexistente, malformado]) {
        expect(result.status).toBe(404)
        expect(result.body).toEqual(revoked.body)
      }
    } finally {
      await hardDeleteShareLink(revokedLink.id)
      await hardDeleteShareLink(expiredLink.id)
    }
  })
})

describe('public-pet-view: forma exacta de la respuesta (tarea 7.8)', () => {
  it('el cuerpo de la respuesta no trae más campos que la lista blanca', async () => {
    const { id, token } = await seedShareLink({ tenantId: TENANT_PATITAS, petId: PET_ROCKY })
    try {
      const { body } = await callPublicPetView({ token })

      expect(Object.keys(body).sort()).toEqual(
        [
          'businessName',
          'businessTimezone',
          'pet',
          'upcomingAppointments',
          'vaccinations',
          'visits',
        ].sort(),
      )
      expect(Object.keys(body.pet as Record<string, unknown>).sort()).toEqual(
        ['birthDate', 'breed', 'name', 'photoUrl', 'sex', 'species'].sort(),
      )
    } finally {
      await hardDeleteShareLink(id)
    }
  })
})

describe('public-pet-view: anon sigue sin poder leer ninguna tabla directamente (tarea 7.9)', () => {
  // Regresión de la tarea 1.23, ampliada a TODAS las tablas de negocio
  // que existen hasta la fase 7 — la vista pública nunca debe necesitar
  // que `anon` tenga permiso directo sobre ninguna de ellas.
  const businessTables = [
    'tenants',
    'branches',
    'profiles',
    'memberships',
    'membership_branches',
    'customers',
    'pets',
    'pet_weights',
    'services',
    'appointments',
    'appointment_services',
    'grooming_records',
    'medical_records',
    'vaccines',
    'vaccinations',
    'sales',
    'sale_items',
    'payments',
    'invoice_requests',
    'share_links',
    'audit_log',
  ]

  it.each(businessTables)('anon no ve ninguna fila de "%s"', async (table) => {
    const { rows } = await asAnon((c) => c.query(`select 1 from ${table} limit 1`))
    expect(rows).toHaveLength(0)
  })
})
