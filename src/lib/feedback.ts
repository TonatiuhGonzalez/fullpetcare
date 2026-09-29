// Reglas del formulario de "Reportar un error o sugerir una mejora" (tarea
// #1958). Funciones puras: las usa el diálogo para avisar antes de enviar, y
// coinciden con los límites de la base (mensaje ≤ 2000 caracteres) y del
// bucket "feedback-screenshots" (5 MB, JPG/PNG/WebP).

export const MAX_MESSAGE_LENGTH = 2000
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024
export const SCREENSHOT_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/** Mensaje de error del texto, o null si es válido. Espacios solos cuentan como vacío. */
export function messageProblem(message: string): string | null {
  if (message.trim() === '') return 'Escribe tu comentario.'
  if (message.trim().length > MAX_MESSAGE_LENGTH) {
    return `El comentario no puede pasar de ${MAX_MESSAGE_LENGTH} caracteres.`
  }
  return null
}

/** Mensaje de error de la captura, o null si es válida. Recibe solo lo que se necesita (tipo y peso). */
export function screenshotProblem(file: { type: string; size: number }): string | null {
  if (!SCREENSHOT_TYPES.includes(file.type)) return 'La captura debe ser una imagen JPG, PNG o WebP.'
  if (file.size > MAX_SCREENSHOT_BYTES) return 'La captura no puede pesar más de 5 MB.'
  return null
}
