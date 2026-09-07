// Tests de lib/roles.ts (revisión de cobertura, tarea 8.2) — nunca tuvo
// los suyos: se usa en AppLayout.vue/SelectBusinessPage.vue, pero un
// archivo de mapeo de etiquetas nunca se prueba a través de un
// componente. Corto, pero real: hay UN caso de borde (`role` nulo) que
// vale la pena fijar con un test — sin él, alguien podría "simplificar"
// el `if` y romper la pantalla de selección de negocio antes de que
// exista una membresía activa.
import { describe, expect, it } from 'vitest'

import {
  canAttendKind,
  isFrontDesk,
  roleForServiceKind,
  roleLabel,
  visibleServiceKinds,
  visibleTimelineTypes,
} from './roles'

describe('roleLabel', () => {
  it('traduce cada rol al español', () => {
    expect(roleLabel('owner')).toBe('Dueño')
    expect(roleLabel('receptionist')).toBe('Recepción')
    expect(roleLabel('groomer')).toBe('Groomer')
    expect(roleLabel('vet')).toBe('Veterinario')
  })

  it('da una cadena vacía si todavía no hay rol (sin membresía activa elegida)', () => {
    expect(roleLabel(null)).toBe('')
  })
})

describe('isFrontDesk', () => {
  it('owner y receptionist son "front desk"; groomer, vet y sin rol no', () => {
    // Caso de borde real (ronda de UAT): antes de este cambio, un
    // groomer veía el botón "Nueva cita" en la agenda aunque el backend
    // ya lo rechazara — este booleano es lo que decide si ese botón se
    // pinta o no.
    expect(isFrontDesk('owner')).toBe(true)
    expect(isFrontDesk('receptionist')).toBe(true)
    expect(isFrontDesk('groomer')).toBe(false)
    expect(isFrontDesk('vet')).toBe(false)
    expect(isFrontDesk(null)).toBe(false)
  })
})

describe('roleForServiceKind', () => {
  it('grooming → groomer, veterinary → vet', () => {
    expect(roleForServiceKind('grooming')).toBe('groomer')
    expect(roleForServiceKind('veterinary')).toBe('vet')
  })
})

describe('canAttendKind', () => {
  it('el rol específico de cada tipo sí puede atenderlo', () => {
    expect(canAttendKind('groomer', 'grooming')).toBe(true)
    expect(canAttendKind('vet', 'veterinary')).toBe(true)
  })

  it('el owner puede atender cualquier tipo', () => {
    expect(canAttendKind('owner', 'grooming')).toBe(true)
    expect(canAttendKind('owner', 'veterinary')).toBe(true)
  })

  it('un groomer NO puede atender una cita de veterinaria, ni un vet una de estética', () => {
    // El caso que reportó el UAT: sin este chequeo, NewAppointmentPage.vue
    // dejaba elegir a cualquier empleado de la sucursal sin importar el
    // tipo de cita — el mismo bug que se corrigió en create_appointment().
    expect(canAttendKind('groomer', 'veterinary')).toBe(false)
    expect(canAttendKind('vet', 'grooming')).toBe(false)
  })

  it('receptionist no atiende NINGÚN tipo de cita — agenda, no atiende', () => {
    expect(canAttendKind('receptionist', 'grooming')).toBe(false)
    expect(canAttendKind('receptionist', 'veterinary')).toBe(false)
  })
})

describe('visibleServiceKinds', () => {
  it('groomer solo ve estética; vet solo ve veterinaria', () => {
    expect(visibleServiceKinds('groomer')).toEqual(['grooming'])
    expect(visibleServiceKinds('vet')).toEqual(['veterinary'])
  })

  it('owner y receptionist ven las dos categorías — recepción cotiza cualquier servicio', () => {
    expect(visibleServiceKinds('owner')).toEqual(['grooming', 'veterinary'])
    expect(visibleServiceKinds('receptionist')).toEqual(['grooming', 'veterinary'])
  })
})

describe('visibleTimelineTypes', () => {
  it('groomer solo ve eventos de estética — ni cartilla ni peso, son datos clínicos', () => {
    expect(visibleTimelineTypes('groomer')).toEqual(['grooming'])
  })

  it('vet ve veterinaria, vacunas y peso, pero no las visitas de estética', () => {
    expect(visibleTimelineTypes('vet')).toEqual(['veterinary', 'vaccination', 'weight'])
  })

  it('owner y receptionist ven el historial completo, sin restricción', () => {
    const all = ['grooming', 'veterinary', 'vaccination', 'weight']
    expect(visibleTimelineTypes('owner')).toEqual(all)
    expect(visibleTimelineTypes('receptionist')).toEqual(all)
  })
})
