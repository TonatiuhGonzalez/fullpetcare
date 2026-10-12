// Edge Function invite-employee (fase 9, CLAUDE.md §6.7 y §10): invita a
// una persona por correo y crea su usuario en auth.users. Es el único
// paso de "dar de alta un empleado" que EXIGE la llave service_role
// (`auth.admin.inviteUserByEmail`) — y esa llave nunca toca el frontend
// (CLAUDE.md §10), así que este pedacito de código vive aquí, en el
// servidor de Supabase, no en el navegador.
//
// El resto del alta (crear el membership, asignar sucursales, guardar
// CURP/RFC/fecha de nacimiento) NO pasa por aquí: eso lo hace el RPC
// `create_employee_membership` (migración
// 20260910120800_create_employee_membership_rpc.sql), llamado por el
// frontend con la sesión NORMAL del dueño, justo después de que esta
// función responde con el `userId`. Se dividió así porque solo el primer
// paso necesita service_role — meter también el segundo aquí sumaría
// código de servidor (más difícil de probar y de leer) donde no hace
// falta.
//
// =============================================================================
// Por qué esta función NO usa @supabase/server (a diferencia de
// public-pet-view)
// =============================================================================
// public-pet-view no tiene sesión — cualquiera con el link la llama — así
// que "auth: none" (sin credencial) le queda perfecto. Aquí SÍ hay
// sesión: quien llama ya inició sesión en la app como dueño (o como quien
// tenga permiso). Pero el modo "user" de @supabase/server exige un JWT
// firmado con JWKS (con un "kid" en el header) — y este proyecto todavía
// firma las sesiones con el secreto compartido clásico (HS256, sin
// "kid"), el mismo motivo por el que public-pet-view tuvo que evitar el
// modo "publishable" para la anon key (ver su propio comentario). Por eso
// aquí se hace lo mismo que hace CUALQUIER pantalla normal del frontend:
// se manda el JWT de la sesión como Authorization header a un cliente de
// supabase-js común, y son las políticas de RLS
// (memberships_select/role_permissions_select) las que de verdad deciden
// qué puede leer ese usuario — esta función solo hace la misma pregunta
// que haría el navegador, no un chequeo especial.
//
// La verificación PLATAFORMA (config.toml: verify_jwt = true para esta
// función, a diferencia de public-pet-view) sí entiende el JWT clásico —
// es un mecanismo distinto al de @supabase/server, más viejo, verificado
// contra el secreto compartido del proyecto. Por eso un request sin sesión
// válida ni siquiera llega a ejecutar el código de abajo.
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { handleCors } from "../_shared/cors.ts";
// Mismo generador que usa platform-admin (aleatoriedad criptográfica,
// alfabeto sin caracteres ambiguos): una sola implementación de "contraseña
// temporal" en todo el proyecto.
import { generateTemporaryPassword } from "../platform-admin/password.ts";
import { parseEmployeeRequest, resetBlockReason, RESET_BLOCK_MESSAGES } from "./request.ts";

// Mismo criterio que INVALID_TOKEN_RESPONSE en public-pet-view: un solo
// mensaje genérico para "no tienes permiso", sin importar si la razón es
// que no eres miembro del negocio, o que tu rol no tiene el permiso
// "employees:edit" — así no se le regala a nadie información de más
// sobre qué le falta.
const FORBIDDEN_RESPONSE = { message: "No tienes permiso para dar de alta empleados." };
const BAD_REQUEST_RESPONSE = { message: "Solicitud inválida." };
const INVITE_FAILED_RESPONSE = { message: "No se pudo invitar a este correo. Intenta de nuevo." };

const RESET_FORBIDDEN_RESPONSE = {
  message: "No tienes permiso para restablecer contraseñas de empleados.",
};
const RESET_NOT_FOUND_RESPONSE = { message: "No se encontró a este empleado." };
const RESET_FAILED_RESPONSE = {
  message: "No se pudo restablecer la contraseña. Intenta de nuevo.",
};

