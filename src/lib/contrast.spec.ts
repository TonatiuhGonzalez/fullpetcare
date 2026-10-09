// Pruebas de `contrastRatio` y `meetsAA`. Sirven de base para vigilar la paleta
// (palette.spec.ts): si estas funciones midieran mal, ese test daría luz verde a
// colores ilegibles sin que nadie lo notara.
import { describe, expect, it } from 'vitest'

import { contrastRatio, meetsAA } from './contrast'

describe('contrastRatio', () => {
  // Qué prueba: los dos extremos de la escala. Si fallara, la fórmula está mal
  // de raíz y todos los demás cálculos no valen nada.
  it('da 21 para negro sobre blanco y 1 para un color sobre sí mismo', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
    expect(contrastRatio('#0F6B66', '#0F6B66')).toBeCloseTo(1, 5)
  })

  // Qué prueba: que el orden no importa. Se usa tanto "texto sobre fondo" como
  // "fondo bajo texto"; si dependiera del orden, un par bueno podría reportarse mal.
  it('da lo mismo sin importar cuál es el texto y cuál el fondo', () => {
    expect(contrastRatio('#C25400', '#FFFFFF')).toBeCloseTo(
      contrastRatio('#FFFFFF', '#C25400'),
      10,
    )
  })

  // Qué prueba: un valor publicado por la propia norma. #767676 es el gris más claro
  // que pasa 4.5:1 sobre blanco; si nuestro cálculo no da ~4.54, difiere de WCAG.
  it('coincide con el valor de referencia de WCAG (#767676 sobre blanco ≈ 4.54)', () => {
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2)
  })

  // Qué prueba: que "#FFF" y "#FFFFFF" son el mismo color. Un descuido al escribir
  // un color corto no debe cambiar el resultado.
  it('acepta colores de tres dígitos', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5)
  })

  // Qué prueba: que un color mal escrito truene en lugar de calcular con basura.
  // Sin esto, "#12G" daría un número y el test de paleta pasaría con un color roto.
  it('lanza error con un color que no es hexadecimal', () => {
    expect(() => contrastRatio('rojo', '#FFFFFF')).toThrow()
    expect(() => contrastRatio('#12345', '#FFFFFF')).toThrow()
  })
})

describe('meetsAA', () => {
  // Qué prueba: el borde justo del umbral (4.5). Un gris apenas más claro que
  // #767676 ya no se lee bien para personas con baja visión; el umbral no se redondea.
  it('acepta 4.54 y rechaza 4.48, justo a ambos lados de 4.5', () => {
    expect(meetsAA('#767676', '#FFFFFF')).toBe(true)
    expect(meetsAA('#777777', '#FFFFFF')).toBe(false)
  })
})
