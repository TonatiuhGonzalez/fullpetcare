// Configuración central de Vuetify. Todo el tema (colores, formas, densidad)
// vive aquí — nunca se pisa con overrides de CSS sueltos en los componentes
// (ver CLAUDE.md §5.3). Identidad visual: PLAN.md D20, fase 15.
import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'

import { createVuetify, type ThemeDefinition } from 'vuetify'
import { es } from 'vuetify/locale'

import { CONTENT_WIDTH } from '@/lib/contentWidth'
import { darkPalette, lightPalette } from '@/lib/palette'
import { DARK_THEME, LIGHT_THEME } from '@/lib/themeMode'

// Paleta clínica: neutros fríos (pizarra) y un verde azulado profundo de marca.
// Los colores viven en lib/palette.ts (datos puros, con su test de contraste).
export const lightTheme: ThemeDefinition = {
  dark: false,
  colors: lightPalette,
  variables: {
    // Bordes finos de pizarra en vez de sombras (las tarjetas llevan `border`).
    'border-color': '#17262B',
    'border-opacity': 0.14,
  },
}

export const darkTheme: ThemeDefinition = {
  dark: true,
  colors: darkPalette,
  variables: {
    'border-color': '#E6EEF0',
    'border-opacity': 0.14,
  },
}

export const vuetify = createVuetify({
  theme: {
    // El tema inicial lo elige useThemeMode (sistema / claro / oscuro).
    defaultTheme: LIGHT_THEME,
    themes: { [LIGHT_THEME]: lightTheme, [DARK_THEME]: darkTheme },
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
    // Ancho del contenido (PLAN.md D27): por defecto el "ancho" (listados y tableros),
    // que crece con la ventana hasta 1440 px. Las pantallas de formulario o detalle piden
    // `CONTENT_WIDTH.narrow`; las páginas no escriben su propio número (lib/contentWidth.ts).
    VContainer: { maxWidth: CONTENT_WIDTH.wide },
    // Los tooltips esperan 300 ms: no saltan al cruzar el cursor de paso (IconButton y los
    // `v-tooltip` sueltos lo heredan de aquí).
    VTooltip: { openDelay: 300 },
  },
})
