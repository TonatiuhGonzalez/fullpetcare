// Ancho máximo del contenido de las pantallas (PLAN.md D27, fase 24).
//
// Hay dos anchos, no uno:
//   - `wide`: listados y tableros (Clientes, Inventario, Inicio…). Nunca baja de
//     `NARROW_PX`, crece con la ventana (75vw) y no pasa de `WIDE_MAX_PX`, para que en un
//     monitor de 1920 px no queden cientos de píxeles vacíos a cada lado.
//   - `narrow`: formularios y detalle de una columna, donde un campo de 1400 px se
//     lee mal. Es el ancho fijo que tenían todas las pantallas antes de la fase 24.
//
// `wide` es el default de VContainer (plugins/vuetify.ts); las pantallas angostas lo
// piden con `:max-width="CONTENT_WIDTH.narrow"`. Las páginas no escriben números sueltos.

export const NARROW_PX = 860
export const WIDE_MAX_PX = 1440

// Vuetify aplica `maxWidth` tal cual como `max-width` en línea, así que acepta `clamp()`.
export const CONTENT_WIDTH = {
  narrow: NARROW_PX,
  wide: `clamp(${NARROW_PX}px, 75vw, ${WIDE_MAX_PX}px)`,
} as const
