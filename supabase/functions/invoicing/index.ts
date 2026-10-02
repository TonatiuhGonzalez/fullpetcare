// Edge Function invoicing (fase 11, CLAUDE.md §10 y PLAN.md D16): la ÚNICA que
// habla con el PAC (Facturapi). Hoy tiene una sola acción, `setup`
// (tarea 11.15); `stamp`, `cancel` y `download` llegan con la 11.18.
//
// Qué hace `setup`, en orden:
//   1. Revalida con el JWT de quien llama que es el DUEÑO de ese negocio y que
//      el negocio no está en solo lectura (RPC can_manage_invoicing).
//   2. Lee los datos fiscales del negocio (con RLS, como el navegador).
//   3. Si el negocio aún no tiene organización en el PAC, la crea; luego le
//      manda sus datos fiscales (RFC, razón social, régimen, código postal).
//   4. Si vienen los archivos del certificado (.cer, .key y su contraseña),
//      los manda al PAC y SOLO guarda la vigencia que el PAC devuelve.
//
// Por qué el certificado "no se guarda": el CSD (Certificado de Sello Digital)
// es la firma electrónica con la que el negocio sella sus facturas. Quien lo
// tenga puede facturar a nombre del negocio, así que no queremos custodiarlo:
// los bytes pasan por la memoria de esta función y se van al PAC. Nunca se
// escriben en la base ni en Storage, y tampoco en los logs (por eso aquí no hay
// ningún console.log del cuerpo de la petición ni de las respuestas del PAC).
//
// La llave del PAC (FACTURAPI_USER_KEY) es un secreto de la función, igual que
// la service_role: jamás viaja al navegador.
//
// Secretos que lee (supabase secrets set ...):
//   FACTURAPI_USER_KEY  llave de usuario de Facturapi (sandbox en local/staging)
//   FACTURAPI_BASE_URL  opcional; por defecto https://www.facturapi.io/v2
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

import { handleCors } from "../_shared/cors.ts";

const FORBIDDEN_RESPONSE = { message: "No tienes permiso para configurar la facturación." };
const BAD_REQUEST_RESPONSE = { message: "Solicitud inválida." };
const NOT_CONFIGURED_RESPONSE = {
  message: "La facturación todavía no está disponible. Intenta más tarde.",
};
const PAC_FAILED_RESPONSE = {
  message: "No se pudo comunicar con el proveedor de facturas. Intenta de nuevo.",
};
const MAX_FILE_BYTES = 64 * 1024; // un .cer/.key real pesa unos pocos KB

// Mismas reglas que lib/fiscalSetup.ts y la RPC update_tenant_fiscal_data.
// Se repiten porque la función no puede importar de src/ (Deno aparte), y
// porque nunca se confía en una sola capa (§7.3.4).
const RFC_REGEX = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const POSTAL_CODE_REGEX = /^\d{5}$/;

function missingFiscalData(t: Record<string, string | null>): string | null {
  if (!t.rfc || !RFC_REGEX.test(t.rfc)) return "el RFC";
  if (!t.legal_name?.trim()) return "la razón social";
  if (!t.tax_regime_code) return "el régimen fiscal";
  if (!t.postal_code || !POSTAL_CODE_REGEX.test(t.postal_code)) return "el código postal";
  return null;
}

class PacError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

