import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

// Config separada de vitest.config.ts a propósito: estos tests necesitan
// Supabase local corriendo (Postgres real en el puerto 54322) y no tienen
// nada que ver con Vue — no hace falta jsdom ni el plugin de Vuetify.
// Mezclarlos con "npm run test:unit" haría que ese comando, que se
// supone rápido y sin dependencias externas, empezara a fallar cada vez
// que Docker no está corriendo.
//
// Desde la fase 2, algunos tests de aquí (los que prueban services/,
// p. ej. customers-service.spec.ts) SÍ importan código de src/ — usan el
// cliente real de supabase-js contra el Supabase local, en vez de la
// conexión pg + simulación de rol de supabase/tests/helpers.ts, para
// probar el camino que de verdad usa la app. Por eso hace falta el mismo
// alias "@" que usa vite.config.ts, y por eso existe el bloque "define"
// de abajo: src/services/supabase.ts lee `import.meta.env.VITE_*`, que
// normalmente rellena Vite leyendo .env.local — pero este archivo NO usa
// mergeConfig con vite.config.ts (a propósito, para no arrastrar jsdom ni
// Vuetify), así que esos valores no llegarían solos. Como esta config
// SOLO corre contra Supabase local (nunca staging/prod — igual que
// TEST_DATABASE_URL en helpers.ts), se puede fijar aquí el valor fijo y
// público de la anon key local (no es secreta: es la misma para
// cualquier instalación local de Supabase, ver .env.example).
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['supabase/tests/**/*.spec.ts'],
    // Cada test abre su propia conexión y transacción (ver
    // supabase/tests/helpers.ts) así que en teoría podrían correr en
    // paralelo, pero mantenerlos en serie hace las fallas mucho más
    // fáciles de leer — un solo test a la vez en la salida, en vez de
    // varios entrelazados.
    fileParallelism: false,
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(
      process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321',
    ),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(
      process.env.VITE_SUPABASE_ANON_KEY ??
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
    ),
  },
})
