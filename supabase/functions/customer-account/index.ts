// Edge Function customer-account (fase 16B, PLAN.md D31): la cuenta del dueño de la mascota.
//
//   POST { action: 'request_code', email, token? }   (sin sesión)
//        → { ok: true }   SIEMPRE, exista o no la cuenta (no revela qué correos están registrados)
//   POST { action: 'overview' }                      (con sesión de dueño)
//        → { businesses: [{ ..., pets: [{ ..., photoUrl }], upcoming }] }
//   POST { action: 'pet', petId }                    (con sesión de dueño)
//        → el detalle de una mascota, o 404 si no es visible para esa cuenta
//   POST { action: 'delete_account' }                (con sesión de dueño)
//        → { ok: true }
//
// Vincular la cuenta con un cliente NO pasa por aquí: lo hace la RPC `claim_customer_link()`
// con la sesión de la propia persona.
//
// =============================================================================
// Por qué verify_jwt = false y se valida la sesión a mano
// =============================================================================
// `request_code` lo llama alguien SIN sesión (todavía no tiene cuenta). Con verify_jwt = true
// la plataforma lo rechazaría antes de ejecutar nada. Por eso aquí se deja apagado y las
// acciones que necesitan sesión la validan ellas mismas con `auth.getUser(jwt)`.
//
// =============================================================================
// Por qué hay service_role y qué lo hace seguro
// =============================================================================
// Las funciones SQL de lectura (`customer_account_overview`, `customer_account_pet_detail`)
// solo las puede llamar service_role, y reciben el id de usuario QUE ESTA FUNCIÓN SACÓ DEL JWT
// VERIFICADO, nunca del cuerpo de la petición. El resto del filtrado (qué mascotas, qué periodo,
// qué montos) vive en esas funciones SQL, con pruebas, no aquí.
//
// Un correo del personal NO recibe código por esta vía: solo cuentas marcadas
// `app_metadata.customer_account = true` (o un correo nuevo con un link válido).
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

import { handleCors } from "../_shared/cors.ts";

