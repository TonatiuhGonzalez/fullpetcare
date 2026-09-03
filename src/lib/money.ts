// El dinero se guarda y se calcula siempre en CENTAVOS ENTEROS (ver CLAUDE.md
// §8.2). formatMXN es la única función que lo convierte a algo legible para
// una persona, y solo debe llamarse al MOSTRAR — nunca antes de guardar o
// calcular.
//
// Este archivo hoy solo tiene el formateador. El resto de money.ts
// (desglose de IVA, suma de partidas, descuentos) se agrega en la fase 5,
// cuando existe el flujo de cobro; no tiene caso escribirlo antes de tener
// un caso real que lo use.

/**
 * Convierte centavos (p. ej. 35000) a un texto de pesos mexicanos
 * (p. ej. "$350.00"), usando el formato de número que usa México
 * (separador de miles con coma, decimales con punto).
 */
export function formatMXN(cents: number): string {
  const pesos = cents / 100
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
  }).format(pesos)
}
