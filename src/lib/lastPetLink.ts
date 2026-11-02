// Último link de mascota abierto en este teléfono (fase 16A, PLAN.md D21). La app instalada
// abre en `/c`, sin token en la dirección; este valor le dice a qué mascota ir.
//
// Es una COMODIDAD del navegador, igual que el modo de color: nunca un dato de negocio y
// nunca la única copia (el negocio puede generar otro link). Si el link se revoca o vence,
// la vista pública lo borra.
const KEY = 'fpc.lastPetLink'

// 43 caracteres base64url (§7.4). Lo guardado es texto editable por cualquiera: solo se
// acepta algo con esa forma.
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,128}$/

/** El token guardado, o nulo si no hay o no tiene la forma de un token. */
export function readLastPetLink(
  storage: Pick<Storage, 'getItem'> = localStorage,
): string | null {
  try {
    const raw = storage.getItem(KEY)
    return raw !== null && TOKEN_SHAPE.test(raw) ? raw : null
  } catch {
    return null
  }
}

export function saveLastPetLink(
  token: string,
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  if (!TOKEN_SHAPE.test(token)) return
  try {
    storage.setItem(KEY, token)
  } catch {
    // Almacenamiento bloqueado: la app instalada simplemente no recordará la mascota.
  }
}

/** Borra el token guardado, pero solo si es ESTE (otro link más nuevo no se toca). */
export function forgetLastPetLink(
  token: string,
  storage: Pick<Storage, 'getItem' | 'removeItem'> = localStorage,
): void {
  try {
    if (storage.getItem(KEY) === token) storage.removeItem(KEY)
  } catch {
    // Sin almacenamiento no hay nada que borrar.
  }
}
