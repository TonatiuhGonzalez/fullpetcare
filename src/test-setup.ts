// Configuración que corre antes de cada archivo de test (vitest.config.ts,
// "setupFiles"). Hoy solo tiene un polyfill: jsdom (el navegador simulado
// que usan los tests, ver vitest.config.ts) no implementa ResizeObserver
// — algunos componentes de Vuetify que miden su propio tamaño (como
// v-slide-group, que usa internamente v-chip-group) lo necesitan para
// montarse sin reventar, aunque el test no le importe nada del tamaño
// real en pantalla.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver = ResizeObserverStub
