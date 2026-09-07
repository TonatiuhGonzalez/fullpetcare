// Edge Function pública (tarea 7.4, CLAUDE.md §7.4): sirve la ficha de
// una mascota a quien tenga el link, SIN sesión de por medio.
//
// =============================================================================
// Qué es una Edge Function, para quien nunca escribió una
// =============================================================================
// Hasta ahora, TODO lo que la app hace con datos pasa por Postgres
// directo (PostgREST + RLS) — el navegador habla con la base con la
// sesión del empleado, y las políticas deciden qué ve. Una Edge Function
// es otra cosa: un pedacito de código de servidor (aquí, Deno — un
// runtime de JavaScript/TypeScript, no Node, pero el mismo lenguaje) que
// Supabase aloja y ejecuta por su cuenta, con SU PROPIA URL
// (`/functions/v1/public-pet-view`). El navegador la llama como cualquier
// API HTTP normal — no toca Postgres para nada.
//
// =============================================================================
// Por qué corre con service_role (`ctx.supabaseAdmin`), y por qué eso
// SOLO es seguro si valida antes
// =============================================================================
// El visitante de `/c/:token` no tiene sesión — no hay ningún `auth.uid()`
// que una política de RLS pueda comparar contra un `tenant_id`. Si esta
// función consultara con RLS normal (como un usuario cualquiera), no
// vería nada, porque RLS está diseñado para negarle todo a quien no
// pertenece a un tenant (CLAUDE.md §7). Por eso usa `ctx.supabaseAdmin`
// (la llave `service_role`, que SALTA todas las políticas de RLS) — es la
// ÚNICA manera de que este código pueda leer la mascota correcta sin una
// sesión de personal detrás.
//
// Y esto es exactamente lo peligroso de un service_role: si esta función
// tuviera un error y devolviera datos sin validar el token primero,
// cualquiera podría pedir CUALQUIER mascota de CUALQUIER negocio. La
// seguridad completa de este endpoint depende de que, ANTES de leer una
// sola fila de negocio, se verifique el token contra `share_links` y se
// saquen de AHÍ (nunca del cuerpo de la petición) el `tenant_id` y el
// `pet_id` — todo lo que se consulta después se filtra por esos dos
// valores, sin excepción. Es el mismo principio que CLAUDE.md §7.3 regla 4
// exige para cualquier función `SECURITY DEFINER` en Postgres, aplicado
// aquí del lado de una Edge Function.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

