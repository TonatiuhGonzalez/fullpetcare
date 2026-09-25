// Edge Function platform-admin (fase 10, tarea 10.5): las operaciones del
// panel de superadmin que EXIGEN la llave service_role — crear el usuario de
// Auth del dueño de una empresa nueva, cambiarle la contraseña y cerrarle
// las sesiones. Esa llave nunca toca el frontend (CLAUDE.md §10), así que
// esos pasos viven aquí, en el servidor de Supabase.
//
// UNA sola función con varias acciones (decisión del usuario, en vez de
// tres funciones): un único punto que revalida "¿quien llama es
// superadmin?" — tres funciones serían tres copias de esa revalidación, y
// la que se olvide de ella es una puerta abierta.
//
//   POST { action: 'create_tenant',   tenantName, branchName, ownerFullName, ownerEmail, ownerPhone?, isDemo? }
//        → { tenantId, ownerUserId, temporaryPassword }
//   POST { action: 'reset_password',  tenantId }
//        → { ownerEmail, temporaryPassword, sessionsRevoked }
//   POST { action: 'add_admin',       fullName, email }
//        → { userId, temporaryPassword }
//
// =============================================================================
// Cómo se reparte el trabajo (leer antes de tocar este archivo)
// =============================================================================
// Hay DOS clientes de Supabase, con permisos muy distintos:
//
//   callerClient — construido con el JWT de QUIEN LLAMA. Respeta RLS y
//     `auth.uid()` es el superadmin. Se usa para (1) verificar que es
//     superadmin y (2) llamar las RPC `platform_*`. Así la bitácora
//     (platform_audit_log) registra al superadmin real como actor. Con
//     service_role `auth.uid()` es NULL y todo quedaría como "nadie".
//
//   adminClient — con service_role. Salta RLS. Se usa SOLO para lo que
//     nada más puede hacer: la API de administración de Auth (crear
//     usuario, cambiar contraseña, borrar usuario) y leer quién es el dueño
//     de una empresa para el reset.
//
// Mismo motivo que invite-employee para no usar @supabase/server (este
// proyecto firma sesiones con el secreto clásico HS256, no con JWKS) y para
// dejar `verify_jwt = true` en config.toml: un request sin sesión válida ni
// siquiera llega a ejecutar este código.
//
// La contraseña temporal SE GENERA AQUÍ y viaja en la respuesta, una sola
// vez, hasta la pantalla del superadmin. Nunca se escribe en un log ni en la
// bitácora (platform_log_event ni siquiera tiene dónde recibirla).
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { handleCors } from "../_shared/cors.ts";
import { generateTemporaryPassword } from "./password.ts";

const FORBIDDEN_RESPONSE = { message: "No tienes permiso para administrar la plataforma." };
const BAD_REQUEST_RESPONSE = { message: "Solicitud inválida." };
const EMAIL_TAKEN_RESPONSE = {
  message: "Este correo ya está registrado. Usa otro correo.",
};
const FAILED_RESPONSE = { message: "No se pudo completar la operación. Intenta de nuevo." };

type Body =
  | {
      action: "create_tenant";
      tenantName: string;
      branchName: string;
      ownerFullName: string;
      ownerEmail: string;
      ownerPhone: string | null;
      isDemo: boolean;
    }
  | { action: "reset_password"; tenantId: string }
  | { action: "add_admin"; fullName: string; email: string };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

// Validación mínima de forma. La validación "de verdad" del formulario
// (correo, teléfono) vive en el frontend (lib/validation.ts); aquí solo se
// rechaza lo que ni siquiera tiene forma, para no crear un usuario de Auth
// con un correo sin sentido.
function email(value: unknown): string | null {
  const v = text(value)?.toLowerCase() ?? null;
  return v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

function parseBody(value: unknown): Body | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  switch (raw.action) {
    case "create_tenant": {
      const tenantName = text(raw.tenantName);
      const branchName = text(raw.branchName);
      const ownerFullName = text(raw.ownerFullName);
      const ownerEmail = email(raw.ownerEmail);
      if (!tenantName || !branchName || !ownerFullName || !ownerEmail) return null;
      return {
        action: "create_tenant",
        tenantName,
        branchName,
        ownerFullName,
        ownerEmail,
        ownerPhone: text(raw.ownerPhone),
        // Solo `true` estricto marca demo; cualquier otra cosa (falta, "true", 1) es false.
        isDemo: raw.isDemo === true,
      };
    }
    case "reset_password": {
      const tenantId = text(raw.tenantId);
      return tenantId ? { action: "reset_password", tenantId } : null;
    }
    case "add_admin": {
      const fullName = text(raw.fullName);
      const adminEmail = email(raw.email);
      return fullName && adminEmail ? { action: "add_admin", fullName, email: adminEmail } : null;
    }
    default:
      return null;
  }
}

