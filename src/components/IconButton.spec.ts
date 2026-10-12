// Prueba del botón de solo ícono con tooltip (C1.19). Si fallara en producción: un botón
// con solo un lápiz o un bote no diría qué hace al pasar el mouse, o en una tableta táctil
// el globo se quedaría pegado sobre la tabla.
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import IconButton from './IconButton.vue'
import { vuetify } from '@/plugins/vuetify'

function mountButton(attrs: Record<string, unknown>, hover: boolean) {
  // IconButton decide al montar si hay puntero; jsdom no trae matchMedia, se simula.
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: hover })),
  )
  return mount(IconButton, {
    attrs,
    global: { plugins: [vuetify] },
    attachTo: document.body,
  })
}

describe('IconButton', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('conserva el aria-label y el clic como un v-btn normal', async () => {
    const onClick = vi.fn()
    const wrapper = mountButton(
      { icon: 'mdi-pencil', 'aria-label': 'Editar cliente', onClick },
      true,
    )
    const button = wrapper.find('button')
    expect(button.attributes('aria-label')).toBe('Editar cliente')
    await button.trigger('click')
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('dibuja el ícono de la prop icon, con tooltip o sin él', () => {
    // Un slot vacío reenviado a v-btn le gana a la prop `icon`: los botones quedaban en
    // blanco (lo atrapó el E2E, que busca el botón por su ícono).
    const withTooltip = mountButton({ icon: 'mdi-plus', 'aria-label': 'Agregar pago' }, true)
    expect(withTooltip.find('button .mdi-plus').exists()).toBe(true)
    const withoutTooltip = mountButton({ icon: 'mdi-plus', 'aria-label': 'Agregar pago' }, false)
    expect(withoutTooltip.find('button .mdi-plus').exists()).toBe(true)
  })

  it('usa el title como aria-label y no deja el title nativo (evita dos globos)', () => {
    const wrapper = mountButton({ icon: 'mdi-close', title: 'Cerrar' }, true)
    const button = wrapper.find('button')
    expect(button.attributes('aria-label')).toBe('Cerrar')
    expect(button.attributes('title')).toBeUndefined()
  })

  it('con puntero envuelve el botón en un tooltip con el texto del aria-label', () => {
    // No se abre el globo en el test (jsdom no sabe medir ni posicionar overlays): basta
    // con comprobar que el tooltip existe y lleva el mismo texto que lee el lector de pantalla.
    const wrapper = mountButton({ icon: 'mdi-delete', 'aria-label': 'Eliminar cliente' }, true)
    const tooltip = wrapper.findComponent({ name: 'VTooltip' })
    expect(tooltip.exists()).toBe(true)
    expect(tooltip.props('text')).toBe('Eliminar cliente')
  })

  it('en pantalla táctil no monta el tooltip, pero el botón conserva su aria-label', () => {
    // En una tableta un toque largo dejaría el globo pegado sobre la tabla.
    const wrapper = mountButton({ icon: 'mdi-delete', 'aria-label': 'Eliminar cliente' }, false)
    expect(wrapper.findComponent({ name: 'VTooltip' }).exists()).toBe(false)
    expect(wrapper.find('button').attributes('aria-label')).toBe('Eliminar cliente')
  })

  it('un botón sin texto no monta tooltip vacío', () => {
    const wrapper = mountButton({ icon: 'mdi-dots-vertical' }, true)
    expect(wrapper.findComponent({ name: 'VTooltip' }).exists()).toBe(false)
  })
})
