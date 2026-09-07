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
  // En CI: "github" imprime los fallos como anotaciones en la pestaña del
  // PR, y "html" además arma el reporte con capturas/traza que
  // .github/workflows/ci.yml sube como artefacto si el test falla — sin
  // "html" no habría ningún archivo que subir. En local, "list" alcanza
  // (se ve la terminal directo, no hace falta abrir un reporte aparte).
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    // Solo guarda la traza (screenshots + DOM paso a paso) si el test
    // falla — no vale la pena el espacio en disco cuando pasa.
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // "npm run build && npm run preview", NO "npm run dev" — a propósito
  // (encontrado corriendo este mismo test en GitHub Actions, no en la
  // Mac): el servidor de DESARROLLO de Vite compila cada módulo la
  // primera vez que alguien lo pide, y justo al arrancar en frío puede
  // responder "504 Outdated Optimize Dep" a un import dinámico (las
  // rutas de `router/index.ts` son todas `() => import(...)`) — eso
  // aborta la navegación a media prueba, sin ningún error en el código de
  // la app. `vite preview` sirve el mismo `dist/` que se despliega a
  // producción (CLAUDE.md §10): archivos ya compilados de antemano, nada
  // que compilar sobre la marcha, cero margen para esa carrera. De paso,
  // el E2E termina probando lo más parecido a lo que un cliente real ve.
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    // El build (vue-tsc + vite build) tarda más que solo arrancar un
    // servidor — 30s le quedaba corto en un runner de GitHub Actions.
    timeout: 90_000,
  },
})
