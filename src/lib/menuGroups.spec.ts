// Pruebas del agrupado del menú lateral por sección.
import { describe, expect, it } from 'vitest'

import { groupMenuItems } from './menuGroups'

const item = (title: string, group?: string) => ({ title, group })

describe('groupMenuItems', () => {
  // Qué prueba: el caso normal. Las opciones se reúnen bajo su sección y el orden
  // (de secciones y de opciones) es el de la lista original. Si cambiara, el menú
  // saldría reordenado y la gente perdería la memoria muscular.
  it('reúne las opciones por sección conservando el orden', () => {
    const groups = groupMenuItems([
      item('Agenda', 'Operación'),
      item('Servicios', 'Catálogo'),
      item('Clientes', 'Operación'),
    ])
    expect(groups.map((g) => g.title)).toEqual(['Operación', 'Catálogo'])
    expect(groups[0].items.map((i) => i.title)).toEqual(['Agenda', 'Clientes'])
  })

  // Qué prueba: que una sección sin opciones visibles no aparece. Un groomer no tiene
  // Reportes ni Empleados; ver el título "Administración" vacío confundiría.
  it('solo existen las secciones que tienen opciones', () => {
    const groups = groupMenuItems([
      item('Agenda', 'Operación'),
      item('Servicios', 'Catálogo'),
    ])
    expect(groups.map((g) => g.title)).toEqual(['Operación', 'Catálogo'])
  })

  // Qué prueba: el menú del superadmin, que no tiene secciones. Todo va en un solo
  // grupo sin título, no en uno por opción.
  it('junta las opciones sin sección en un solo grupo sin título', () => {
    const groups = groupMenuItems([item('Empresas'), item('Planes')])
    expect(groups).toHaveLength(1)
    expect(groups[0].title).toBeNull()
    expect(groups[0].items).toHaveLength(2)
  })

  // Qué prueba: lista vacía (rol sin ninguna opción, o permisos aún cargando). No
  // debe lanzar error ni devolver un grupo fantasma.
  it('con una lista vacía devuelve cero grupos', () => {
    expect(groupMenuItems([])).toEqual([])
  })
})
