// CORS para las Edge Functions que llama el navegador con sesión
// (`invite-employee` y `platform-admin`).
//
// =============================================================================
// Qué es CORS y por qué hace falta aquí
// =============================================================================
// Cuando la página (por ejemplo https://fullpetcare.pages.dev) llama a una
// URL de OTRO dominio (https://<proyecto>.supabase.co/functions/v1/...) con
// una cabecera `Authorization`, el navegador NO manda el POST de inmediato.
// Primero manda una petición de "permiso" llamada preflight: un `OPTIONS` sin
// cuerpo y sin sesión que pregunta "¿me dejas hacer este POST con estas
// cabeceras?". Si la respuesta no trae las cabeceras `Access-Control-Allow-*`
// correctas, el navegador cancela el POST y el usuario ve "no se pudo
// guardar", sin que el servidor haya recibido nada.
//
// En local, Kong (el gateway de `supabase start`) contesta ese preflight por
// las funciones, por eso nunca falló en desarrollo. En Supabase hospedado
// cada función tiene que contestarlo ella misma.
//
// Por qué `Access-Control-Allow-Origin: *` es aceptable aquí: estas funciones
// se autentican con un token en la cabecera `Authorization`, no con cookies.
// El riesgo que CORS restringe (que otro sitio use las cookies de la víctima)
// no aplica: sin el token, un sitio ajeno no puede hacer nada aunque el
// navegador le deje llamar. Restringirlo a un dominio también rompería los
// previews de Cloudflare Pages, que cambian de dominio en cada PR.

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  // Las cabeceras que manda supabase-js: sin una de ellas en esta lista, el
  // navegador rechaza el preflight.
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Respuesta al preflight: 204 sin cuerpo, solo con las cabeceras de permiso. */
export function preflightResponse(): Response {
  return new Response(null, { status: 204, headers: corsHeaders });
}

/**
 * Copia de `response` con las cabeceras CORS añadidas. Se hace en TODAS las
 * respuestas (también las de error): si un 403 o un 409 no las trae, el
 * navegador oculta el cuerpo y la UI no puede mostrar el mensaje en español
 * de la función, solo un error de red genérico.
 */
export function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Envuelve el manejador de una función: contesta el preflight y añade CORS a
 * todo lo demás. Uso: `Deno.serve(handleCors(async (req) => { ... }))`.
 */
export function handleCors(
  handler: (req: Request) => Promise<Response> | Response,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === "OPTIONS") return preflightResponse();
    return withCors(await handler(req));
  };
}
