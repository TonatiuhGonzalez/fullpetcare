// Copia para Deno de src/lib/cfdi.ts (armado del comprobante, tarea 11.16).
//
// Por qué hay una copia: las Edge Functions solo pueden importar archivos que
// vivan dentro de supabase/functions (el CLI empaqueta solo esa carpeta), y
// src/lib/ no puede importar de aquí (regla de capas, CLAUDE.md §4). La
// función DEBE recalcular los importes ella misma: si confiara en los que manda
// el navegador, cualquiera facturaría el monto que quisiera.
//
// Para que las dos copias no se separen, supabase/tests/cfdi-parity.spec.ts
// corre las mismas entradas por las dos y exige el mismo resultado. Si cambias
// uno, cambia el otro (y ese test te avisa si se te olvida).

export interface CfdiSaleItem {
  description: string;
  quantity: number;
  unitPriceCents: number;
  taxRateBp: number;
  satProductCode: string;
  satUnitCode: string;
}
export interface CfdiPayment {
  amountCents: number;
  paymentFormCode: string | null;
}
export interface CfdiReceiver {
  rfc: string | null;
  legalName: string | null;
  taxRegimeCode: string | null;
  postalCode: string | null;
  cfdiUse: string | null;
}
export interface CfdiConcept {
  description: string;
  quantity: number;
  satProductCode: string;
  satUnitCode: string;
  netCents: number;
  unitPriceMicros: number;
  discountCents: number;
  taxBaseCents: number;
  taxRateBp: number;
  taxCents: number;
}
export interface CfdiBody {
  receiver: { rfc: string; legalName: string; taxRegimeCode: string; postalCode: string; cfdiUse: string };
  paymentFormCode: string;
  paymentMethodCode: "PUE";
  concepts: CfdiConcept[];
  totals: { subtotalCents: number; discountCents: number; taxCents: number; totalCents: number };
}
export type CfdiResult = { ok: true; body: CfdiBody } | { ok: false; problems: string[] };

export const DEFAULT_CFDI_USE = "G03";

const RFC_REGEX = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;

function splitTaxIncluded(grossCents: number, taxRateBp: number) {
  const netCents = Math.round((grossCents * 10000) / (10000 + taxRateBp));
  return { netCents, taxCents: grossCents - netCents };
}

export function allocateProportionally(totalCents: number, weights: number[]): number[] {
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum === 0 || totalCents === 0) return weights.map(() => 0);
  const exact = weights.map((w) => (totalCents * w) / weightSum);
  const parts = exact.map(Math.floor);
  let remainder = totalCents - parts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((value, index) => ({ index, lost: value - Math.floor(value) }))
    .sort((a, b) => b.lost - a.lost || a.index - b.index);
  for (const { index } of order) {
    if (remainder === 0) break;
    parts[index] += 1;
    remainder -= 1;
  }
  return parts;
}

export function pickPaymentForm(payments: CfdiPayment[]): string | null {
  let best: CfdiPayment | null = null;
  for (const payment of payments) {
    if (!payment.paymentFormCode) continue;
    if (!best || payment.amountCents > best.amountCents) best = payment;
  }
  return best?.paymentFormCode ?? null;
}

export function buildCfdi(
  items: CfdiSaleItem[],
  payments: CfdiPayment[],
  discountCents: number,
  receiver: CfdiReceiver,
): CfdiResult {
  const problems: string[] = [];

  const rfc = receiver.rfc?.trim().toUpperCase() ?? "";
  if (!rfc) problems.push("Falta el RFC del cliente.");
  else if (!RFC_REGEX.test(rfc)) problems.push("El RFC del cliente no tiene un formato válido.");
  if (!receiver.legalName?.trim()) problems.push("Falta la razón social del cliente.");
  if (!receiver.taxRegimeCode) problems.push("Falta el régimen fiscal del cliente.");
  const postalCode = receiver.postalCode?.trim() ?? "";
  if (!postalCode) problems.push("Falta el código postal fiscal del cliente.");
  else if (!/^\d{5}$/.test(postalCode)) {
    problems.push("El código postal fiscal del cliente debe tener 5 dígitos.");
  }

  if (items.length === 0) problems.push("La venta no tiene partidas que facturar.");
  const paymentFormCode = pickPaymentForm(payments);
  if (!paymentFormCode) problems.push("Falta la forma de pago de la venta.");

  const grossLines = items.map((item) => item.unitPriceCents * item.quantity);
  const grossTotal = grossLines.reduce((a, b) => a + b, 0);
  if (discountCents < 0 || discountCents > grossTotal) {
    problems.push("El descuento de la venta no es válido.");
  }

  if (problems.length > 0) return { ok: false, problems };

  const grossDiscounts = allocateProportionally(discountCents, grossLines);
  const concepts: CfdiConcept[] = items.map((item, i) => {
    const before = splitTaxIncluded(grossLines[i], item.taxRateBp);
    const after = splitTaxIncluded(grossLines[i] - grossDiscounts[i], item.taxRateBp);
    return {
      description: item.description,
      quantity: item.quantity,
      satProductCode: item.satProductCode,
      satUnitCode: item.satUnitCode,
      netCents: before.netCents,
      unitPriceMicros: Math.round((before.netCents * 10000) / item.quantity),
      discountCents: before.netCents - after.netCents,
      taxBaseCents: after.netCents,
      taxRateBp: item.taxRateBp,
      taxCents: after.taxCents,
    };
  });

  const subtotalCents = concepts.reduce((sum, c) => sum + c.netCents, 0);
  const discountTotal = concepts.reduce((sum, c) => sum + c.discountCents, 0);
  const taxCents = concepts.reduce((sum, c) => sum + c.taxCents, 0);

  return {
    ok: true,
    body: {
      receiver: {
        rfc,
        legalName: receiver.legalName!.trim(),
        taxRegimeCode: receiver.taxRegimeCode!,
        postalCode,
        cfdiUse: receiver.cfdiUse || DEFAULT_CFDI_USE,
      },
      paymentFormCode: paymentFormCode!,
      paymentMethodCode: "PUE",
      concepts,
      totals: {
        subtotalCents,
        discountCents: discountTotal,
        taxCents,
        totalCents: subtotalCents - discountTotal + taxCents,
      },
    },
  };
}