// =============================================================================
// Restablecer la contraseña de un empleado (Correcciones 1, C1.7)
// =============================================================================
// Se llama DESPUÉS del paso 1 (quien llama ya demostró ser miembro con
// employees:edit). Aquí se revalida al OBJETIVO y recién entonces se usa
// service_role. El patrón es el de platform-admin/reset_password (§7.5):
// bitácora primero, contraseña, cerrar sesiones, marcar cambio obligatorio.
//
// La contraseña temporal se genera aquí, viaja en la respuesta UNA vez y no
// se escribe en ningún log ni en la bitácora.
async function resetEmployeePassword(args: {
  supabaseUrl: string;
  secretKey: string;
  callerClient: SupabaseClient;
  callerUserId: string;
  tenantId: string;
  membershipId: string;
}): Promise<Response> {
  const { callerClient, callerUserId, tenantId, membershipId } = args;

  // El objetivo se lee con RLS de quien llama Y filtrando por el negocio: una
  // membresía de otro negocio simplemente "no existe" para esta función.
  const { data: target, error: targetError } = await callerClient
    .from("memberships")
    .select("id, user_id, role, is_active, deleted_at")
    .eq("id", membershipId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (targetError) {
    return Response.json(RESET_FAILED_RESPONSE, { status: 502 });
  }
  if (!target) {
    return Response.json(RESET_NOT_FOUND_RESPONSE, { status: 404 });
  }

  const blocked = resetBlockReason(callerUserId, {
    userId: target.user_id as string,
    role: target.role as string,
    isActive: target.is_active as boolean,
    isDeleted: target.deleted_at !== null,
  });
  if (blocked) {
    return Response.json({ message: RESET_BLOCK_MESSAGES[blocked] }, { status: 409 });
  }

  const targetUserId = target.user_id as string;
  const adminClient = createClient(args.supabaseUrl, args.secretKey, {
    auth: { persistSession: false },
  });

  const { data: targetUser, error: getUserError } =
    await adminClient.auth.admin.getUserById(targetUserId);
  if (getUserError || !targetUser.user) {
    return Response.json(RESET_FAILED_RESPONSE, { status: 502 });
  }
  const employeeEmail = targetUser.user.email ?? "";

  // Bitácora PRIMERO (mismo principio que §7.5): si no se puede registrar, no
  // se cambia la contraseña. Va en audit_log (la bitácora del negocio, que lee
  // el dueño), con `actor_user_id` = quien restablece. La columna `action` es
  // un enum INSERT/UPDATE/DELETE: se usa UPDATE sobre la membresía y el hecho
  // real va en new_data.event. Nunca lleva la contraseña.
  const writeAudit = (event: string) =>
    adminClient.from("audit_log").insert({
      tenant_id: tenantId,
      table_name: "memberships",
      record_id: membershipId,
      action: "UPDATE",
      actor_user_id: callerUserId,
      new_data: { event, target_user_id: targetUserId, target_email: employeeEmail },
    });

  const { error: logError } = await writeAudit("password_reset");
  if (logError) {
    return Response.json(RESET_FAILED_RESPONSE, { status: 502 });
  }

  const password = generateTemporaryPassword();
  const { error: updateError } = await adminClient.auth.admin.updateUserById(targetUserId, {
    password,
  });
  if (updateError) {
    await writeAudit("password_reset_failed");
    return Response.json(RESET_FAILED_RESPONSE, { status: 502 });
  }

  // DESPUÉS de cambiar la contraseña: cerrar sesiones (cinturón, ver
  // platform-admin) y marcar el cambio obligatorio (§7.6: un trigger apaga la
  // marca con cualquier cambio de hash, así que va al final). Si alguno falla
  // la contraseña YA cambió: se responde 200 avisando, para no perderla.
  const { error: revokeError } = await adminClient.rpc("revoke_user_sessions", {
    p_user_id: targetUserId,
  });
  const { error: markError } = await adminClient
    .from("profiles")
    .update({ must_change_password: true })
    .eq("id", targetUserId);
  if (markError) {
    console.error("invite-employee: no se pudo marcar el cambio obligatorio", targetUserId);
  }

  return Response.json({
    employeeEmail,
    temporaryPassword: password,
    sessionsRevoked: !revokeError,
    mustChangeEnforced: !markError,
  });
}

Deno.serve(handleCors(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ message: "Método no permitido." }, { status: 405 });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const callerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  // El chequeo de config.toml (verify_jwt = true) ya debería rechazar un
  // request sin JWT antes de llegar aquí — esto es una segunda capa
  // barata, no la única (CLAUDE.md §7.3.4: nunca confiar en una sola
  // capa de validación).
  if (!callerToken) {
    return Response.json(FORBIDDEN_RESPONSE, { status: 403 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return Response.json(BAD_REQUEST_RESPONSE, { status: 400 });
  }

  const body = parseEmployeeRequest(rawBody);
  if (!body) {
    return Response.json(BAD_REQUEST_RESPONSE, { status: 400 });
  }
  // Mismo criterio de mensaje único, uno por acción.
  const forbidden = body.action === "reset_password" ? RESET_FORBIDDEN_RESPONSE : FORBIDDEN_RESPONSE;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  // La llave pública normal (la misma que usa el navegador) — aquí solo
  // sirve para construir un cliente que respeta RLS con el JWT de quien
  // llama. Nunca se usa para saltarse nada.
  const publishableKey =
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
  const secretKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY")!;

  const callerClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${callerToken}` } },
    auth: { persistSession: false },
  });

  // =============================================================================
  // Paso 1 — revalida con las credenciales de QUIEN LLAMA (RLS normal,
  // nada de service_role todavía). Mismo chequeo que hace
  // app.has_permission() en SQL, pero en TypeScript: un Edge Function no
  // puede invocar una función `app.*` de Postgres sin pasar por
  // PostgREST, así que se repite aquí la pregunta con dos SELECT
  // normales. Esta revalidación NO es la única capa: el RPC
  // create_employee_membership (llamado después, por el frontend) vuelve
  // a preguntar lo mismo antes de escribir nada — así que ni un error
  // aquí abre una brecha real, en el peor caso solo gastaría una
  // invitación de más.
  // =============================================================================
  // memberships_select deja ver TODAS las membresías de un tenant al que
  // perteneces, no solo la tuya (mismo comentario en
  // services/memberships.ts#listMyMemberships) — así que hace falta
  // filtrar también por TU propio user_id, o la consulta trae varias
  // filas y `maybeSingle()` truena con "multiple rows returned".
  const { data: caller } = await callerClient.auth.getUser();
  const callerUserId = caller.user?.id;
  if (!callerUserId) {
    return Response.json(FORBIDDEN_RESPONSE, { status: 403 });
  }

  const { data: membership } = await callerClient
    .from("memberships")
    .select("role")
    .eq("tenant_id", body.tenantId)
    .eq("user_id", callerUserId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .maybeSingle();

  if (!membership) {
    return Response.json(forbidden, { status: 403 });
  }

  let canInvite = membership.role === "owner";
  if (!canInvite) {
    const { data: permission } = await callerClient
      .from("role_permissions")
      .select("can_edit")
      .eq("tenant_id", body.tenantId)
      .eq("role", membership.role)
      .eq("module", "employees")
      .maybeSingle();
    canInvite = permission?.can_edit ?? false;
  }

  if (!canInvite) {
    return Response.json(forbidden, { status: 403 });
  }

  if (body.action === "reset_password") {
    return await resetEmployeePassword({
      supabaseUrl,
      secretKey,
      callerClient,
      callerUserId,
      tenantId: body.tenantId,
      membershipId: body.membershipId,
    });
  }

  // =============================================================================
  // Paso 2 — SOLO a partir de aquí se usa service_role: invita al correo.
  // Esto crea la fila en auth.users; el trigger
  // app.handle_new_auth_user() (fase 1, profile_on_signup.sql) crea el
  // "profile" correspondiente en la MISMA transacción, leyendo
  // "full_name" de los metadatos que se mandan aquí.
  // =============================================================================
  const adminClient = createClient(supabaseUrl, secretKey);

  const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
    body.email,
    { data: { full_name: body.fullName } },
  );

  if (!inviteError) {
    return Response.json({ userId: invited.user.id });
  }

  // El correo ya tiene cuenta en el sistema — puede ser una persona que
  // ya trabaja en OTRO negocio de FullPetCare (modelo válido, CLAUDE.md
  // §6.1: "profiles" no tiene tenant_id, la misma persona puede tener
  // membership en dos tenants). En vez de fallar, se reutiliza su id: el
  // RPC create_employee_membership es quien de todos modos rechaza un
  // alta duplicada EN ESTE mismo tenant (unique(tenant_id, user_id)).
  const alreadyRegistered = /already.*registered|already exists/i.test(inviteError.message);
  if (!alreadyRegistered) {
    return Response.json(INVITE_FAILED_RESPONSE, { status: 502 });
  }

  // listUsers() no tiene un filtro por correo en la API de admin — para
  // el tamaño de un demo (decenas de usuarios) recorrer la primera
  // página alcanza; si este proyecto creciera a miles de usuarios reales
  // haría falta paginar. CLAUDE.md §11: "simple sobre elegante".
  const { data: existingUsers, error: listError } = await adminClient.auth.admin.listUsers();
  const existing = listError
    ? undefined
    : existingUsers.users.find((u) => u.email?.toLowerCase() === body.email);

  if (!existing) {
    return Response.json(INVITE_FAILED_RESPONSE, { status: 502 });
  }

  return Response.json({ userId: existing.id });
}));
