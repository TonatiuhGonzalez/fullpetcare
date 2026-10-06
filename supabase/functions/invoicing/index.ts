// Edge Function invoicing (fase 11, CLAUDE.md §10 y PLAN.md D16): la ÚNICA que
// habla con el PAC (Facturapi). Acciones (campo `action` de un FormData):
//   setup     (11.15) crea la organización del negocio en el PAC, le manda sus
//             datos fiscales y, si vienen, el certificado digital.
//   stamp     (11.18) timbra la factura de una venta pagada.
//   cancel    (11.18) cancela una factura timbrada con motivo del SAT.
//   download  (11.18) (re)guarda el XML y el PDF de una factura timbrada.
//
// Patrón de seguridad (el mismo de platform-admin): primero se revalida, con el
// JWT de QUIEN LLAMA y por RLS, que tiene permiso sobre ese negocio; solo
// después se usa service_role (para escribir el estado de la factura, que los
// usuarios no pueden escribir) y la llave del PAC (un secreto de la función que
// jamás viaja al navegador).
//
// Por qué el certificado "no se guarda": el CSD es la firma electrónica con la
// que el negocio sella sus facturas; quien lo tenga puede facturar a su nombre.
// Los bytes pasan por la memoria de esta función y se van al PAC; nunca se
// escriben en la base, en Storage ni en los logs (no hay console.log de cuerpos
// de petición ni de respuestas del PAC).
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { buildCfdi, type CfdiSaleItem } from "../_shared/cfdi.ts";
import { handleCors } from "../_shared/cors.ts";
import * as pac from "../_shared/facturapi.ts";

const json = (message: string, status: number) => Response.json({ message }, { status });

const FORBIDDEN = () => json("No tienes permiso para esta operación de facturación.", 403);
const BAD_REQUEST = () => json("Solicitud inválida.", 400);
const NOT_CONFIGURED = () => json("La facturación todavía no está disponible. Intenta más tarde.", 503);
const PAC_FAILED = () => json("No se pudo comunicar con el proveedor de facturas. Intenta de nuevo.", 502);
const MAX_FILE_BYTES = 64 * 1024; // un .cer/.key real pesa unos pocos KB
const CANCEL_MOTIVES = ["02", "03"]; // 01 pide la factura que sustituye; 04 es solo de la global

// Mismas reglas que lib/fiscalSetup.ts y la RPC update_tenant_fiscal_data. Se
// repiten porque la función no puede importar de src/ (§7.3.4: nunca una sola capa).
const RFC_REGEX = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const POSTAL_CODE_REGEX = /^\d{5}$/;

function missingFiscalData(t: Record<string, string | null>): string | null {
  if (!t.rfc || !RFC_REGEX.test(t.rfc)) return "el RFC";
  if (!t.legal_name?.trim()) return "la razón social";
  if (!t.tax_regime_code) return "el régimen fiscal";
  if (!t.postal_code || !POSTAL_CODE_REGEX.test(t.postal_code)) return "el código postal";
  return null;
}

interface Ctx {
  caller: SupabaseClient;
  admin: SupabaseClient;
  tenantId: string;
}

