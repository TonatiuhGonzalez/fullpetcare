import { describe, expect, it } from 'vitest'

import { CONTENT_WIDTH, NARROW_PX, WIDE_MAX_PX } from './contentWidth'

describe('CONTENT_WIDTH', () => {
  // Qué prueba: el ancho "ancho" nunca baja del angosto y termina en el tope acordado.
  // Qué se rompería: una ventana mediana mostraría el listado MÁS angosto que un
  // formulario, o un monitor ultraancho estiraría las tablas más allá de 1440 px.
  it('el ancho "wide" parte del angosto y termina en el tope de 1440 px', () => {
    expect(CONTENT_WIDTH.wide).toBe(`clamp(${NARROW_PX}px, 75vw, ${WIDE_MAX_PX}px)`)
    expect(NARROW_PX).toBe(860)
    expect(WIDE_MAX_PX).toBe(1440)
  })

  // Qué prueba: el ancho angosto es un número (px), el mismo que tenían todas las
  // pantallas antes de la fase 24.
  // Qué se rompería: formularios y detalle cambiarían de ancho sin que nadie lo pidiera.
  it('el ancho "narrow" sigue siendo 860 px', () => {
    expect(CONTENT_WIDTH.narrow).toBe(860)
  })

  // Qué prueba: el tope es mayor que el piso.
  // Qué se rompería: `clamp(min, x, max)` con max < min ignora el máximo y el contenido
  // se vería de 860 px siempre, sin error alguno.
  it('el tope es mayor que el piso', () => {
    expect(WIDE_MAX_PX).toBeGreaterThan(NARROW_PX)
  })
})
