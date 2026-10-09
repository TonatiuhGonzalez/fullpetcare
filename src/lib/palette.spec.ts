// Vigila la paleta de la identidad visual (PLAN.md D20). Cada color de fondo debe
// poder llevar texto encima con contraste AA (4.5:1), en modo claro y en oscuro.
// Qué se rompería en producción sin esto: alguien "afina" un color en
// lib/palette.ts, el texto blanco sobre el naranja de estética deja de leerse y
// nadie lo nota hasta que una persona con baja visión (o con el sol en la
// pantalla de la recepción) no puede leer la cita.
import { describe, expect, it } from 'vitest'

import { contrastRatio, meetsAA } from './contrast'
import { darkPalette, lightPalette, type Palette } from './palette'

const THEMES: [string, Palette][] = [
  ['claro', lightPalette],
  ['oscuro', darkPalette],
]

// Colores que se usan como fondo con texto encima (botones, chips, alertas).
const FILLS = [
  'primary',
  'secondary',
  'grooming',
  'veterinary',
  'error',
  'success',
  'warning',
  'info',
  'background',
  'surface',
]

// Colores que además se usan COMO texto sobre una tarjeta (enlaces, íconos, chips
// "tonales"): el color mismo debe leerse sobre `surface`.
const AS_TEXT_ON_SURFACE = [
  'primary',
  'grooming',
  'veterinary',
  'error',
  'success',
  'warning',
  'info',
]

describe.each(THEMES)('paleta del modo %s', (_name, palette) => {
  // Qué prueba: el caso principal, texto de `on-X` sobre fondo X para cada color.
  // Si falla, el mensaje dice cuál color y cuánto contraste tiene.
  it.each(FILLS)('el texto sobre "%s" llega a 4.5:1', (fill) => {
    const ratio = contrastRatio(palette[`on-${fill}`], palette[fill])
    expect(ratio, `${fill}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
  })

  // Qué prueba: el texto normal de la app (sobre la tarjeta y sobre el fondo de
  // página). Es el contraste que más veces se usa: todo el contenido.
  it('el texto normal se lee sobre la tarjeta y sobre el fondo de la página', () => {
    expect(meetsAA(palette['on-surface'], palette.surface)).toBe(true)
    expect(meetsAA(palette['on-background'], palette.background)).toBe(true)
  })

  // Qué prueba: que el color de marca y los de tipo de visita se pueden usar como
  // texto o ícono sobre una tarjeta (p. ej. un enlace en primary, un chip tonal).
  it.each(AS_TEXT_ON_SURFACE)('"%s" se lee como texto sobre la tarjeta', (color) => {
    const ratio = contrastRatio(palette[color], palette.surface)
    expect(ratio, `${color}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
  })
})

describe('coherencia entre temas', () => {
  // Qué prueba: que el modo oscuro define EXACTAMENTE los mismos colores que el
  // claro. Si a uno le falta `grooming`, al cambiar de tema Vuetify cae a un color
  // por defecto y la agenda pierde la identidad del tipo de visita.
  it('el modo oscuro define los mismos colores que el claro', () => {
    expect(Object.keys(darkPalette).sort()).toEqual(Object.keys(lightPalette).sort())
  })

  // Qué prueba: que el control funciona. Un par malo conocido (naranja original
  // #D55E00 con texto blanco = 3.87:1) debe ser rechazado; si pasara, este archivo
  // no detectaría nada y daría una falsa tranquilidad.
  it('rechaza un par que no cumple (control negativo)', () => {
    expect(meetsAA('#FFFFFF', '#D55E00')).toBe(false)
  })
})
