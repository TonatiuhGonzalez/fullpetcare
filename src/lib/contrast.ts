// Contraste de color según WCAG 2 (la norma de accesibilidad web). Mide qué tan
// legible es un texto sobre un fondo: 1 es "invisible" (mismo color) y 21 es el
// máximo (negro sobre blanco). La norma pide 4.5 o más para texto normal (nivel AA).
// Función pura: entra un color, sale un número. Se usa para vigilar la paleta
// (lib/palette.spec.ts), no en la interfaz.

const AA_NORMAL_TEXT = 4.5

// Acepta "#RGB" o "#RRGGBB". Cualquier otra cosa lanza error: un color mal
// escrito en la paleta debe fallar a gritos, no calcular un contraste falso.
function parseHex(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`Color hexadecimal no válido: "${hex}"`)
  const digits =
    m[1].length === 3
      ? m[1]
          .split('')
          .map((c) => c + c)
          .join('')
      : m[1]
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ]
}

// Luminancia relativa: qué tan "claro" percibe el ojo un color (0 negro, 1 blanco).
// El ojo es más sensible al verde que al azul, de ahí los pesos distintos.
function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((channel) => {
    const v = channel / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// Razón de contraste entre dos colores. No importa cuál es texto y cuál fondo.
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

// ¿El texto `fg` se lee sobre `bg` con nivel AA?
export function meetsAA(fg: string, bg: string): boolean {
  return contrastRatio(fg, bg) >= AA_NORMAL_TEXT
}
