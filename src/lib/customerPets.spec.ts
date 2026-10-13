// Tests de lib/customerPets.ts (Correcciones 1, C1.15 y C1.16): el armado de la
// columna "Mascotas" de la tabla de clientes y la mascota elegida de la página de cliente.
import { describe, expect, it } from 'vitest'

import {
  customerIdsByPetName,
  groupPetsByCustomer,
  MAX_PET_CHIPS,
  pickSelectedPetId,
  speciesIcon,
  splitVisiblePets,
} from './customerPets'

describe('groupPetsByCustomer', () => {
  // Una sola consulta trae todas las mascotas; si el reparto se equivocara, la fila de
  // un cliente mostraría las mascotas de otro (y la recepción las confundiría).
  it('reparte cada mascota con su cliente y conserva el orden recibido', () => {
    const map = groupPetsByCustomer([
      { id: 'p1', customer_id: 'a' },
      { id: 'p2', customer_id: 'b' },
      { id: 'p3', customer_id: 'a' },
    ])
    expect(map.get('a')?.map((p) => p.id)).toEqual(['p1', 'p3'])
    expect(map.get('b')?.map((p) => p.id)).toEqual(['p2'])
  })

  // Borde: la mayoría de los clientes nuevos no tienen mascota. Debe dar "sin entrada",
  // no reventar al leer la fila.
  it('no crea entrada para un cliente sin mascotas ni falla con la lista vacía', () => {
    expect(groupPetsByCustomer([]).size).toBe(0)
    expect(groupPetsByCustomer([{ id: 'p1', customer_id: 'a' }]).get('z')).toBeUndefined()
  })
})

describe('splitVisiblePets', () => {
  // Borde exacto: con justo el máximo no debe aparecer un "+0 más" ni esconder nada.
  it('muestra todas cuando caben justo en el máximo', () => {
    const pets = Array.from({ length: MAX_PET_CHIPS }, (_, i) => i)
    expect(splitVisiblePets(pets)).toEqual({ visible: pets, hiddenCount: 0 })
  })

  // Un cliente con 7 mascotas rompería la fila de la tabla si se pintaran todas.
  it('oculta el exceso y dice cuántas faltan', () => {
    const result = splitVisiblePets([1, 2, 3, 4, 5, 6, 7], 3)
    expect(result.visible).toEqual([1, 2, 3])
    expect(result.hiddenCount).toBe(4)
  })

  it('con lista vacía no muestra nada ni oculta nada', () => {
    expect(splitVisiblePets([])).toEqual({ visible: [], hiddenCount: 0 })
  })

  // Un máximo negativo por error de quien llama no debe producir un conteo absurdo.
  it('trata un máximo negativo como cero', () => {
    expect(splitVisiblePets([1, 2], -1)).toEqual({ visible: [], hiddenCount: 2 })
  })
})

describe('speciesIcon', () => {
  // El color nunca va solo y el ícono es lo que distingue la especie en el chip.
  it('da un ícono por especie y uno genérico para "otro"', () => {
    expect(speciesIcon('dog')).toBe('mdi-dog')
    expect(speciesIcon('cat')).toBe('mdi-cat')
    expect(speciesIcon('other')).toBe('mdi-paw')
  })
})

describe('pickSelectedPetId', () => {
  const pets = [{ id: 'p1' }, { id: 'p2' }]

  it('elige la primera mascota cuando no había ninguna elegida', () => {
    expect(pickSelectedPetId(pets, null)).toBe('p1')
  })

  // Tras editar o agregar una mascota la página recarga; si saltara a la primera, el
  // usuario perdería la mascota que estaba viendo.
  it('conserva la elegida si sigue en la lista', () => {
    expect(pickSelectedPetId(pets, 'p2')).toBe('p2')
  })

  // Al eliminar la mascota elegida la pantalla no puede quedarse apuntando a una que ya
  // no existe.
  it('pasa a la primera si la elegida ya no existe', () => {
    expect(pickSelectedPetId(pets, 'zz')).toBe('p1')
  })

  it('devuelve null sin mascotas', () => {
    expect(pickSelectedPetId([], 'p1')).toBeNull()
  })
})

describe('customerIdsByPetName', () => {
  const pets = new Map([
    ['c1', [{ name: 'Max' }, { name: 'Maxine' }]],
    ['c2', [{ name: 'Peña' }]],
    ['c3', [{ name: 'Luna' }]],
  ])

  // Qué prueba: que el nombre de la mascota se compara sin acentos ni mayúsculas.
  // Qué se rompería: la recepción escribe "MAX" y no encuentra al dueño de "Max".
  it('encuentra al dueño por el nombre de su mascota sin importar mayúsculas', () => {
    expect(customerIdsByPetName(pets, 'MAX')).toEqual(['c1'])
  })

  // Qué prueba: la ñ no es la n (misma regla que la búsqueda de clientes en la base).
  // Qué se rompería: "pena" mostraría al dueño de "Peña" y la pantalla diría cosas
  // distintas a la base.
  it('no confunde la ñ con la n', () => {
    expect(customerIdsByPetName(pets, 'pena')).toEqual([])
    expect(customerIdsByPetName(pets, 'peña')).toEqual(['c2'])
  })

  // Qué prueba: un cliente con dos mascotas que coinciden aparece una sola vez, y los que
  // ya encontró la búsqueda normal se omiten.
  // Qué se rompería: la fila del cliente saldría repetida en la tabla.
  it('no repite clientes ni los que ya estaban en los resultados', () => {
    expect(customerIdsByPetName(pets, 'max')).toEqual(['c1'])
    expect(customerIdsByPetName(pets, 'max', new Set(['c1']))).toEqual([])
  })

  // Qué prueba: texto vacío o solo espacios no marca a todos los clientes.
  // Qué se rompería: al borrar la búsqueda se sumarían clientes duplicados a la lista.
  it('devuelve vacío con un término vacío', () => {
    expect(customerIdsByPetName(pets, '   ')).toEqual([])
  })
})