const BAD_REQUEST = { message: "Solicitud inválida." };
const UNAUTHORIZED = { message: "Inicia sesión para continuar." };
const NOT_FOUND = { message: "No encontramos esa mascota." };
const FAILED = { message: "No se pudo completar la operación. Intenta de nuevo." };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function emailOf(value: unknown): string | null {
  const v = text(value)?.toLowerCase() ?? null;
  return v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254 ? v : null;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(handleCors(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ message: "Método no permitido." }, { status: 405 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (typeof parsed !== "object" || parsed === null) {
      return Response.json(BAD_REQUEST, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json(BAD_REQUEST, { status: 400 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const publishableKey =
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
  const secretKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY")!;

  const adminClient = createClient(supabaseUrl, secretKey, { auth: { persistSession: false } });

  // ---------------------------------------------------------------------------
  // request_code: sin sesión
  // ---------------------------------------------------------------------------
  if (body.action === "request_code") {
    const email = emailOf(body.email);
    if (!email) return Response.json(BAD_REQUEST, { status: 400 });
    const token = text(body.token);

    // Siempre la misma respuesta: quien llama no puede saber si el correo tiene cuenta.
    const OK = Response.json({ ok: true });

    const { data: found } = await adminClient.rpc("customer_account_user_by_email", {
      p_email: email,
    });
    const existing = (found as Array<{ user_id: string; is_customer_account: boolean }> | null)?.[0];

    let canSend = false;
    if (existing) {
      // Una cuenta del personal no inicia sesión por esta vía.
      canSend = existing.is_customer_account === true;
    } else if (token) {
      // Una cuenta nueva solo nace con un link vigente en la mano (la prueba de que el negocio
      // se lo dio): sin link, nadie puede crear cuentas.
      const hash = await sha256Hex(token);
      const { data: link } = await adminClient
        .from("share_links")
        .select("id, revoked_at, expires_at, scope")
        .eq("token_hash", hash)
        .is("deleted_at", null)
        .maybeSingle();
      const valid =
        link !== null &&
        link.scope === "pet" &&
        link.revoked_at === null &&
        new Date(link.expires_at).getTime() > Date.now();
      if (valid) {
        const { error } = await adminClient.auth.admin.createUser({
          email,
          email_confirm: true,
          app_metadata: { customer_account: true },
          user_metadata: { full_name: email },
        });
        canSend = !error;
        if (error) console.error("customer-account: no se pudo crear la cuenta");
      }
    }

    if (canSend) {
      const anonClient = createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: false },
      });
      const { error } = await anonClient.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });
      // No se le dice a quien llama si falló (p. ej. límite de envíos): solo queda en el log.
      if (error) console.error("customer-account: no se pudo enviar el código");
    }
    return OK;
  }

  // ---------------------------------------------------------------------------
  // El resto exige sesión: se valida el JWT y de ahí sale el id de usuario.
  // ---------------------------------------------------------------------------
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return Response.json(UNAUTHORIZED, { status: 401 });

  const { data: auth, error: authError } = await adminClient.auth.getUser(jwt);
  const user = auth.user;
  if (authError || !user) return Response.json(UNAUTHORIZED, { status: 401 });
  // Solo cuentas de dueño: el personal usa su propia app.
  if (user.app_metadata?.customer_account !== true) {
    return Response.json(UNAUTHORIZED, { status: 401 });
  }

  async function photoUrl(path: string | null): Promise<string | null> {
    if (!path) return null;
    const { data } = await adminClient.storage.from("pet-photos").createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  }

  if (body.action === "overview") {
    const { data, error } = await adminClient.rpc("customer_account_overview", {
      p_user_id: user.id,
    });
    if (error) return Response.json(FAILED, { status: 502 });

    const businesses = await Promise.all(
      ((data ?? []) as Array<{ pets: Array<{ photo_path: string | null }> } & Record<string, unknown>>)
        .map(async (business) => ({
          ...business,
          pets: await Promise.all(
            business.pets.map(async ({ photo_path, ...pet }) => ({
              ...pet,
              photoUrl: await photoUrl(photo_path),
            })),
          ),
        })),
    );
    return Response.json({ businesses });
  }

  if (body.action === "pet") {
    const petId = text(body.petId);
    if (!petId) return Response.json(BAD_REQUEST, { status: 400 });
    const { data, error } = await adminClient.rpc("customer_account_pet_detail", {
      p_user_id: user.id,
      p_pet_id: petId,
    });
    if (error) return Response.json(FAILED, { status: 502 });
    // Una mascota que no es visible se responde como "no existe": sin pistas.
    if (!data) return Response.json(NOT_FOUND, { status: 404 });

    const detail = data as { pet: { photo_path: string | null } } & Record<string, unknown>;
    const { photo_path, ...pet } = detail.pet;
    return Response.json({ ...detail, pet: { ...pet, photoUrl: await photoUrl(photo_path) } });
  }

  if (body.action === "delete_account") {
    // Borra el usuario de Auth: sus vínculos se van en cascada; el expediente del negocio no
    // se toca (CLAUDE.md §8.5).
    // La bitácora apunta al usuario como "quien hizo el cambio" (su propio vínculo): se suelta
    // esa referencia (queda "sin actor") para poder borrar la cuenta sin perder el registro.
    const { error: auditError } = await adminClient
      .from("audit_log")
      .update({ actor_user_id: null })
      .eq("actor_user_id", user.id);
    if (auditError) return Response.json(FAILED, { status: 502 });
    const { error } = await adminClient.auth.admin.deleteUser(user.id);
    if (error) return Response.json(FAILED, { status: 502 });
    return Response.json({ ok: true });
  }

  return Response.json(BAD_REQUEST, { status: 400 });
}));
