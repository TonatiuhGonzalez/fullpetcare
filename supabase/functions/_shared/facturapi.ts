// Adaptador delgado a la API de Facturapi (PAC, PLAN.md D16). TODO lo que sea
// específico del proveedor vive aquí: rutas, nombres de campos y formato de
// importes. Si algún día se cambia de PAC, este archivo es lo único que se
// reescribe; el armado del comprobante (cfdi.ts) y las reglas no se tocan.
//
// ESTADO: escrito contra la documentación pública (docs.facturapi.io), SIN
// probar contra el sandbox. Las rutas marcadas (?) son las que la
// documentación consultada no dejó 100 % claras; la tarea de verificación en
// sandbox (HMH Four #2068) debe confirmarlas.
//
// Secretos que lee:
//   FACTURAPI_USER_KEY  llave de usuario: crea organizaciones y edita sus datos
//   FACTURAPI_BASE_URL  opcional; por defecto https://www.facturapi.io/v2
//   FACTURAPI_MODE      'test' (default; sandbox) o 'live'
import type { CfdiBody } from "./cfdi.ts";

export class PacError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const baseUrl = () => Deno.env.get("FACTURAPI_BASE_URL") ?? "https://www.facturapi.io/v2";

export function isConfigured(): boolean {
  return !!Deno.env.get("FACTURAPI_USER_KEY");
}

type Body = Record<string, unknown> | FormData;

async function request(method: string, path: string, key: string, body?: Body): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body; // fetch pone el Content-Type con su boundary
  } else if (body) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl()}${path}`, { method, headers, body: payload });
  // Nunca se incluye el cuerpo de la respuesta en el error: podría traer eco de
  // datos del certificado o del cliente.
  if (!response.ok) throw new PacError(`PAC ${method} ${path} → ${response.status}`, response.status);
  return response;
}

const userRequest = (method: string, path: string, body?: Body) =>
  request(method, path, Deno.env.get("FACTURAPI_USER_KEY")!, body);

// -----------------------------------------------------------------------------
// Organizaciones (un negocio = una organización con su propio RFC y certificado)
// -----------------------------------------------------------------------------
export async function createOrganization(name: string): Promise<string> {
  const response = await userRequest("POST", "/organizations", { name });
  return String((await response.json()).id);
}

export interface LegalData {
  legalName: string;
  rfc: string;
  taxRegimeCode: string;
  postalCode: string;
}

// (?) La documentación consultada da `PUT /organizations/{id}` para editar los
// datos fiscales; confirmar en sandbox.
export async function updateLegalData(organizationId: string, legal: LegalData): Promise<void> {
  await userRequest("PUT", `/organizations/${organizationId}`, {
    legal_name: legal.legalName,
    tax_id: legal.rfc,
    tax_system: legal.taxRegimeCode,
    address: { zip: legal.postalCode },
  });
}

/** Sube el CSD y devuelve cuándo vence (ISO), o null si el PAC no lo informó. */
// (?) Ruta `/csd` según la documentación consultada (otra fuente decía
// `/certificates`); confirmar en sandbox.
export async function uploadCertificate(
  organizationId: string,
  files: { cer: File; key: File; password: string },
): Promise<string | null> {
  const form = new FormData();
  form.set("cer", files.cer);
  form.set("key", files.key);
  form.set("password", files.password);
  const response = await userRequest("PUT", `/organizations/${organizationId}/csd`, form);
  const organization = await response.json();
  return organization?.certificate?.expires_at ?? null;
}

// -----------------------------------------------------------------------------
// Facturas: se emiten con la llave de la ORGANIZACIÓN (el ambiente lo decide la
// llave: sk_test_ = sandbox, sk_live_ = timbrado real).
// -----------------------------------------------------------------------------
async function organizationKey(organizationId: string): Promise<string> {
  if ((Deno.env.get("FACTURAPI_MODE") ?? "test") !== "test") {
    // La llave LIVE de una organización solo se muestra al crearla; hay que
    // decidir dónde se guarda (PLAN.md D16, pendiente antes de producción).
    throw new PacError("El timbrado en producción todavía no está habilitado", 501);
  }
  const response = await userRequest("GET", `/organizations/${organizationId}/test-api-key`);
  const body = await response.json();
  return typeof body === "string" ? body : String(body.key ?? body.api_key ?? body);
}

const pesos = (cents: number) => cents / 100;

export interface StampedInvoice {
  pacInvoiceId: string;
  uuid: string;
  totalCents: number;
}

export async function stampInvoice(
  organizationId: string,
  cfdi: CfdiBody,
  externalId: string,
): Promise<StampedInvoice> {
  const key = await organizationKey(organizationId);
  const response = await request("POST", "/invoices", key, {
    customer: {
      legal_name: cfdi.receiver.legalName,
      tax_id: cfdi.receiver.rfc,
      tax_system: cfdi.receiver.taxRegimeCode,
      address: { zip: cfdi.receiver.postalCode },
    },
    use: cfdi.receiver.cfdiUse,
    payment_form: cfdi.paymentFormCode,
    payment_method: cfdi.paymentMethodCode,
    // Sirve para correlacionar si hubo que reintentar tras una falla de red.
    external_id: externalId,
    items: cfdi.concepts.map((c) => ({
      quantity: c.quantity,
      // Descuento sobre el importe sin IVA, en pesos.
      discount: pesos(c.discountCents),
      product: {
        description: c.description,
        product_key: c.satProductCode,
        unit_key: c.satUnitCode,
        // Precio unitario SIN IVA con 6 decimales (el máximo del SAT); el
        // IVA se agrega aparte, por eso tax_included = false.
        price: c.unitPriceMicros / 1_000_000,
        tax_included: false,
        taxes: [{ type: "IVA", rate: c.taxRateBp / 10000 }],
      },
    })),
  });
  const invoice = await response.json();
  return {
    pacInvoiceId: String(invoice.id),
    uuid: String(invoice.uuid),
    totalCents: Math.round(Number(invoice.total) * 100),
  };
}

export async function downloadFile(
  organizationId: string,
  pacInvoiceId: string,
  kind: "xml" | "pdf",
): Promise<Uint8Array> {
  const key = await organizationKey(organizationId);
  const response = await request("GET", `/invoices/${pacInvoiceId}/${kind}`, key);
  return new Uint8Array(await response.arrayBuffer());
}

export async function cancelInvoice(
  organizationId: string,
  pacInvoiceId: string,
  motive: string,
): Promise<void> {
  const key = await organizationKey(organizationId);
  // La documentación pide `motive` (y `substitution_invoice_id` solo con el 01).
  await request("DELETE", `/invoices/${pacInvoiceId}?motive=${motive}`, key);
}
