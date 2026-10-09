// Agrupa las opciones del menú lateral por su sección ("Operación", "Catálogo"…),
// conservando el orden en que aparecen. Las opciones sin sección van juntas, sin
// título (así lo usa el menú del superadmin). Una sección sin opciones visibles
// no existe: si al rol no le toca ninguna opción de "Administración", ese título no
// se dibuja.

export interface GroupableItem {
  group?: string
}

export interface MenuGroup<T extends GroupableItem> {
  title: string | null
  items: T[]
}

export function groupMenuItems<T extends GroupableItem>(items: T[]): MenuGroup<T>[] {
  const groups: MenuGroup<T>[] = []
  for (const item of items) {
    const title = item.group ?? null
    let group = groups.find((g) => g.title === title)
    if (!group) {
      group = { title, items: [] }
      groups.push(group)
    }
    group.items.push(item)
  }
  return groups
}
