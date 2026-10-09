import { describe, expect, it } from 'vitest'

import { buildCustomerPayload, type CustomerFormFields } from './customerForm'

const base: CustomerFormFields = {
  firstName: 'Ana',
  lastName: 'Robles',
  phone: '5512345678',
  email: 'ana@example.com',
  notes: 'Prefiere citas por la tarde',
  requiresInvoice: true,
  rfc: 'ROBA800101AB1',
  legalName: 'Ana Robles',
  taxRegimeCode: '612',
  cfdiUse: 'G03',
  postalCode: '06600',
}

describe('buildCustomerPayload', () => {
  // Camino normal: con factura, todo se guarda tal cual. Si fallara, un
  // cliente que sí factura perdería sus datos fiscales al editarlo.
  it('con factura guarda los datos fiscales', () => {
    expect(buildCustomerPayload(base)).toMatchObject({
      requires_invoice: true,
      rfc: 'ROBA800101AB1',
      legal_name: 'Ana Robles',
      tax_regime_code: '612',
      cfdi_use: 'G03',
      postal_code: '06600',
    })
  })

  // Si se desmarca "Requiere factura" pero los campos fiscales siguen
  // escritos, no deben guardarse: se acabaría con un RFC en un cliente
  // marcado como "no factura" (CLAUDE.md §8.4).
  it('sin factura descarta los datos fiscales aunque estén escritos', () => {
    const payload = buildCustomerPayload({ ...base, requiresInvoice: false })
    expect(payload.requires_invoice).toBe(false)
    expect(payload.rfc).toBeNull()
    expect(payload.legal_name).toBeNull()
    expect(payload.tax_regime_code).toBeNull()
    expect(payload.cfdi_use).toBeNull()
    expect(payload.postal_code).toBeNull()
  })

  // Un campo vacío es "sin dato": NULL, no "". Con "" el buscador y los
  // reportes tratarían un teléfono vacío como un teléfono.
  it('guarda NULL en los textos vacíos', () => {
    const payload = buildCustomerPayload({
      ...base,
      phone: '',
      email: '',
      notes: '',
      requiresInvoice: true,
      rfc: '',
    })
    expect(payload.phone).toBeNull()
    expect(payload.email).toBeNull()
    expect(payload.notes).toBeNull()
    expect(payload.rfc).toBeNull()
    expect(payload.first_name).toBe('Ana')
  })
})