// Llamada al PAC. `body` puede ser JSON o FormData (el certificado va como
// multipart). Si el PAC contesta con error se lanza PacError SIN el cuerpo de
// la respuesta en el mensaje: ahí podría venir eco de datos del certificado.
async function pacRequest(
  method: string,
  path: string,
  body?: Record<string, unknown> | FormData,
): Promise<Record<string, unknown>> {
  const baseUrl = Deno.env.get("FACTURAPI_BASE_URL") ?? "https://www.facturapi.io/v2";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${Deno.env.get("FACTURAPI_USER_KEY")}`,
  };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body; // fetch pone el Content-Type con su boundary
  } else if (body) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  if (!response.ok) {
    throw new PacError(`PAC ${method} ${path} → ${response.status}`, response.status);
  }
  return await response.json();
}

Deno.serve(handleCors(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ message: "Método no permitido." }, { status: 405 });
  }

  const callerToken = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!callerToken) {
    return Response.json(FORBIDDEN_RESPONSE, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json(BAD_REQUEST_RESPONSE, { status: 400 });
  }

  const action = form.get("action");
  const tenantId = form.get("tenantId");
  if (action !== "setup" || typeof tenantId !== "string" || tenantId.length === 0) {
    return Response.json(BAD_REQUEST_RESPONSE, { status: 400 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const publishableKey =
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
  const callerClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${callerToken}` } },
    auth: { persistSession: false },
  });

  // Paso 1 — permiso, ANTES de tocar el PAC o la llave de servicio.
  const { data: allowed } = await callerClient.rpc("can_manage_invoicing", {
    p_tenant_id: tenantId,
  });
  if (allowed !== true) {
    return Response.json(FORBIDDEN_RESPONSE, { status: 403 });
  }

  // Los archivos se validan antes de hablar con el PAC: así un archivo mal
  // elegido falla rápido y sin gastar una llamada.
  const cer = form.get("cer");
  const key = form.get("key");
  const password = form.get("password");
  const hasCertificate = cer !== null || key !== null || password !== null;
  if (hasCertificate) {
    if (!(cer instanceof File) || !(key instanceof File) || typeof password !== "string") {
      return Response.json(
        { message: "Para subir el certificado se necesitan el archivo .cer, el .key y la contraseña." },
        { status: 400 },
      );
    }
    if (!password) {
      return Response.json({ message: "Falta la contraseña de la llave privada." }, { status: 400 });
    }
    if (cer.size === 0 || key.size === 0 || cer.size > MAX_FILE_BYTES || key.size > MAX_FILE_BYTES) {
      return Response.json({ message: "Los archivos del certificado no son válidos." }, { status: 400 });
    }
  }

  if (!Deno.env.get("FACTURAPI_USER_KEY")) {
    return Response.json(NOT_CONFIGURED_RESPONSE, { status: 503 });
  }

  // Paso 2 — datos fiscales, leídos con RLS (el dueño lee su propio negocio).
  const { data: tenant } = await callerClient
    .from("tenants")
    .select("name, rfc, legal_name, tax_regime_code, postal_code")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenant) {
    return Response.json(FORBIDDEN_RESPONSE, { status: 403 });
  }
  const missing = missingFiscalData(tenant);
  if (missing) {
    return Response.json({ message: `Falta completar ${missing} antes de continuar.` }, { status: 422 });
  }

  // Paso 3 — SOLO desde aquí se usa service_role: escribir la configuración.
  const adminClient = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: settings } = await adminClient
    .from("tenant_invoicing_settings")
    .select("pac_organization_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  let uploadingCertificate = false;
  try {
    let organizationId = settings?.pac_organization_id ?? null;
    if (!organizationId) {
      const created = await pacRequest("POST", "/organizations", { name: tenant.name });
      organizationId = String(created.id);
      // Se guarda de inmediato: si el paso siguiente falla, el reintento
      // reutiliza esta organización en vez de crear otra huérfana en el PAC.
      await adminClient
        .from("tenant_invoicing_settings")
        .upsert(
          { tenant_id: tenantId, pac_organization_id: organizationId },
          { onConflict: "tenant_id" },
        );
    }

    await pacRequest("PUT", `/organizations/${organizationId}/legal`, {
      name: tenant.name,
      legal_name: tenant.legal_name,
      tax_system: tenant.tax_regime_code,
      address: { zip: tenant.postal_code },
    });

    if (hasCertificate) {
      uploadingCertificate = true;
      const certificateForm = new FormData();
      certificateForm.set("cer", cer as File);
      certificateForm.set("key", key as File);
      certificateForm.set("password", password as string);
      const organization = await pacRequest(
        "PUT",
        `/organizations/${organizationId}/certificate`,
        certificateForm,
      );

      // El PAC devuelve la vigencia del certificado. (PENDIENTE de confirmar
      // en el sandbox el nombre exacto del campo; ver TASKS.md 11.15.)
      const certificate = organization.certificate as { expires_at?: string } | undefined;
      const expiresAt = certificate?.expires_at;
      if (!expiresAt) {
        return Response.json(PAC_FAILED_RESPONSE, { status: 502 });
      }
      await adminClient
        .from("tenant_invoicing_settings")
        .update({ csd_valid_until: expiresAt })
        .eq("tenant_id", tenantId);
    }

    const { data: saved } = await adminClient
      .from("tenant_invoicing_settings")
      .select("csd_valid_until")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    return Response.json({ csdValidUntil: saved?.csd_valid_until ?? null });
  } catch (error) {
    // Solo el tipo de fallo, nunca el cuerpo de la petición (puede contener
    // el certificado o su contraseña).
    console.error(error instanceof PacError ? error.message : "invoicing setup failed");
    // 400/422 al subir el certificado = el PAC lo revisó y no es válido
    // (contraseña equivocada, archivos que no son pareja, certificado de
    // prueba en producción...). Es culpa de los archivos, no del servicio.
    if (error instanceof PacError && [400, 422].includes(error.status) && uploadingCertificate) {
      return Response.json(
        { message: "El proveedor no aceptó el certificado. Revisa que los archivos y la contraseña sean los correctos." },
        { status: 422 },
      );
    }
    return Response.json(PAC_FAILED_RESPONSE, { status: 502 });
  }
}));
