// Iniciales para el avatar de una persona (menú de usuario). Se toman de su nombre
// completo; si no hay nombre se usa el correo. Máximo dos letras, en mayúscula.
//   "Sofía Ramírez Torres" → "SR"   "Marcos" → "M"   "ana@correo.mx" → "A"

export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  // `Array.from` separa por letras reales (no por unidades de texto), así una inicial
  // acentuada o un emoji no se corta a la mitad.
  const first = (word: string): string => Array.from(word)[0].toLocaleUpperCase('es-MX')
  if (words.length === 1) return first(words[0])
  return first(words[0]) + first(words[1])
}