// Misma respuesta, sin importar la razón real (token inexistente, mal
// formado, revocado, o expirado) — CLAUDE.md §7.4 lo pide explícito: si
// el mensaje cambiara según el caso, alguien podría usarlo para adivinar
// "¿este token alguna vez existió?" sin tener el token de verdad. Nunca
// se explica el motivo real en la respuesta.
const INVALID_TOKEN_RESPONSE = { message: "Este link no es válido o ya venció." };

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digestBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digestBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export default {
  fetch: withSupabase({ auth: "publishable" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json(INVALID_TOKEN_RESPONSE, { status: 404 });
    }

    let token: unknown;
    try {
      ({ token } = await req.json());
    } catch {
      return Response.json(INVALID_TOKEN_RESPONSE, { status: 404 });
    }

    if (typeof token !== "string" || token.length === 0) {
      return Response.json(INVALID_TOKEN_RESPONSE, { status: 404 });
    }

    const tokenHash = await sha256Hex(token);

    // 1) Busca el link por su HASH — nunca se guarda el token en claro
    // (services/shareLinks.ts, tarea 7.2), así que esto es lo único que
    // se puede comparar.
    const { data: link } = await ctx.supabaseAdmin
      .from("share_links")
      .select("id, tenant_id, pet_id, scope, revoked_at, expires_at, access_count")
      .eq("token_hash", tokenHash)
      .is("deleted_at", null)
      .maybeSingle();

    const isValidLink =
      link !== null &&
      link.scope === "pet" &&
      link.revoked_at === null &&
      new Date(link.expires_at).getTime() > Date.now();

    if (!isValidLink) {
      return Response.json(INVALID_TOKEN_RESPONSE, { status: 404 });
    }

    // A partir de aquí, tenant_id y pet_id SIEMPRE salen del link que
    // acaba de validarse — jamás del cuerpo de la petición. Es la
    // garantía de aislamiento (tarea 7.6): aunque alguien mande un
    // `pet_id` distinto en el body, esta función ni siquiera lo lee.
    const tenantId = link.tenant_id;
    const petId = link.pet_id;

    const { data: pet } = await ctx.supabaseAdmin
      .from("pets")
      .select("name, species, breed, sex, birth_date, photo_path")
      .eq("id", petId)
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .maybeSingle();

    // Un link válido apuntando a una mascota que ya no existe (borrado
    // suave) es un caso raro, pero se trata igual que un token inválido —
    // misma respuesta genérica, nunca "la mascota fue eliminada".
    if (!pet) {
      return Response.json(INVALID_TOKEN_RESPONSE, { status: 404 });
    }

    const { data: tenant } = await ctx.supabaseAdmin
      .from("tenants")
      .select("name")
      .eq("id", tenantId)
      .maybeSingle();

    const photoUrl = pet.photo_path
      ? (
          await ctx.supabaseAdmin.storage
            .from("pet-photos")
            .createSignedUrl(pet.photo_path, 60)
        ).data?.signedUrl ?? null
      : null;

    const { data: vaccinations } = await ctx.supabaseAdmin
      .from("vaccinations")
      .select("applied_at, next_due_date, vaccines ( name )")
      .eq("tenant_id", tenantId)
      .eq("pet_id", petId)
      .order("applied_at", { ascending: false });

    // Solo citas COMPLETADAS entran al historial — una agendada o en
    // curso no es una "visita" todavía.
    const { data: pastAppointments } = await ctx.supabaseAdmin
      .from("appointments")
      .select(
        "kind, starts_at, employee_user_id, branches ( timezone ), grooming_records ( cut_style ), medical_records ( diagnosis )",
      )
      .eq("tenant_id", tenantId)
      .eq("pet_id", petId)
      .eq("status", "completed")
      .is("deleted_at", null)
      .order("starts_at", { ascending: false });

    const { data: upcomingAppointments } = await ctx.supabaseAdmin
      .from("appointments")
      .select("kind, starts_at, branches ( timezone )")
      .eq("tenant_id", tenantId)
      .eq("pet_id", petId)
      .eq("status", "scheduled")
      .is("deleted_at", null)
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true });

    // Los nombres de quien atendió SÍ se muestran (CLAUDE.md §7.4 lo
    // permite explícitamente) — el resto del personal, no.
    const employeeIds = [...new Set((pastAppointments ?? []).map((a) => a.employee_user_id))];
    const { data: employeeProfiles } = employeeIds.length
      ? await ctx.supabaseAdmin.from("profiles").select("id, full_name").in("id", employeeIds)
      : { data: [] as { id: string; full_name: string }[] };
    const employeeNameById = new Map((employeeProfiles ?? []).map((p) => [p.id, p.full_name]));

    // 2) Registra el acceso — DESPUÉS de confirmar que el token era
    // válido, no antes (un intento fallido no cuenta como "visita").
    await ctx.supabaseAdmin
      .from("share_links")
      .update({
        access_count: link.access_count + 1,
        last_accessed_at: new Date().toISOString(),
      })
      .eq("id", link.id);

    // 3) Lista blanca de la respuesta (tarea 7.8): exactamente estos
    // campos, nada del expediente completo, ni teléfonos/correos, ni
    // montos, ni ids de otras filas.
    return Response.json({
      businessName: tenant?.name ?? "",
      pet: {
        name: pet.name,
        species: pet.species,
        breed: pet.breed,
        sex: pet.sex,
        birthDate: pet.birth_date,
        photoUrl,
      },
      vaccinations: (vaccinations ?? []).map((v) => ({
        vaccineName: v.vaccines?.name ?? "",
        appliedAt: v.applied_at,
        nextDueDate: v.next_due_date,
      })),
      visits: (pastAppointments ?? []).map((a) => ({
        kind: a.kind,
        startsAt: a.starts_at,
        branchTimezone: a.branches?.timezone ?? "America/Mexico_City",
        employeeName: employeeNameById.get(a.employee_user_id) ?? "",
        detail: a.kind === "grooming" ? (a.grooming_records?.cut_style ?? null) : (a.medical_records?.diagnosis ?? null),
      })),
      upcomingAppointments: (upcomingAppointments ?? []).map((a) => ({
        kind: a.kind,
        startsAt: a.starts_at,
        branchTimezone: a.branches?.timezone ?? "America/Mexico_City",
      })),
    });
  }),
};