Deno.serve(handleCors(async (req) => {
  if (req.method !== "POST") return json("Método no permitido.", 405);

  const callerToken = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!callerToken) return FORBIDDEN();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return BAD_REQUEST();
  }

  const action = form.get("action");
  const tenantId = form.get("tenantId");
  if (
    typeof action !== "string" ||
    !["setup", "stamp", "cancel", "download"].includes(action) ||
    typeof tenantId !== "string" ||
    tenantId.length === 0
  ) {
    return BAD_REQUEST();
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const publishableKey =
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
  const caller = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${callerToken}` } },
    auth: { persistSession: false },
  });

  // Paso 1 — permiso, ANTES de tocar el PAC o la llave de servicio. Configurar
  // el negocio es del dueño; emitir y cancelar, del permiso 'invoicing'.
  const { data: allowed } = await caller.rpc(
    action === "setup" ? "can_manage_invoicing" : "can_invoice",
    { p_tenant_id: tenantId },
  );
  if (allowed !== true) return FORBIDDEN();

  // La llave de servicio se crea de forma perezosa: solo después de validar.
  const admin = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY")!,
    { auth: { persistSession: false } },
  );
  const ctx: Ctx = { caller, admin, tenantId };

  try {
    switch (action) {
      case "setup":
        return await setup(ctx, form);
      case "stamp":
        return await stamp(ctx, form);
      case "cancel":
        return await cancel(ctx, form);
      default:
        return await download(ctx, form);
    }
  } catch (error) {
    // Solo el tipo de fallo, nunca el cuerpo (puede traer el certificado o datos fiscales).
    console.error(error instanceof pac.PacError ? error.message : `invoicing ${action} failed`);
    if (error instanceof pac.PacError && error.status === 501) {
      return json("El timbrado en producción todavía no está habilitado.", 503);
    }
    return PAC_FAILED();
  }
}));

// =============================================================================
// setup (11.15)
// =============================================================================
async function setup({ caller, admin, tenantId }: Ctx, form: FormData): Promise<Response> {
  // Los archivos se validan antes de hablar con el PAC: un archivo mal elegido
  // falla rápido y sin gastar una llamada.
  const cer = form.get("cer");
  const key = form.get("key");
  const password = form.get("password");
  const hasCertificate = cer !== null || key !== null || password !== null;
  if (hasCertificate) {
    if (!(cer instanceof File) || !(key instanceof File) || typeof password !== "string") {
      return json("Para subir el certificado se necesitan el archivo .cer, el .key y la contraseña.", 400);
    }
    if (!password) return json("Falta la contraseña de la llave privada.", 400);
    if (cer.size === 0 || key.size === 0 || cer.size > MAX_FILE_BYTES || key.size > MAX_FILE_BYTES) {
      return json("Los archivos del certificado no son válidos.", 400);
    }
  }
  if (!pac.isConfigured()) return NOT_CONFIGURED();

  const { data: tenant } = await caller
    .from("tenants")
    .select("name, rfc, legal_name, tax_regime_code, postal_code")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenant) return FORBIDDEN();
  const missing = missingFiscalData(tenant);
  if (missing) return json(`Falta completar ${missing} antes de continuar.`, 422);

  const { data: settings } = await admin
    .from("tenant_invoicing_settings")
    .select("pac_organization_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  let uploadingCertificate = false;
  try {
    let organizationId: string | null = settings?.pac_organization_id ?? null;
    if (!organizationId) {
      organizationId = await pac.createOrganization(tenant.name);
      // Se guarda de inmediato: si el paso siguiente falla, el reintento
      // reutiliza esta organización en vez de crear otra huérfana en el PAC.
      await admin
        .from("tenant_invoicing_settings")
        .upsert({ tenant_id: tenantId, pac_organization_id: organizationId }, { onConflict: "tenant_id" });
    }

    await pac.updateLegalData(organizationId, {
      legalName: tenant.legal_name,
      rfc: tenant.rfc,
      taxRegimeCode: tenant.tax_regime_code,
      postalCode: tenant.postal_code,
    });

    if (hasCertificate) {
      uploadingCertificate = true;
      const expiresAt = await pac.uploadCertificate(organizationId, {
        cer: cer as File,
        key: key as File,
        password: password as string,
      });
      // (?) El campo con la vigencia se confirma en el sandbox (tarea #2068).
      if (!expiresAt) return PAC_FAILED();
      await admin
        .from("tenant_invoicing_settings")
        .update({ csd_valid_until: expiresAt })
        .eq("tenant_id", tenantId);
    }

    const { data: saved } = await admin
      .from("tenant_invoicing_settings")
      .select("csd_valid_until")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    return Response.json({ csdValidUntil: saved?.csd_valid_until ?? null });
  } catch (error) {
    // 400/422 al subir el certificado = el PAC lo revisó y no es válido
    // (contraseña equivocada, archivos que no son pareja...). Es culpa de los
    // archivos, no del servicio.
    if (error instanceof pac.PacError && [400, 422].includes(error.status) && uploadingCertificate) {
      console.error(error.message);
      return json("El proveedor no aceptó el certificado. Revisa que los archivos y la contraseña sean los correctos.", 422);
    }
    throw error;
  }
}

// =============================================================================
// stamp (11.18)
// =============================================================================
const RECEIVER_FIELDS = ["rfc", "legalName", "taxRegimeCode", "postalCode", "cfdiUse"] as const;

function parseReceiver(value: FormDataEntryValue | null): Record<(typeof RECEIVER_FIELDS)[number], string | null> | null {
  if (typeof value !== "string") return null;
  try {
    const raw = JSON.parse(value);
    if (typeof raw !== "object" || raw === null) return null;
    const out = {} as Record<(typeof RECEIVER_FIELDS)[number], string | null>;
    for (const field of RECEIVER_FIELDS) out[field] = typeof raw[field] === "string" ? raw[field] : null;
    return out;
  } catch {
    return null;
  }
}

async function stamp({ caller, admin, tenantId }: Ctx, form: FormData): Promise<Response> {
  const saleId = form.get("saleId");
  const receiver = parseReceiver(form.get("receiver"));
  if (typeof saleId !== "string" || !saleId || !receiver) return BAD_REQUEST();

  // La venta se lee con el JWT de quien llama: RLS exige que sea de su negocio
  // Y de una sucursal a la que tenga acceso (otro tenant o sucursal ajena = 403).
  const { data: sale } = await caller
    .from("sales")
    .select("id, status, total_cents, discount_cents")
    .eq("id", saleId)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!sale) return FORBIDDEN();
  if (sale.status !== "paid") return json("Solo se pueden facturar ventas pagadas.", 409);

  const { data: settings } = await admin
    .from("tenant_invoicing_settings")
    .select("pac_organization_id, csd_valid_until")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (
    !settings?.pac_organization_id ||
    !settings.csd_valid_until ||
    new Date(settings.csd_valid_until).getTime() <= Date.now()
  ) {
    return json("El negocio todavía no está listo para facturar. Completa la configuración fiscal.", 422);
  }

  // Partidas con sus claves del SAT (que viven en el servicio o producto, no en la partida).
  const { data: lines } = await caller
    .from("sale_items")
    .select("description, quantity, unit_price_cents, tax_rate_bp, service_id, product_id")
    .eq("sale_id", saleId)
    .is("deleted_at", null);
  const serviceIds = (lines ?? []).map((l) => l.service_id).filter(Boolean) as string[];
  const productIds = (lines ?? []).map((l) => l.product_id).filter(Boolean) as string[];
  const [services, products] = await Promise.all([
    serviceIds.length
      ? admin.from("services").select("id, sat_product_code, sat_unit_code").eq("tenant_id", tenantId).in("id", serviceIds)
      : Promise.resolve({ data: [] }),
    productIds.length
      ? admin.from("products").select("id, sat_product_code, sat_unit_code").eq("tenant_id", tenantId).in("id", productIds)
      : Promise.resolve({ data: [] }),
  ]);
  const codes = new Map<string, { sat_product_code: string; sat_unit_code: string }>();
  for (const row of [...(services.data ?? []), ...(products.data ?? [])]) codes.set(row.id, row);

  const items: CfdiSaleItem[] = [];
  for (const line of lines ?? []) {
    const code = codes.get((line.service_id ?? line.product_id) as string);
    if (!code) return json("No se encontraron las claves del SAT de una partida de la venta.", 422);
    items.push({
      description: line.description,
      quantity: line.quantity,
      unitPriceCents: line.unit_price_cents,
      taxRateBp: line.tax_rate_bp,
      satProductCode: code.sat_product_code,
      satUnitCode: code.sat_unit_code,
    });
  }

  const { data: payments } = await caller
    .from("payments")
    .select("amount_cents, payment_form_code")
    .eq("sale_id", saleId);
  // La forma de pago se puede corregir al facturar (decisión #5 de la fase).
  const paymentFormOverride = form.get("paymentFormCode");
  const paymentList = (payments ?? []).map((p) => ({
    amountCents: p.amount_cents,
    paymentFormCode: p.payment_form_code as string | null,
  }));
  const effectivePayments =
    typeof paymentFormOverride === "string" && paymentFormOverride
      ? [{ amountCents: sale.total_cents, paymentFormCode: paymentFormOverride }]
      : paymentList;

  const built = buildCfdi(items, effectivePayments, sale.discount_cents, receiver);
  if (!built.ok) return json(built.problems.join(" "), 422);
  const cfdi = built.body;
  // Red de seguridad: el comprobante debe sumar EXACTAMENTE lo que pagó el cliente.
  if (cfdi.totals.totalCents !== sale.total_cents) {
    console.error("invoicing stamp: total mismatch");
    return json("Los importes de la factura no coinciden con los del ticket. No se emitió.", 422);
  }

  // Todo lo anterior son validaciones de datos propios; recién ahora se
  // necesita el PAC.
  if (!pac.isConfigured()) return NOT_CONFIGURED();

  // Candado: UNA sola solicitud viva por venta. El índice único parcial es lo
  // que de verdad lo garantiza; esto solo lo hace fallar con un mensaje claro.
  const fields = {
    rfc: cfdi.receiver.rfc,
    legal_name: cfdi.receiver.legalName,
    tax_regime_code: cfdi.receiver.taxRegimeCode,
    cfdi_use: cfdi.receiver.cfdiUse,
    postal_code: cfdi.receiver.postalCode,
    payment_form_code: cfdi.paymentFormCode,
    payment_method_code: cfdi.paymentMethodCode,
    status: "stamping",
    error_message: null,
  };
  const ALREADY = () => json("Esta venta ya fue facturada o se está facturando.", 409);

  const { data: pending } = await admin
    .from("invoice_requests")
    .select("id")
    .eq("sale_id", saleId)
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let requestId: string;
  if (pending) {
    // `.eq("status","pending")` hace la toma atómica: si otro clic ya la tomó, no actualiza nada.
    const { data: claimed, error } = await admin
      .from("invoice_requests")
      .update(fields)
      .eq("id", pending.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (error?.code === "23505" || !claimed) return ALREADY();
    requestId = claimed.id;
  } else {
    const { data: created, error } = await admin
      .from("invoice_requests")
      .insert({ ...fields, tenant_id: tenantId, sale_id: saleId })
      .select("id")
      .single();
    if (error?.code === "23505") return ALREADY();
    if (error || !created) return PAC_FAILED();
    requestId = created.id;
  }

  let stamped: pac.StampedInvoice;
  try {
    stamped = await pac.stampInvoice(settings.pac_organization_id, cfdi, requestId);
  } catch (error) {
    // El timbrado falló: la solicitud vuelve a 'pending' con el motivo, para reintentar.
    const message =
      error instanceof pac.PacError && [400, 422].includes(error.status)
        ? "El proveedor rechazó la factura. Revisa los datos fiscales del cliente."
        : "No se pudo comunicar con el proveedor de facturas. Intenta de nuevo.";
    await admin.from("invoice_requests").update({ status: "pending", error_message: message }).eq("id", requestId);
    throw error;
  }

  const { error: saveError } = await admin
    .from("invoice_requests")
    .update({
      status: "stamped",
      fiscal_uuid: stamped.uuid,
      pac_invoice_id: stamped.pacInvoiceId,
      stamped_at: new Date().toISOString(),
      error_message:
        stamped.totalCents === sale.total_cents
          ? null
          : "El total que reporta el proveedor no coincide con el del ticket. Revísalo.",
    })
    .eq("id", requestId);
  if (saveError) {
    // Ya se timbró pero no se pudo anotar: queda en 'stamping' (bloquea otro timbrado)
    // y el UUID va al log para recuperarla a mano.
    console.error(`invoicing stamp: stamped but not saved, request ${requestId} uuid ${stamped.uuid}`);
    return json("La factura se emitió pero no se pudo registrar. Avisa a soporte.", 500);
  }

  // Los archivos son "mejor esfuerzo": si fallan, la factura ya existe y se
  // pueden volver a bajar con la acción `download`.
  const files = await storeFiles(admin, tenantId, requestId, settings.pac_organization_id, stamped.pacInvoiceId);
  return Response.json({ invoiceRequestId: requestId, fiscalUuid: stamped.uuid, ...files });
}

// Guarda XML y PDF en el bucket privado `invoices` ({tenant_id}/{id}.{ext}).
async function storeFiles(
  admin: SupabaseClient,
  tenantId: string,
  requestId: string,
  organizationId: string,
  pacInvoiceId: string,
): Promise<{ xmlPath: string | null; pdfPath: string | null }> {
  const result = { xmlPath: null as string | null, pdfPath: null as string | null };
  for (const kind of ["xml", "pdf"] as const) {
    try {
      const bytes = await pac.downloadFile(organizationId, pacInvoiceId, kind);
      const path = `${tenantId}/${requestId}.${kind}`;
      const { error } = await admin.storage.from("invoices").upload(path, bytes, {
        upsert: true,
        contentType: kind === "xml" ? "application/xml" : "application/pdf",
      });
      if (error) throw error;
      result[kind === "xml" ? "xmlPath" : "pdfPath"] = path;
    } catch {
      console.error(`invoicing: could not store ${kind} for request ${requestId}`);
    }
  }
  await admin
    .from("invoice_requests")
    .update({ xml_path: result.xmlPath, pdf_path: result.pdfPath })
    .eq("id", requestId);
  return result;
}

// Lee una solicitud ya timbrada del negocio (por RLS, con el JWT de quien llama).
async function loadStampedRequest({ caller, tenantId }: Ctx, form: FormData) {
  const id = form.get("invoiceRequestId");
  if (typeof id !== "string" || !id) return null;
  const { data } = await caller
    .from("invoice_requests")
    .select("id, status, pac_invoice_id, xml_path, pdf_path")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data;
}

async function organizationIdOf(admin: SupabaseClient, tenantId: string): Promise<string | null> {
  const { data } = await admin
    .from("tenant_invoicing_settings")
    .select("pac_organization_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data?.pac_organization_id ?? null;
}

// =============================================================================
// cancel (11.18)
// =============================================================================
async function cancel(ctx: Ctx, form: FormData): Promise<Response> {
  const motive = form.get("motive");
  if (typeof motive !== "string" || !CANCEL_MOTIVES.includes(motive)) return BAD_REQUEST();

  const request = await loadStampedRequest(ctx, form);
  if (!request) return FORBIDDEN();
  if (request.status !== "stamped" || !request.pac_invoice_id) {
    return json("Solo se puede cancelar una factura timbrada.", 409);
  }
  const organizationId = await organizationIdOf(ctx.admin, ctx.tenantId);
  if (!organizationId) return json("El negocio no tiene facturación configurada.", 422);
  if (!pac.isConfigured()) return NOT_CONFIGURED();

  // Quién cancela: se toma del JWT de quien llama (ya validado arriba), no de
  // nada que mande el navegador. La bitácora no sirve para esto: con
  // service_role `auth.uid()` es nulo.
  const { data: caller } = await ctx.caller.auth.getUser();
  if (!caller.user) return FORBIDDEN();

  // El XML y el PDF deben seguir disponibles tras cancelar. Una cancelada ya no
  // se puede tocar (la base lo impide), así que si faltan se guardan AHORA.
  if (!request.xml_path || !request.pdf_path) {
    const files = await storeFiles(ctx.admin, ctx.tenantId, request.id, organizationId, request.pac_invoice_id);
    if (!files.xmlPath || !files.pdfPath) {
      return json("No se pudieron guardar los archivos de la factura antes de cancelarla. Intenta de nuevo.", 502);
    }
  }

  await pac.cancelInvoice(organizationId, request.pac_invoice_id, motive);
  // La base exige motivo, fecha y quién al pasar a 'cancelled' (checks + trigger).
  const { error } = await ctx.admin
    .from("invoice_requests")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancellation_reason_code: motive,
      cancelled_by: caller.user.id,
    })
    .eq("id", request.id)
    .eq("status", "stamped");
  if (error) {
    console.error(`invoicing cancel: cancelled at PAC but not saved, request ${request.id}`);
    return json("La factura se canceló pero no se pudo registrar. Avisa a soporte.", 500);
  }
  return Response.json({ invoiceRequestId: request.id });
}

// =============================================================================
// download (11.18)
// =============================================================================
async function download(ctx: Ctx, form: FormData): Promise<Response> {
  const request = await loadStampedRequest(ctx, form);
  if (!request) return FORBIDDEN();
  // Solo una timbrada: la base no deja tocar una cancelada (es final), así que
  // los archivos se guardan mientras está vigente.
  if (request.status !== "stamped" || !request.pac_invoice_id) {
    return json("Esta factura todavía no está timbrada.", 409);
  }
  const organizationId = await organizationIdOf(ctx.admin, ctx.tenantId);
  if (!organizationId) return json("El negocio no tiene facturación configurada.", 422);
  if (!pac.isConfigured()) return NOT_CONFIGURED();

  const files = await storeFiles(ctx.admin, ctx.tenantId, request.id, organizationId, request.pac_invoice_id);
  if (!files.xmlPath && !files.pdfPath) return PAC_FAILED();
  return Response.json(files);
}
