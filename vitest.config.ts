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
      css: false, // no hace falta procesar CSS real para que un test pase
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
