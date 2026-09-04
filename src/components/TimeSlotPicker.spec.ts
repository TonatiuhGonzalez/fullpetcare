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
import { computeAvailableSlots } from '@/lib/availability'
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
})
