// Prueba services/memberships.ts — sesión real, mismo patrón que
// customers-service.spec.ts. Este archivo nunca tuvo su propio test
// (revisión de cobertura, tarea 8.2): solo se ejercitaba indirectamente a
// través de session.spec.ts (con un MOCK, que nunca corre el código
// real) y con el ojo del usuario probando la app en el navegador. La
// lógica que de verdad importa aquí — "el dueño ve TODAS las sucursales
// de su tenant sin tener una fila en membership_branches" — nunca se
// había probado contra la base real.
import { describe, expect, it } from 'vitest'

import * as membershipsService from '@/services/memberships'
import { supabase } from '@/services/supabase'

import {
  BRANCH_CENTRO,
  BRANCH_DEL_VALLE,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
  USER_VET,
} from './fixtures'

const DUENO_EMAIL = 'dueno@patitasfelices.mx'
const DUENO_PASSWORD = 'Demo1234!'

describe('services/memberships.ts contra Supabase local', () => {
  it('listMyMemberships: el dueño ve TODAS las sucursales de su tenant, sin fila en membership_branches', async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (error) throw error

    const memberships = await membershipsService.listMyMemberships(USER_DUENO)

    expect(memberships).toHaveLength(1)
    const [patitas] = memberships
    expect(patitas.tenantId).toBe(TENANT_PATITAS)
    expect(patitas.role).toBe('owner')
    // Dos sucursales (Centro y Del Valle) aunque el dueño no tenga NINGUNA
    // fila en membership_branches — es justo el caso especial que
    // listMyMemberships() resuelve pidiendo TODAS las sucursales del
    // tenant en vez de depender de esa tabla (CLAUDE.md §6.1).
    expect(patitas.branches.map((b) => b.id).sort()).toEqual(
      [BRANCH_CENTRO, BRANCH_DEL_VALLE].sort(),
    )

    await supabase.auth.signOut()
  })

  it('listMyMemberships: un groomer solo ve LAS sucursales que sí tiene en membership_branches', async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email: 'groomer@patitasfelices.mx',
      password: DUENO_PASSWORD,
    })
    if (error) throw error

    const memberships = await membershipsService.listMyMemberships(USER_GROOMER)

    expect(memberships).toHaveLength(1)
    // El groomer sembrado solo tiene Centro (seed.sql) — a diferencia del
    // dueño, para él SÍ importa la fila real de membership_branches.
    expect(memberships[0].branches.map((b) => b.id)).toEqual([BRANCH_CENTRO])

    await supabase.auth.signOut()
  })

  it('listBranchEmployees: incluye al dueño en CUALQUIER sucursal, y a los demás solo donde tienen acceso', async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (error) throw error

    const centro = await membershipsService.listBranchEmployees(TENANT_PATITAS, BRANCH_CENTRO)
    const delValle = await membershipsService.listBranchEmployees(TENANT_PATITAS, BRANCH_DEL_VALLE)

    const centroIds = centro.map((e) => e.userId).sort()
    const delValleIds = delValle.map((e) => e.userId).sort()

    // El dueño y la recepción y el groomer están en Centro (seed.sql);
    // el vet SOLO en Del Valle.
    expect(centroIds).toEqual([USER_DUENO, USER_GROOMER, USER_RECEPCION].sort())
    expect(delValleIds).toEqual([USER_DUENO, USER_VET].sort())

    await supabase.auth.signOut()
  })
})
