import { describe, expect, it } from 'vitest'

import { classifyVaccineStatus, computeNextDueDate } from './vaccination'

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
