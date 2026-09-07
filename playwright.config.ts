// Configuración de Playwright (tarea 6.8): el único test end-to-end del
// proyecto vive en e2e/ (CLAUDE.md §9, D12).
//
// =============================================================================
// Qué es un test end-to-end, y en qué se diferencia de uno unitario
// =============================================================================
// Un test UNITARIO (Vitest, `lib/`, `services/`, `stores/`) llama código de
// TypeScript directamente — nunca abre un navegador, nunca ve una pantalla.
// Un test end-to-end ("de punta a punta", E2E) hace justo lo que haría una
// persona real: abre un navegador de verdad (Playwright controla un
// Chromium sin interfaz gráfica), navega a una URL, hace clic en botones,
// llena formularios, y lee lo que aparece en pantalla. Prueba la aplicación
// COMPLETA ensamblada — Vue, Vuetify, el router, los stores, los servicios,
// Supabase local, todo junto — en vez de una pieza aislada.
//
// Por eso es la prueba MÁS REALISTA que tiene el proyecto (si algo se rompe
// aquí, se rompería también frente a un cliente en una demo), pero también
// la más LENTA y la más FRÁGIL: un cambio de texto en un botón, un
// `v-select` que tarda un instante más en abrir, o una animación de
// Vuetify pueden tumbar un test E2E sin que el código tenga ningún error
// real. Un test unitario que falla casi siempre señala un bug; uno E2E que
// falla a veces solo señala que el test necesita un ajuste.
//
// =============================================================================
// Por qué solo hay UNO (CLAUDE.md D12)
// =============================================================================
// La cobertura real del proyecto vive en los tests unitarios y de RLS
// (rápidos, específicos, un caso por test). El E2E no es para eso — es la
// RED DE SEGURIDAD que se corre antes de cada demo: si el flujo completo
// (agendar → atender → cobrar) funciona de principio a fin contra una base
// de datos real, hay una garantía razonable de que el resto también.
// Escribir un E2E por cada pantalla sería lento de mantener y no
// aportaría mucho que los tests unitarios ya no cubran mejor y más rápido.
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // Un solo archivo, sin necesidad de paralelismo — correr "en serie"
  // hace los fallos más fáciles de leer (un error a la vez, no varios
  // navegadores compitiendo por la misma base de datos local).
  fullyParallel: false,
  workers: 1,
  // CI no reintenta solo (una falla real debe verse en rojo la primera
  // vez); en la Mac, un reintento absorbe el parpadeo ocasional de un
  // `v-select` de Vuetify sin esconder un fallo real dos veces seguidas.
  retries: process.env.CI ? 0 : 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    // Solo guarda la traza (screenshots + DOM paso a paso) si el test
    // falla — no vale la pena el espacio en disco cuando pasa.
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Levanta el servidor de Vite automáticamente antes de correr el test
  // (y lo apaga al terminar) — así `npm run test:e2e` funciona con un solo
  // comando, sin tener que acordarse de dejar `npm run dev` corriendo
  // aparte. En local, si YA hay un `npm run dev` corriendo en el puerto
  // 5173 (dev normal del día a día), lo reutiliza en vez de fallar por
  // puerto ocupado; en CI nunca reutiliza nada ajeno.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
