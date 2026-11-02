/* eslint-disable @typescript-eslint/no-explicit-any */
// Prueba la Edge Function customer-account (fase 16B) contra Supabase LOCAL de verdad, por HTTP,
// como la llamaría el navegador de un dueño de mascota. Requiere `supabase functions serve`.
//
// El recorrido completo usa el correo de verdad del stack local (Mailpit/Inbucket, :54324): se
// pide el código, se lee del buzón y se canjea, igual que haría una persona.
import { randomBytes, createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { PET_ROCKY, TENANT_PATITAS, USER_DUENO } from './fixtures'

const BASE = 'http://127.0.0.1:54321'
const FN = `${BASE}/functions/v1/customer-account`
const MAIL = 'http://127.0.0.1:54324/api/v1'

const KEY = (() => {
  const out = execSync('supabase status -o env', { encoding: 'utf-8' })
  const m = out.match(/^PUBLISHABLE_KEY="(.+)"$/m)
  if (!m) throw new Error('No se encontró PUBLISHABLE_KEY.')
  return m[1]
})()

const pool = new pg.Pool({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})
afterAll(() => pool.end())

async function call(body: unknown, jwt?: string) {
  const res = await fetch(FN, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: KEY,
      authorization: `Bearer ${jwt ?? KEY}`,
    },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json().catch(() => null)) as any }
}

async function seedLink(): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  const hash = createHash('sha256').update(token).digest('hex')
  await pool.query(
    `insert into share_links (tenant_id, scope, pet_id, token_hash, token_prefix, expires_at, created_by)
     values ($1, 'pet', $2, $3, $4, now() + interval '1 day', $5)`,
    [TENANT_PATITAS, PET_ROCKY, hash, token.slice(0, 8), USER_DUENO],
  )
  return token
}

async function codeFor(email: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(`${MAIL}/messages`)).json()
    const msg = list.messages?.find((m: any) =>
      m.To?.some((t: any) => t.Address === email),
    )
    if (msg) {
      const full = await (await fetch(`${MAIL}/message/${msg.ID}`)).json()
      const found = String(full.HTML ?? full.Text).match(/\b(\d{6})\b/)
      if (found) return found[1]
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('No llegó el correo con el código.')
}

describe('Edge Function customer-account', () => {
  // Qué prueba: pedir código sin link para un correo desconocido responde igual que siempre y
  // NO crea cuenta. Qué se rompería: cualquiera podría crear cuentas o averiguar qué correos existen.
  it('no crea cuentas sin un link vigente y responde igual', async () => {
    const email = `nadie-${Date.now()}@dueno.test`
    const res = await call({ action: 'request_code', email })
    expect(res.status).toBe(200)
    expect(res.json).toEqual({ ok: true })
    const { rows } = await pool.query('select 1 from auth.users where email = $1', [
      email,
    ])
    expect(rows).toHaveLength(0)
  })

  // Qué prueba: las acciones con sesión rechazan llamadas sin sesión de dueño.
  it('exige sesión para ver mascotas', async () => {
    expect((await call({ action: 'overview' })).status).toBe(401)
  })

  // Qué prueba: una sesión del PERSONAL no sirve en la cuenta del dueño.
  // Qué se rompería: un empleado podría usar esta API para leer lo de cualquier cuenta de dueño.
  it('rechaza la sesión de un empleado', async () => {
    const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: KEY },
      body: JSON.stringify({ email: 'dueno@patitasfelices.mx', password: 'Demo1234!' }),
    })
    const { access_token } = await res.json()
    expect((await call({ action: 'overview' }, access_token)).status).toBe(401)
  })

  // Qué prueba: el recorrido completo — link → código por correo → sesión → vínculo → ver
  // mascotas → eliminar cuenta.
  it('permite entrar con el código, vincular y ver las mascotas', async () => {
    // Un cliente solo admite una cuenta: se libera cualquier vínculo que haya dejado una corrida
    // anterior que falló a medias.
    await pool.query('delete from customer_accounts where tenant_id = $1', [
      TENANT_PATITAS,
    ])
    const email = `dueno-${Date.now()}@dueno.test`
    const token = await seedLink()

    expect((await call({ action: 'request_code', email, token })).json).toEqual({
      ok: true,
    })
    const code = await codeFor(email)

    const verify = await fetch(`${BASE}/auth/v1/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: KEY },
      body: JSON.stringify({ email, token: code, type: 'email' }),
    })
    expect(verify.status).toBe(200)
    const { access_token: jwt } = await verify.json()

    // Sin vínculo todavía: lista vacía.
    expect((await call({ action: 'overview' }, jwt)).json.businesses).toEqual([])

    const claim = await fetch(`${BASE}/rest/v1/rpc/claim_customer_link`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: KEY,
        authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ p_token: token }),
    })
    expect(claim.status).toBe(200)

    const overview = await call({ action: 'overview' }, jwt)
    expect(overview.json.businesses).toHaveLength(1)
    const pets = overview.json.businesses[0].pets.map((p: any) => p.name).sort()
    expect(pets).toEqual(['Michi', 'Rocky'])

    const detail = await call({ action: 'pet', petId: PET_ROCKY }, jwt)
    expect(detail.status).toBe(200)
    expect(detail.json.pet.name).toBe('Rocky')

    expect((await call({ action: 'delete_account' }, jwt)).json).toEqual({ ok: true })
    const { rows } = await pool.query('select 1 from auth.users where email = $1', [
      email,
    ])
    expect(rows).toHaveLength(0)
  })
})
