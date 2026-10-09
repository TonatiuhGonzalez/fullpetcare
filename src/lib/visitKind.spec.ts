// Pruebas de la identidad de los tipos de visita. Protegen la regla de
// accesibilidad de PLAN.md D20: el color nunca es la única señal.
import { describe, expect, it } from 'vitest'

import { darkPalette, lightPalette } from './palette'
import { VISIT_KINDS, visitKindInfo } from './visitKind'

describe('visitKindInfo', () => {
  // Qué prueba: que cada tipo se llama como lo ve la persona usuaria. Antes este
  // texto estaba copiado en cinco archivos; si uno cambia aquí, cambia en todos.
  it('devuelve el nombre en español de cada tipo', () => {
    expect(visitKindInfo('grooming').label).toBe('Estética')
    expect(visitKindInfo('veterinary').label).toBe('Veterinaria')
  })

  // Qué prueba: que los dos tipos se distinguen SIN usar el color: ícono y texto
  // distintos. Si alguien copia el ícono de uno al otro, una persona con daltonismo
  // (o un monitor en escala de grises) ya no podría separar un baño de una consulta.
  it('da a cada tipo un ícono y un nombre distintos, no solo un color', () => {
    const [a, b] = Object.values(VISIT_KINDS)
    expect(a.icon).not.toBe(b.icon)
    expect(a.label).not.toBe(b.label)
    expect(a.color).not.toBe(b.color)
    expect(a.icon.startsWith('mdi-')).toBe(true)
    expect(b.icon.startsWith('mdi-')).toBe(true)
  })

  // Qué prueba: que el nombre de color apunta a un color que SÍ existe en el tema,
  // claro y oscuro, con su texto `on-*`. Si se renombra un color en la paleta y esto
  // no se actualiza, Vuetify pinta el chip sin color y nadie avisa.
  it('usa colores definidos en ambos temas, con su color de texto', () => {
    for (const info of Object.values(VISIT_KINDS)) {
      for (const palette of [lightPalette, darkPalette]) {
        expect(palette[info.color]).toBeDefined()
        expect(palette[`on-${info.color}`]).toBeDefined()
      }
    }
  })

  // Qué prueba: que la tabla está indexada por su propio tipo (kind === clave).
  // Un copiar-pegar con la clave equivocada devolvería el tipo contrario.
  it('cada entrada se identifica con su propia clave', () => {
    for (const [key, info] of Object.entries(VISIT_KINDS)) expect(info.kind).toBe(key)
  })
})
