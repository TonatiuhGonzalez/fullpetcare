// Links públicos de mascota (tarea 7.2, CLAUDE.md §7.4, §6.6). Único
// archivo que habla con Supabase para esto (CLAUDE.md §4).
//
// =============================================================================
// Por qué el token se guarda HASHEADO, y no en claro
// =============================================================================
// El token es literalmente la llave de la puerta: cualquiera que lo tenga
// entra a la vista pública de esa mascota sin login. Si `share_links`
// guardara el token tal cual, un respaldo de la base robado (o un acceso
// indebido al panel de Supabase) le daría a quien lo tenga TODOS los
// links activos del negocio, listos para usar. Guardando solo
// `sha256(token)`, esa misma fuga no sirve de nada: un hash SHA-256 no se
// puede "deshacer" para recuperar el token original (es una función de un
// solo sentido), así que ni el dueño de la base de datos puede reconstruir
// un token ya emitido. Es el mismo principio con el que se guardan
// contraseñas — la diferencia es que aquí no hay un usuario que "inicie
// sesión" con el token, así que no hace falta una librería especial de
// hashing de contraseñas (bcrypt, argon2...): SHA-256 alcanza porque el
// token YA es aleatorio de fábrica (ver más abajo), no algo que alguien
// pudo elegir débil como "123456".
//
// =============================================================================
// Por qué 32 bytes aleatorios son inadivinables
// =============================================================================
// `crypto.getRandomValues` (Web Crypto, no `Math.random()` — ese SÍ se
// puede predecir) genera 32 bytes = 256 bits de entropía. Para "adivinar"
// uno por fuerza bruta habría que probar hasta 2^256 combinaciones — un
// número tan grande que ni con todas las computadoras del planeta
// corriendo sin parar durante más tiempo del que lleva existiendo el
// universo se agotarían. Se codifican en base64url (43 caracteres: A-Z,
// a-z, 0-9, "-", "_") para que quepan en una URL sin caracteres que haya
// que escapar.
//
// =============================================================================
// Por qué el UUID de la mascota no sirve como link
// =============================================================================
// Un UUID v4 también es aleatorio, pero NO es secreto: viaja en cada
// respuesta de la API, en la URL de `/app/mascotas/:id`, en los logs del
// navegador... cualquiera con acceso a la app (o a una captura de
// pantalla) lo ve. Un token dedicado, en cambio, solo existe para ESTE
// propósito: se puede revocar (`revoked_at`) o dejar expirar
// (`expires_at`) sin tocar la mascota ni el resto del sistema, y saber el
// id de una mascota no le da a nadie el token — son cosas completamente
// distintas guardadas en tablas distintas.
import { supabase } from './supabase'
import type { Database } from '@/types/database'

export type ShareLink = Database['public']['Tables']['share_links']['Row']

const TOKEN_BYTES = 32
const DEFAULT_EXPIRES_DAYS = 30

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** El token en claro que se le muestra al usuario UNA SOLA VEZ. */
function generateToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const digestBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digestBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export interface NewShareLink {
  /** El token EN CLARO — guárdalo/muéstralo ahora: no se puede volver a leer después. */
  token: string
  record: ShareLink
}

/** Genera un link nuevo para una mascota (tarea 7.14). */
export async function createForPet(
  tenantId: string,
  petId: string,
  createdByUserId: string,
  expiresInDays: number = DEFAULT_EXPIRES_DAYS,
): Promise<NewShareLink> {
  const token = generateToken()
  const tokenHash = await sha256Hex(token)
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)

  const { data, error } = await supabase
    .from('share_links')
    .insert({
      tenant_id: tenantId,
      scope: 'pet',
      pet_id: petId,
      token_hash: tokenHash,
      token_prefix: token.slice(0, 8),
      expires_at: expiresAt.toISOString(),
      created_by: createdByUserId,
    })
    .select()
    .single()

  if (error) throw error
  return { token, record: data }
}

/** Los links (activos o no) de una mascota, del más reciente al más viejo. */
export async function listByPet(tenantId: string, petId: string): Promise<ShareLink[]> {
  const { data, error } = await supabase
    .from('share_links')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('pet_id', petId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

/**
 * Revoca un link: a partir de este momento, la Edge Function pública
 * (tarea 7.4) lo trata como inválido — nunca se borra la fila, queda
 * como registro de que existió.
 */
export async function revoke(id: string): Promise<void> {
  const { error } = await supabase
    .from('share_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw error
}
