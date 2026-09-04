import { fileURLToPath, URL } from 'node:url'

import { defineConfig, mergeConfig } from 'vitest/config'

import viteConfig from './vite.config.ts'

// mergeConfig reutiliza plugins y el alias "@" de vite.config.ts, y encima
// agrega solo lo que Vitest necesita. Así el alias nunca se desincroniza
// entre "correr la app" y "correr los tests".
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // "jsdom" simula un navegador en Node (document, window, etc.) para
      // que los tests que monten componentes Vue tengan dónde renderizar.
      // Los tests de lib/ y services/ no lo necesitan, pero tenerlo global
      // es más simple que configurarlo por archivo.
      environment: 'jsdom',
      globals: true, // permite usar describe/it/expect sin importarlos en cada archivo
      setupFiles: ['./src/test-setup.ts'],
      // "true" desde la fase 3 (TimeSlotPicker.spec.ts, tarea 3.20): los
      // componentes de Vuetify importan su propio .css directo (p. ej.
      // VChip.css) — con "false", Vitest intenta cargar ese archivo como
      // si fuera un módulo de JS normal y truena con "Unknown file
      // extension .css". La mayoría de los tests (lib/, services/,
      // stores/) no montan ningún componente, así que nunca lo notaron;
      // en cuanto el primer test monta uno de verdad, hace falta esto.
      css: true,
      server: {
        deps: {
          // Sin esto, Vitest trata "vuetify" como una dependencia
          // externa y deja que Node la cargue directo con su propio
          // resolutor de módulos — que no sabe qué hacer con un
          // `import './VChip.css'` dentro del paquete. "inline" fuerza a
          // que Vite (que sí sabe procesar CSS) sea quien la cargue,
          // igual que ya hace para el código de la app en dev/build.
          inline: ['vuetify'],
        },
      },
      // Solo corre lo unitario aquí. Los tests de BD (supabase/tests/) y
      // el E2E de Playwright tienen su propio runner — mezclarlos aquí
      // haría que "npm run test:unit" necesitara Docker corriendo.
      include: ['src/**/*.spec.ts'],
      exclude: ['**/node_modules/**', '**/dist/**', 'supabase/**', 'e2e/**'],
      coverage: {
        provider: 'v8',
        include: ['src/lib/**', 'src/services/**', 'src/stores/**'],
        reporter: ['text', 'html'],
      },
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }),
)
