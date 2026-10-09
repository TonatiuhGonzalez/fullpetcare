// Paleta de colores como datos puros (sin Vuetify), para que `plugins/vuetify.ts`
// la use y `lib/palette.spec.ts` verifique sus contrastes (CLAUDE.md §4: la lógica
// que se pueda probar pura va en `lib/`). Identidad visual: PLAN.md D20.
//
// `grooming` (estética) y `veterinary` (veterinaria) son colores propios, no de
// Vuetify: identifican el tipo de visita en toda la app (lib/visitKind.ts). Son
// naranja y azul de la paleta Okabe-Ito, que se distingue en los tres tipos de
// daltonismo. Aun así el color nunca va solo: cada tipo lleva ícono y texto.
//
// Cada color de fondo declara su `on-*` (el color del texto encima) para que el
// contraste sea una decisión nuestra y no del cálculo automático de Vuetify.

export type Palette = Record<string, string>

export const lightPalette: Palette = {
  primary: '#0F6B66',
  'on-primary': '#FFFFFF',
  secondary: '#475569',
  'on-secondary': '#FFFFFF',
  grooming: '#C25400',
  'on-grooming': '#FFFFFF',
  veterinary: '#0072B2',
  'on-veterinary': '#FFFFFF',
  error: '#B3261E',
  'on-error': '#FFFFFF',
  success: '#1B7A45',
  'on-success': '#FFFFFF',
  warning: '#9A5B00',
  'on-warning': '#FFFFFF',
  info: '#245EA6',
  'on-info': '#FFFFFF',
  background: '#F4F7F8',
  'on-background': '#17262B',
  surface: '#FFFFFF',
  'on-surface': '#17262B',
}

export const darkPalette: Palette = {
  primary: '#4FD1C5',
  'on-primary': '#06302D',
  secondary: '#A9B7BD',
  'on-secondary': '#0E1B1E',
  grooming: '#E8793A',
  'on-grooming': '#1A0C02',
  veterinary: '#3FA0D6',
  'on-veterinary': '#04202F',
  error: '#FF8A80',
  'on-error': '#2B0907',
  success: '#5FD08A',
  'on-success': '#06210F',
  warning: '#F0B24A',
  'on-warning': '#2A1A00',
  info: '#7FB0F0',
  'on-info': '#06182E',
  background: '#0E1B1E',
  'on-background': '#E6EEF0',
  surface: '#14262A',
  'on-surface': '#E6EEF0',
}
