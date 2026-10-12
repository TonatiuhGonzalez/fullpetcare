// Uno de los pocos tests de COMPONENTE del proyecto (CLAUDE.md §9: casi
// todo se prueba en lib/services/stores; los componentes de Vuetify no,
// salvo 1-2 críticos). Este es uno de esos casos críticos: si el
// selector de huecos mostrara un horario que en realidad ya está
// ocupado, alguien podría agendar dos citas encimadas para el mismo
// empleado sin que la RPC lo note hasta después (create_appointment sí
// lo rechazaría, pero la persona ya perdió tiempo eligiendo un horario
// que nunca iba a funcionar).
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import TimeSlotPicker from './TimeSlotPicker.vue'
import { computeAvailableSlots, computeSlotStatuses } from '@/lib/availability'
import { vuetify } from '@/plugins/vuetify'

// v-chip/v-chip-group son componentes de Vuetify — necesitan la
// instancia real de Vuetify como plugin global para renderizar bien
// (temas, densidad, etc.), la misma que usa main.ts en la app de verdad.
function mountPicker(props: InstanceType<typeof TimeSlotPicker>['$props']) {
  return mount(TimeSlotPicker, { props, global: { plugins: [vuetify] } })
}

describe('TimeSlotPicker', () => {
  it('no ofrece un horario que ya está ocupado', () => {
    // Los huecos se calculan con la función pura real (no inventados a
    // mano), para que este test también sirva de puente: si
    // computeAvailableSlots cambiara de forma y dejara de excluir bien
    // los ocupados, este test lo notaría en la UI, no solo en
    // availability.spec.ts.
    const slots = computeAvailableSlots({
      branchHours: { opensAt: '09:00', closesAt: '11:00' },
      existingAppointments: [{ employeeId: 'e1', startsAt: '10:00', endsAt: '11:00' }],
      employeeId: 'e1',
      durationMinutes: 30,
      stepMinutes: 30,
    })

    const wrapper = mountPicker({ slots, modelValue: null })

    const text = wrapper.text()
    expect(text).not.toContain('10:00')
    expect(text).not.toContain('10:30')
    expect(text).toContain('09:00')
    expect(text).toContain('09:30')
  })

  it('muestra un mensaje en vez de una lista vacía cuando no hay huecos', () => {
    const wrapper = mountPicker({ slots: [], modelValue: null })
    expect(wrapper.text()).toContain('No hay huecos disponibles')
  })

  it('avisa con update:modelValue al elegir un horario', async () => {
    const slots = [{ startsAt: '09:00', endsAt: '09:30' }]
    const wrapper = mountPicker({ slots, modelValue: null })

    await wrapper.find('.v-chip').trigger('click')

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([slots[0]])
  })

  // Huecos con estado, calculados con la función pura real (09:00 a 11:00, de 30 min).
  // El empleado e1 tiene una cita de 10:00 a 10:45 y "ahora" es 09:15 del mismo día.
  const statusSlots = computeSlotStatuses({
    branchHours: { opensAt: '09:00', closesAt: '11:00' },
    existingAppointments: [{ employeeId: 'e1', startsAt: '10:00', endsAt: '10:45' }],
    employeeId: 'e1',
    durationMinutes: 30,
    stepMinutes: 30,
    date: '2026-10-12',
    now: { date: '2026-10-12', time: '09:15' },
  })

  it('muestra los horarios pasados pero deshabilitados', () => {
    // Si un horario pasado se pudiera elegir, la base lo rechazaría al guardar y la
    // persona perdería el formulario por un error evitable.
    const wrapper = mountPicker({ slots: statusSlots, modelValue: null })
    const chips = wrapper.findAll('.v-chip')

    expect(chips[0].text()).toContain('09:00')
    expect(chips[0].classes()).toContain('v-chip--disabled')
    expect(chips[1].classes()).not.toContain('v-chip--disabled')
  })

  it('el horario que se traslapa se puede elegir y lleva ícono de advertencia', () => {
    // El traslape ya no es un error (D26): se debe poder elegir. El color nunca va
    // solo (§5.6), por eso se verifica el ícono y no solo el amarillo.
    const wrapper = mountPicker({ slots: statusSlots, modelValue: null })
    const overlapChip = wrapper.findAll('.v-chip').find((c) => c.text().includes('10:00'))!

    expect(overlapChip.classes()).not.toContain('v-chip--disabled')
    expect(overlapChip.find('.mdi-alert').exists()).toBe(true)
  })

  it('el chip con traslape lleva la clase que lo pinta amarillo aunque no esté elegido', () => {
    // Vuetify ignora la prop `color` de un chip dentro de un grupo hasta que se elige:
    // con `color="overlap"` el horario se veía gris y solo se ponía amarillo al
    // seleccionarlo (se vio en el navegador). El amarillo va por clase propia; este test
    // protege que esa clase siga en el chip no seleccionado y NO en los libres.
    const wrapper = mountPicker({ slots: statusSlots, modelValue: null })
    const chips = wrapper.findAll('.v-chip')
    const overlapChip = chips.find((c) => c.text().includes('10:00'))!
    const freeChip = chips.find((c) => c.text().includes('09:30'))!

    expect(overlapChip.classes()).toContain('slot-chip--overlap')
    expect(freeChip.classes()).not.toContain('slot-chip--overlap')
  })

  it('al elegir un horario con traslape muestra el aviso con la cita que choca', () => {
    // Sin el aviso, la persona no sabría con qué cita se encima ni por qué el chip
    // es amarillo. Elegir un horario libre no debe mostrar ningún aviso.
    const overlap = statusSlots.find((s) => s.status === 'overlap')!
    const free = statusSlots.find((s) => s.status === 'free')!

    const withOverlap = mountPicker({ slots: statusSlots, modelValue: overlap })
    expect(withOverlap.text()).toContain('se traslapa con otra cita del empleado')
    expect(withOverlap.text()).toContain('10:45')

    const withFree = mountPicker({ slots: statusSlots, modelValue: free })
    expect(withFree.text()).not.toContain('se traslapa')
  })

  it('elegir un horario libre avisa con update:modelValue, y uno pasado no', async () => {
    // Un chip deshabilitado no debe emitir: si lo hiciera, el formulario quedaría
    // con un horario pasado seleccionado y el botón "Agendar" activo.
    const wrapper = mountPicker({ slots: statusSlots, modelValue: null })
    const chips = wrapper.findAll('.v-chip')

    await chips[0].trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()

    await chips[1].trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([statusSlots[1]])
  })
})
