// Prueba de ResponsiveTable (fase 26, tarea 26.13). Si fallara en producción: en un celular
// Clientes, Servicios, Inventario, Empleados y Vacunas volverían a verse como una tabla
// cortada a la derecha, o una tarjeta perdería su botón de acciones.
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ResponsiveTable from './ResponsiveTable.vue'
import { vuetify } from '@/plugins/vuetify'

const headers = [
  { title: 'Nombre', key: 'name' },
  { title: 'Teléfono', key: 'phone' },
  { title: 'Oculta', key: 'secret', cardHidden: true },
  { title: 'Acciones', key: 'actions', sortable: false },
]
const items = [
  { id: 'c1', name: 'Sofía Ramírez', phone: '5512345601', secret: 'x' },
  { id: 'c2', name: 'Diego Martínez', phone: null, secret: 'y' },
]

// Vuetify mide el ancho de la ventana al arrancar y al recibir `resize`.
async function setWidth(width: number): Promise<void> {
  window.innerWidth = width
  window.dispatchEvent(new Event('resize'))
  await vi.waitFor(() => expect(vuetify.display.width.value).toBe(width))
}

function mountTable(props: Record<string, unknown> = {}) {
  return mount(ResponsiveTable, {
    props: { items, ...props },
    attrs: { headers },
    slots: {
      'item.actions': '<button class="act">Editar</button>',
    },
    global: { plugins: [vuetify] },
    attachTo: document.body,
  })
}

describe('ResponsiveTable', () => {
  afterEach(async () => {
    document.body.innerHTML = ''
    await setWidth(1024)
  })

  // Qué prueba: en escritorio sigue siendo la tabla de siempre.
  // Qué se rompería: el escritorio perdería su tabla ordenable y paginada.
  it('en pantalla grande muestra la tabla', async () => {
    await setWidth(1280)
    const wrapper = mountTable()
    expect(wrapper.find('table').exists()).toBe(true)
    expect(wrapper.find('.responsive-table__card').exists()).toBe(false)
  })

  // Qué prueba: en celular hay una tarjeta por fila con título, datos y acciones, y la
  // columna marcada `cardHidden` no sale.
  // Qué se rompería: se verían columnas internas o se perdería el botón de editar/eliminar.
  it('en pantalla chica muestra una tarjeta por fila con sus acciones', async () => {
    await setWidth(390)
    const wrapper = mountTable()

    const cards = wrapper.findAll('.responsive-table__card')
    expect(cards).toHaveLength(2)
    expect(wrapper.find('table').exists()).toBe(false)

    expect(cards[0].find('.responsive-table__title').text()).toBe('Sofía Ramírez')
    expect(cards[0].text()).toContain('Teléfono')
    expect(cards[0].text()).toContain('5512345601')
    expect(cards[0].text()).not.toContain('Oculta')
    expect(cards[0].find('.act').exists()).toBe(true)
  })

  // Qué prueba: un dato vacío sale como "—" y no como "null".
  // Qué se rompería: una tarjeta mostraría la palabra "null" al cliente sin teléfono.
  it('muestra "—" cuando falta un dato', async () => {
    await setWidth(390)
    const wrapper = mountTable()
    expect(wrapper.findAll('.responsive-table__card')[1].text()).toContain('—')
    expect(wrapper.text()).not.toContain('null')
  })

  // Qué prueba: tocar la tarjeta avisa qué fila fue, solo si la página lo pidió.
  // Qué se rompería: en celular no se podría abrir la página del cliente (en la tabla
  // lo hace el clic en la fila).
  it('con `clickable`, tocar la tarjeta emite click:item con la fila', async () => {
    await setWidth(390)
    const wrapper = mountTable({ clickable: true })
    await wrapper.findAll('.responsive-table__card')[0].trigger('click')
    expect(wrapper.emitted('click:item')?.[0]).toEqual([items[0]])
  })

  // Qué prueba: sin `clickable`, tocar la tarjeta no emite nada.
  // Qué se rompería: en Servicios o Inventario, tocar el texto de una tarjeta dispararía una
  // navegación que la tabla de escritorio no tiene.
  it('sin `clickable`, tocar la tarjeta no emite nada', async () => {
    await setWidth(390)
    const wrapper = mountTable()
    await wrapper.findAll('.responsive-table__card')[0].trigger('click')
    expect(wrapper.emitted('click:item')).toBeUndefined()
  })

  // Qué prueba: la lista vacía muestra el texto de "sin datos" de la página.
  // Qué se rompería: una lista sin filas quedaría en blanco sin explicación.
  it('sin filas muestra el texto de "sin datos"', async () => {
    await setWidth(390)
    const wrapper = mount(ResponsiveTable, {
      props: { items: [] },
      attrs: { headers, 'no-data-text': 'Todavía no hay empleados.' },
      global: { plugins: [vuetify] },
      attachTo: document.body,
    })
    expect(wrapper.text()).toContain('Todavía no hay empleados.')
  })
})
