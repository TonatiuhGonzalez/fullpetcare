import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    // Auto-import de componentes Vuetify: en vez de registrar cada v-btn,
    // v-card, etc. a mano, este plugin los resuelve por su uso en el
    // template y solo empaqueta los que realmente usamos.
    vuetify({ autoImport: true }),
  ],
  resolve: {
    alias: {
      // Permite escribir "@/services/customers" en vez de rutas relativas
      // largas tipo "../../../services/customers". El mismo alias se
      // declara en tsconfig.app.json (para el editor) y en vitest.config.ts
      // (para los tests) — los tres deben coincidir.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