/**
 * Crea el usuario de Auth con contraseña temporal ya confirmado (sin correo
 * de verificación: el superadmin le entrega la contraseña al dueño).
 * `full_name` en los metadatos es lo que lee el trigger
 * app.handle_new_auth_user() para crear el profile (fase 1).
 *
 * Si el correo ya existe devuelve "email_taken" en vez de reutilizar la
 * cuenta (a diferencia de invite-employee): aquí se le pone una contraseña
 * NUEVA, y hacerlo sobre una cuenta que ya pertenece a otro negocio sería
 * secuestrarla.
 */
async function createAuthUser(
  adminClient: SupabaseClient,
  emailAddress: string,
  fullName: string,
): Promise<{ userId: string; password: string } | "email_taken" | "failed"> {
  const password = generateTemporaryPassword();
  const { data, error } = await adminClient.auth.admin.createUser({
    email: emailAddress,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (error) {
    return /already.*registered|already exists|email_exists/i.test(`${error.code} ${error.message}`)
      ? "email_taken"
      : "failed";
  }
  return { userId: data.user.id, password };
}

/**
 * Traduce un error de una RPC `platform_*` a una respuesta. Los mensajes de
 * esas RPC ya están en español y sin jerga (los escribimos nosotros con
 * `raise exception`), así que se pasan tal cual; cualquier otro error se
 * esconde tras el mensaje genérico (CLAUDE.md §5.4: sin "PGRST116").
 */
function rpcErrorResponse(error: { code?: string; message: string }): Response {
  // 42501 insufficient_privilege, 23514 check_violation, 23503
  // foreign_key_violation, 23505 unique_violation, P0002 no_data_found.
  const status = error.code === "42501" ? 403 : 400;
  const isOurs = ["42501", "23514", "23503", "23505", "P0002"].includes(error.code ?? "");
  return Response.json(isOurs ? { message: error.message } : FAILED_RESPONSE, {
    status: isOurs ? status : 502,
  });
}

Deno.serve(handleCors(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ message: "Método no permitido." }, { status: 405 });
  }

  const callerToken = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  // Segunda capa: verify_jwt = true ya debería rechazar esto antes de llegar.
  if (!callerToken) {
    return Response.json(FORBIDDEN_RESPONSE, { status: 403 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return Response.json(BAD_REQUEST_RESPONSE, { status: 400 });
  }
  const body = parseBody(rawBody);
  if (!body) {
    return Response.json(BAD_REQUEST_RESPONSE, { status: 400 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const publishableKey =
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
  const secretKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY")!;

  const callerClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${callerToken}` } },
    auth: { persistSession: false },
  });

  // ===========================================================================
  // Paso 1 — ¿quien llama es superadmin? (todavía sin service_role)
  // ===========================================================================
  // La política de SELECT de platform_admins solo deja ver filas a un
  // superadmin: si esta consulta devuelve la fila propia, lo es; si no, RLS
  // la oculta y llega vacía. No hay que interpretar nada más.
  const { data: caller } = await callerClient.auth.getUser();
  const callerUserId = caller.user?.id;
  if (!callerUserId) {
    return Response.json(FORBIDDEN_RESPONSE, { status: 403 });
  }

  const { data: adminRow } = await callerClient
    .from("platform_admins")
    .select("id")
    .eq("user_id", callerUserId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!adminRow) {
    return Response.json(FORBIDDEN_RESPONSE, { status: 403 });
  }

  // ===========================================================================
  // Paso 2 — SOLO a partir de aquí existe el cliente con service_role
  // ===========================================================================
  const adminClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false },
  });

  switch (body.action) {
    case "create_tenant": {
      const created = await createAuthUser(adminClient, body.ownerEmail, body.ownerFullName);
      if (created === "email_taken") {
        return Response.json(EMAIL_TAKEN_RESPONSE, { status: 409 });
      }
      if (created === "failed") {
        return Response.json(FAILED_RESPONSE, { status: 502 });
      }

      const { data: tenant, error } = await callerClient.rpc("platform_create_tenant", {
        p_user_id: created.userId,
        p_tenant_name: body.tenantName,
        p_branch_name: body.branchName,
        p_owner_full_name: body.ownerFullName,
        p_owner_phone: body.ownerPhone,
        p_is_demo: body.isDemo,
      });

      if (error) {
        // La RPC es todo-o-nada: si falló, no quedó negocio ni membresía.
        // Solo sobra el usuario de Auth que se acaba de crear arriba; se
        // borra para no dejar una cuenta huérfana que además bloquearía
        // reintentar con el mismo correo ("ya está registrado").
        const { error: cleanupError } = await adminClient.auth.admin.deleteUser(created.userId);
        if (cleanupError) {
          console.error("platform-admin: no se pudo borrar el usuario huérfano", created.userId);
        }
        return rpcErrorResponse(error);
      }

      return Response.json({
        tenantId: (tenant as { id: string }).id,
        ownerUserId: created.userId,
        temporaryPassword: created.password,
      });
    }

    case "add_admin": {
      const created = await createAuthUser(adminClient, body.email, body.fullName);
      if (created === "email_taken") {
        return Response.json(EMAIL_TAKEN_RESPONSE, { status: 409 });
      }
      if (created === "failed") {
        return Response.json(FAILED_RESPONSE, { status: 502 });
      }

      const { error } = await callerClient.rpc("platform_add_admin", { p_user_id: created.userId });
      if (error) {
        await adminClient.auth.admin.deleteUser(created.userId);
        return rpcErrorResponse(error);
      }

      return Response.json({ userId: created.userId, temporaryPassword: created.password });
    }

    case "reset_password": {
      // Quién es el dueño: la membresía activa con role = 'owner'. Un solo
      // dueño por empresa (decisión de la fase 10).
      const { data: ownership, error: ownerError } = await adminClient
        .from("memberships")
        .select("user_id")
        .eq("tenant_id", body.tenantId)
        .eq("role", "owner")
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("created_at")
        .limit(1)
        .maybeSingle();

      if (ownerError) {
        return Response.json(FAILED_RESPONSE, { status: 502 });
      }
      if (!ownership) {
        return Response.json(
          { message: "Esta empresa no tiene un dueño activo." },
          { status: 404 },
        );
      }

      const ownerUserId = ownership.user_id as string;
      const { data: ownerData, error: getUserError } =
        await adminClient.auth.admin.getUserById(ownerUserId);
      if (getUserError || !ownerData.user) {
        return Response.json(FAILED_RESPONSE, { status: 502 });
      }
      const ownerEmail = ownerData.user.email ?? "";

      // Bitácora PRIMERO: si no se puede registrar, no se cambia nada — una
      // contraseña cambiada sin rastro es exactamente lo que la bitácora
      // existe para evitar. Y es seguro reintentar: todavía no se tocó nada.
      const { error: logError } = await callerClient.rpc("platform_log_event", {
        p_tenant_id: body.tenantId,
        p_event: "password_reset",
        p_record_id: ownerUserId,
        p_details: { owner_email: ownerEmail },
      });
      if (logError) {
        return rpcErrorResponse(logError);
      }

      const password = generateTemporaryPassword();
      const { error: updateError } = await adminClient.auth.admin.updateUserById(ownerUserId, {
        password,
      });
      if (updateError) {
        // Deja constancia de que el intento anterior no llegó a cambiar nada.
        await callerClient.rpc("platform_log_event", {
          p_tenant_id: body.tenantId,
          p_event: "password_reset_failed",
          p_record_id: ownerUserId,
          p_details: { owner_email: ownerEmail },
        });
        return Response.json(FAILED_RESPONSE, { status: 502 });
      }

      // DESPUÉS de cambiar la contraseña, se cierran las sesiones abiertas.
      // (Al revés, alguien podría iniciar sesión con la contraseña vieja
      // justo entre los dos pasos y esa sesión sobreviviría.)
      //
      // Nota honesta: la versión de GoTrue (Supabase Auth) con la que se
      // desarrolló esto YA elimina las sesiones al cambiar la contraseña por
      // la API de admin (se comprobó a mano: 1 sesión antes, 0 después). Este
      // paso explícito es un cinturón adicional: la garantía "cambiar la
      // contraseña cierra las sesiones" no debe depender de un efecto
      // secundario que puede cambiar entre versiones. Por lo mismo, los
      // tests no pueden distinguir si lo hizo GoTrue o este paso. Si esto
      // falla, la contraseña YA cambió y el superadmin necesita
      // recibirla igual: se responde 200 avisando que las sesiones no se
      // cerraron, en vez de un error que perdería la contraseña nueva.
      const { error: revokeError } = await adminClient.rpc("revoke_user_sessions", {
        p_user_id: ownerUserId,
      });

      return Response.json({
        ownerEmail,
        temporaryPassword: password,
        sessionsRevoked: !revokeError,
      });
    }
  }
}));
