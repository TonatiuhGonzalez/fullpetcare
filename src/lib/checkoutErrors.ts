// Traduce los errores del cobro (checkout_appointment() y checkout_counter_sale()) a un
// mensaje en español para quien cobra. Lo usan la pantalla de cobro de una cita y el
// punto de venta, por eso vive aquí y no copiado en cada página. Función pura: entra el
// error, sale el texto.

/**
 * checkout_appointment() (checkout_rpc.sql) rechaza casos de negocio con un
 * mensaje propio en español — se reconocen aquí por su texto para
 * mostrarlos tal cual (son los mismos que ya prueba checkout-rpc.spec.ts),
 * en vez de un genérico "revisa tu conexión" que sería falso y confundiría
 * más de lo que ayuda (CLAUDE.md §5.4: los mensajes de error no mienten
 * sobre la causa).
 */
export function checkoutErrorMessage(err: unknown): string {
  // NO "err instanceof Error": un error de `.rpc()`/`.from()` de
  // supabase-js NO es una instancia de Error salvo que se use
  // `.throwOnError()` — sin eso, PostgREST devuelve un objeto plano
  // `{ message, details, hint, code }` (comprobado contra la respuesta
  // real de checkout_appointment()). Los errores de supabase.auth (que sí
  // usa `instanceof Error` en session.ts) son distintos: esos SÍ son
  // instancias reales de AuthError.
  const message =
    typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message)
      : ''

  if (/no cubre el total/i.test(message))
    return 'El monto pagado no cubre el total de la venta.'
  if (/no tiene existencia|no hay existencia suficiente/i.test(message)) {
    return 'Un producto ya no tiene existencia suficiente. Quítalo o baja la cantidad.'
  }
  if (/producto no existe/i.test(message)) return 'Un producto ya no está disponible.'
  if (/crédito o de débito/i.test(message))
    return 'Elige si la tarjeta fue de crédito o de débito.'
  if (/ya fue cobrada/i.test(message)) return 'Esta cita ya fue cobrada.'
  if (/debe estar atendida/i.test(message)) {
    return 'Esta cita todavía no está atendida — no se puede cobrar.'
  }
  if (/no tienes permiso para cobrar/i.test(message)) {
    return 'No tienes permiso para cobrar citas.'
  }
  if (/no perteneces|no tienes acceso/i.test(message)) {
    return 'No tienes acceso para cobrar esta cita.'
  }
  return 'No se pudo cobrar. Revisa tu conexión.'
}
