// Configuración central de Vuetify. Todo el tema (colores, formas, densidad)
// vive aquí — nunca se pisa con overrides de CSS sueltos en los componentes
// (ver CLAUDE.md §5.3). Identidad visual: PLAN.md D20, fase 15.
import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'

import { createVuetify, type ThemeDefinition } from 'vuetify'
import { es } from 'vuetify/locale'

// Paleta clínica: neutros fríos (pizarra) y un verde azulado profundo de marca.
export const lightTheme: ThemeDefinition = {
  dark: false,
  colors: {
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
  },
  variables: {
    // Bordes finos de pizarra en vez de sombras (las tarjetas llevan `border`).
    'border-color': '#17262B',
    'border-opacity': 0.14,
  },
}

export const darkTheme: ThemeDefinition = {
  dark: true,
  colors: {
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
  },
  variables: {
    'border-color': '#E6EEF0',
    'border-opacity': 0.14,
  },
}

export const vuetify = createVuetify({
  theme: {
    // El tema inicial lo elige useThemeMode (sistema / claro / oscuro).
    defaultTheme: 'fullPetCareLight',
    themes: { fullPetCareLight: lightTheme, fullPetCareDark: darkTheme },
  },
  // La UI es solo en español de México (CLAUDE.md §5.5: sin i18n como
  // librería aparte). Esto traduce los textos internos de Vuetify
  // (paginación, "no hay datos", etc.) sin instalar vue-i18n.
  locale: {
    locale: 'es',
    messages: { es },
  },
  defaults: {
    // Formas: un solo radio por tipo de control (8 px en controles, 12 px en
    // tarjetas) y tarjetas con borde fino en lugar de sombra.
    // Densidad "comfortable": Vuetify por default dejar mucho aire; en un
    // sistema de punto de venta / agenda se prefiere ver más información
    // sin scroll.
    VCard: { density: 'comfortable', rounded: 'lg', border: true, elevation: 0 },
    VTextField: { density: 'comfortable', variant: 'outlined', rounded: 'md' },
    VSelect: { density: 'comfortable', variant: 'outlined', rounded: 'md' },
    VAutocomplete: { rounded: 'md' },
    VCombobox: { rounded: 'md' },
    VTextarea: { rounded: 'md' },
    VAlert: { rounded: 'md' },
    VBtn: { style: 'text-transform: none;', rounded: 'md', elevation: 0 },
    // Ancho máximo único del contenido de todas las pantallas (centrado por el
    // propio v-container). Las páginas no ponen su propio max-width.
    VContainer: { maxWidth: 860 },
  },
})
