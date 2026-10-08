import { describe, expect, it } from 'vitest'

import {
  buildVaccineTableRows,
  classifyVaccineStatus,
  computeNextDueDate,
} from './vaccination'

describe('computeNextDueDate', () => {
  it('suma el intervalo a la fecha de aplicación', () => {
    expect(computeNextDueDate('2026-01-01', 365)).toBe('2027-01-01')
  })

  it('vacuna sin intervalo definido: no hay próxima dosis que calcular', () => {
    // Caso real: no toda vacuna tiene refuerzo (CLAUDE.md,
    // vaccines.default_interval_days nullable). null adentro, null
    // afuera — no un error, no una fecha inventada.
    expect(computeNextDueDate('2026-01-01', null)).toBeNull()
  })

  it('cachorro con esquema inicial: intervalos cortos (semanas, no meses)', () => {
    // El esquema inicial de un cachorro se refuerza cada 21 días, muy
    // distinto al refuerzo anual de un adulto — la función debe
    // funcionar igual de bien con cualquier intervalo, no solo 365.
    expect(computeNextDueDate('2026-01-01', 21)).toBe('2026-01-22')
  })
})

describe('classifyVaccineStatus', () => {
  it('vence hoy: cuenta como "por vencer", todavía no "vencida"', () => {
    // El día de hoy no ha terminado — es el caso más urgente de "por
    // vencer", no el primer día de "vencida". Ese cambio pasa mañana.
    expect(classifyVaccineStatus('2026-06-15', '2026-06-15')).toBe('due_soon')
  })

  it('vence mañana: por vencer', () => {
    expect(classifyVaccineStatus('2026-06-16', '2026-06-15')).toBe('due_soon')
  })

  it('venció ayer: vencida', () => {
    expect(classifyVaccineStatus('2026-06-14', '2026-06-15')).toBe('overdue')
  })

  it('vacuna sin intervalo definido (sin fecha próxima): no hay nada que clasificar', () => {
    expect(classifyVaccineStatus(null, '2026-06-15')).toBeNull()
  })

  it('vigente: falta más de la ventana de "por vencer"', () => {
    // Por default la ventana es 30 días — a 60 días todavía es vigente.
    expect(classifyVaccineStatus('2026-08-14', '2026-06-15')).toBe('current')
  })

  it('justo en el borde de la ventana de "por vencer" (30 días) cuenta como por vencer', () => {
    expect(classifyVaccineStatus('2026-07-15', '2026-06-15')).toBe('due_soon')
  })

  it('un día después del borde de la ventana ya es vigente', () => {
    expect(classifyVaccineStatus('2026-07-16', '2026-06-15')).toBe('current')
  })
})

describe('buildVaccineTableRows', () => {
  const catalog = [
    { id: 'rabia', name: 'Rabia' },
    { id: 'sextuple', name: 'Séxtuple' },
  ]
  const applied = (
    vaccine_id: string,
    applied_at: string,
    next_due_date: string | null,
    batch_number: string | null = null,
  ) => ({ vaccine_id, vaccineName: vaccine_id, applied_at, next_due_date, batch_number })

  // La tabla debe mostrar TODO el catálogo aunque la mascota no tenga ninguna
  // vacuna: si solo saliera lo aplicado, recepción no vería qué le falta.
  it('sin aplicaciones, una fila vacía por cada vacuna del catálogo', () => {
    const rows = buildVaccineTableRows(catalog, [], '2026-06-15')
    expect(rows.map((r) => r.vaccineName)).toEqual(['Rabia', 'Séxtuple'])
    expect(rows[0]).toMatchObject({
      appliedAt: null,
      nextDueDate: null,
      batchNumber: null,
      status: null,
    })
  })

  // Con varias aplicaciones de la misma vacuna manda la más reciente: si se
  // tomara la primera que aparezca, la cartilla mostraría un refuerzo viejo y
  // marcaría "vencida" una vacuna que ya se renovó.
  it('con varias aplicaciones usa la más reciente, sin importar el orden de entrada', () => {
    const rows = buildVaccineTableRows(
      catalog,
      [
        applied('rabia', '2026-06-01T12:00:00Z', '2027-06-01', 'LOTE-NUEVO'),
        applied('rabia', '2025-01-01T12:00:00Z', '2026-01-01', 'LOTE-VIEJO'),
      ],
      '2026-06-15',
    )
    expect(rows[0]).toMatchObject({
      batchNumber: 'LOTE-NUEVO',
      nextDueDate: '2027-06-01',
      status: 'current',
    })
  })

  // Una vacuna sin intervalo (sin próxima dosis) no se clasifica: no hay
  // "vencida" que calcular. Marcarla vencida generaría alertas falsas.
  it('una vacuna aplicada sin próxima dosis queda sin estado', () => {
    const rows = buildVaccineTableRows(
      catalog,
      [applied('rabia', '2026-06-01T12:00:00Z', null)],
      '2026-06-15',
    )
    expect(rows[0].appliedAt).toBe('2026-06-01T12:00:00Z')
    expect(rows[0].status).toBeNull()
  })

  // Lo que la mascota recibió pero ya no está en el catálogo de su especie no
  // debe desaparecer del expediente: va al final de la tabla.
  it('agrega al final las vacunas aplicadas que no están en el catálogo', () => {
    const rows = buildVaccineTableRows(
      catalog,
      [applied('leptospirosis', '2026-06-01T12:00:00Z', '2026-12-01')],
      '2026-06-15',
    )
    expect(rows.map((r) => r.vaccineName)).toEqual(['Rabia', 'Séxtuple', 'leptospirosis'])
    expect(rows[2].status).toBe('current')
  })
})
