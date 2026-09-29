import { describe, expect, it } from 'vitest'

import {
  branchFormProblems,
  defaultHoursForm,
  formToHours,
  hoursToForm,
  type BranchFormInput,
} from './branchSettings'

function validInput(overrides: Partial<BranchFormInput> = {}): BranchFormInput {
  return {
    name: 'Sucursal Norte',
    address: '',
    postalCode: '',
    phone: '',
    timezone: 'America/Mexico_City',
    hours: defaultHoursForm(),
    ...overrides,
  }
}

describe('hoursToForm / formToHours', () => {
  it('ida y vuelta conserva el horario y guarda los días cerrados como null', () => {
    // Si la conversión perdiera un día, guardar el formulario cambiaría el
    // horario en silencio y la agenda dejaría de ofrecer huecos ese día.
    const stored = {
      monday: { opensAt: '10:00', closesAt: '16:00' },
      sunday: null,
    }
    const back = formToHours(hoursToForm(stored))
    expect(back.monday).toEqual({ opensAt: '10:00', closesAt: '16:00' })
    expect(back.sunday).toBeNull()
    // Los días que ni venían en el jsonb quedan cerrados, no con horario inventado.
    expect(back.tuesday).toBeNull()
  })

  it('un jsonb vacío o nulo (sucursal sin horario) se muestra todo cerrado', () => {
    // La semilla y las sucursales viejas pueden tener "{}": availability.ts
    // ya las trata como cerradas, el formulario debe mostrar lo mismo.
    for (const empty of [{}, null, undefined]) {
      const form = hoursToForm(empty)
      expect(Object.values(form).every((d) => !d.isOpen)).toBe(true)
    }
  })

  it('una forma desconocida en un día se trata como cerrado', () => {
    // Un valor raro no debe romper la pantalla de configuración.
    const form = hoursToForm({ monday: { opensAt: 900 } as never })
    expect(form.monday.isOpen).toBe(false)
  })
})

describe('branchFormProblems', () => {
  it('un formulario correcto no tiene problemas', () => {
    expect(branchFormProblems(validInput())).toEqual([])
  })

  it('exige el nombre, aunque sean solo espacios', () => {
    // Una sucursal sin nombre aparecería vacía en el selector de la barra.
    const problems = branchFormProblems(validInput({ name: '   ' }))
    expect(problems.map((p) => p.field)).toEqual(['name'])
  })

  it('código postal y teléfono son opcionales, pero si se escriben deben ser válidos', () => {
    expect(branchFormProblems(validInput({ postalCode: '', phone: '' }))).toEqual([])
    const fields = branchFormProblems(validInput({ postalCode: '123', phone: '55' })).map(
      (p) => p.field,
    )
    expect(fields).toEqual(['postalCode', 'phone'])
  })

  it('rechaza una zona horaria que no está en la lista', () => {
    // La zona decide la hora que ve el usuario (CLAUDE.md §8.3): un texto
    // libre mal escrito movería todas las citas de la sucursal.
    const problems = branchFormProblems(validInput({ timezone: 'GMT-6' }))
    expect(problems.map((p) => p.field)).toEqual(['timezone'])
  })

  it('exige al menos un día abierto', () => {
    const hours = defaultHoursForm()
    for (const day of Object.values(hours)) day.isOpen = false
    const problems = branchFormProblems(validInput({ hours }))
    expect(problems).toEqual([{ field: 'hours', message: 'La sucursal debe abrir al menos un día.' }])
  })

  it('el cierre debe ser estrictamente después de la apertura', () => {
    // Borde: cerrar a la misma hora que abre dejaría cero huecos y la
    // agenda de ese día se vería vacía sin explicación.
    const hours = defaultHoursForm()
    hours.monday = { isOpen: true, opensAt: '12:00', closesAt: '12:00' }
    hours.tuesday = { isOpen: true, opensAt: '18:00', closesAt: '09:00' }
    const messages = branchFormProblems(validInput({ hours })).map((p) => p.message)
    expect(messages).toEqual([
      'Lunes: el cierre debe ser después de la apertura.',
      'Martes: el cierre debe ser después de la apertura.',
    ])
  })

  it('ignora las horas de un día cerrado aunque estén mal', () => {
    // Un día cerrado conserva sus horas viejas en el formulario; no deben
    // bloquear el guardado.
    const hours = defaultHoursForm()
    hours.sunday = { isOpen: false, opensAt: '', closesAt: '' }
    expect(branchFormProblems(validInput({ hours }))).toEqual([])
  })

  it('pide horas con formato HH:mm', () => {
    const hours = defaultHoursForm()
    hours.monday = { isOpen: true, opensAt: '', closesAt: '18:00' }
    const problems = branchFormProblems(validInput({ hours }))
    expect(problems[0].message).toBe('Lunes: escribe la hora de apertura y de cierre.')
  })
})
