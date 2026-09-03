import { defineConfig } from 'vitest/config'

// Config separada de vitest.config.ts a propósito: estos tests necesitan
// Supabase local corriendo (Postgres real en el puerto 54322) y no tienen
// nada que ver con Vue — no hace falta jsdom ni el plugin de Vuetify.
// Mezclarlos con "npm run test:unit" haría que ese comando, que se
// supone rápido y sin dependencias externas, empezara a fallar cada vez
// que Docker no está corriendo.
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
})
