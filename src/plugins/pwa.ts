// Registro del service worker (fase 16A, PLAN.md D21). El service worker en sí es
// `public/sw.js`, escrito a mano: no hace falta ninguna dependencia.
//
// Solo se registra en producción: en desarrollo un service worker se queda con versiones
// viejas de los archivos y confunde más de lo que ayuda.
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return

  // Se espera a `load` para que registrar el service worker no compita con la carga de la app.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      // Sin service worker la app funciona igual: solo no se podrá instalar ni dará la
      // pantalla de "sin conexión". Se deja constancia en la consola, no se avisa a nadie.
      console.warn('No se pudo registrar el service worker', error)
    })
  })
}
