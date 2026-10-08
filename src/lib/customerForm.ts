// Arma lo que se guarda de un cliente a partir de los campos del formulario.
// Función pura (CLAUDE.md §4): no sabe de Vue ni de Supabase.

export interface CustomerFormFields {
  firstName: string
  lastName: string
  phone: string
  email: string
  notes: string
  requiresInvoice: boolean
  rfc: string
  legalName: string
  taxRegimeCode: string
  cfdiUse: string
  postalCode: string
}

/**
 * Los textos vacíos se guardan como NULL (la base distingue "sin dato" de ""), y
 * los datos fiscales solo se guardan si el cliente requiere factura: si se
 * desmarca la casilla, el RFC y compañía que quedaron escritos no deben
 * guardarse (CLAUDE.md §8.4: no se piden datos fiscales a quien no factura).
 */
export function buildCustomerPayload(form: CustomerFormFields) {
  const fiscal = (value: string) => (form.requiresInvoice ? value || null : null)
  return {
    first_name: form.firstName,
    last_name: form.lastName,
    phone: form.phone || null,
    email: form.email || null,
    notes: form.notes || null,
    requires_invoice: form.requiresInvoice,
    rfc: fiscal(form.rfc),
    legal_name: fiscal(form.legalName),
    tax_regime_code: fiscal(form.taxRegimeCode),
    cfdi_use: fiscal(form.cfdiUse),
    postal_code: fiscal(form.postalCode),
  }
}
