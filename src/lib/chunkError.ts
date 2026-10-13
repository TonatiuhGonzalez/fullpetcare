// Reconoce el error que lanza el navegador cuando no puede descargar una pantalla
// (PLAN.md D22). Pasa tras un despliegue: los archivos con hash de la versión anterior
// ya no existen y la importación dinámica (`() => import(...)` del router) falla.
//
// El texto del error NO es estándar, cada navegador usa el suyo:
//   Chrome / Edge: "Failed to fetch dynamically imported module: <url>"
//   Firefox:       "error loading dynamically imported module: <url>"
//   Safari:        "Importing a module script failed."
// Y Vite agrega uno propio cuando falla la hoja de estilos de la pantalla:
//   "Unable to preload CSS for <url>"
const CHUNK_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /unable to preload css/i,
]

export function isChunkLoadError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : typeof (error as { message?: unknown } | null)?.message === 'string'
          ? (error as { message: string }).message
          : ''
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}
