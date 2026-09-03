// Configuración central de Vuetify. Todo el tema (colores, densidad, etc.)
// vive aquí — nunca se pisa con overrides de CSS sueltos en los componentes
// (ver CLAUDE.md §5.3).
import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'

import { createVuetify } from 'vuetify'
import { es } from 'vuetify/locale'

// Paleta provisional. "primary" es el color de marca; se ajusta cuando el
// negocio demo tenga identidad visual. El resto son los roles semánticos
// que Vuetify espera (success, error, etc.) y que los componentes usan
// automáticamente (p. ej. un v-alert type="error").
const fullPetCareTheme = {
  dark: false,
  colors: {
    primary: '#2E7D6B', // verde clínico, sobrio
    secondary: '#F2A93B', // acento cálido para estética/groomer
    error: '#C0392B',
    info: '#2E86AB',
    success: '#3E8E5A',
    warning: '#E0A800',
    background: '#F7F7F5',
    surface: '#FFFFFF',
  },
}

export const vuetify = createVuetify({
  theme: {
    defaultTheme: 'fullPetCareTheme',
    themes: { fullPetCareTheme },
  },
  // La UI es solo en español de México (CLAUDE.md §5.5: sin i18n como
  // librería aparte). Esto traduce los textos internos de Vuetify
  // (paginación, "no hay datos", etc.) sin instalar vue-i18n.
  locale: {
    locale: 'es',
    messages: { es },
  },
  defaults: {
    // Densidad "comfortable": Vuetify por default dejar mucho aire; en un
    // sistema de punto de venta / agenda se prefiere ver más información
    // sin scroll.
    VCard: { density: 'comfortable' },
    VTextField: { density: 'comfortable', variant: 'outlined' },
    VSelect: { density: 'comfortable', variant: 'outlined' },
    VBtn: { style: 'text-transform: none;' },
  },
})
