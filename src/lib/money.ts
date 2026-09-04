// El dinero se guarda y se calcula siempre en CENTAVOS ENTEROS (ver CLAUDE.md
// §8.2). formatMXN es la única función que lo convierte a algo legible para
// una persona, y solo debe llamarse al MOSTRAR — nunca antes de guardar o
// calcular.
//
// El desglose de IVA, suma de partidas y descuentos se agrega en la fase 5,
// cuando existe el flujo de cobro; no tiene caso escribirlo antes de tener
// un caso real que lo use. pesosToCents sí hace falta desde la fase 3
// (ServiceFormDialog: alguien captura "$250.00" y hay que guardar 25000).

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

/**
 * Convierte pesos (lo que alguien captura en un formulario, p. ej. 250.5)
 * a centavos enteros (25050) para guardar. `Math.round`, no truncar: los
 * números de punto flotante de JS a veces representan "3.10" como
 * 3.0999999999999996 por dentro — truncar eso daría 309 centavos en vez
 * de 310.
 */
export function pesosToCents(pesos: number): number {
  return Math.round(pesos * 100)
}
