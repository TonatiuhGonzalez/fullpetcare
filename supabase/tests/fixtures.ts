// Ids fijos de la semilla de demo (supabase/seed.sql). Deben coincidir
// EXACTAMENTE con los que ese archivo inserta — si cambias uno allá,
// cámbialo aquí también. Tenerlos como constantes en vez de consultarlos
// en cada test hace que los tests sean más rápidos y más fáciles de leer
// ("el groomer" en vez de "una fila cualquiera con role = 'groomer'").
export const TENANT_PATITAS = 'b0000000-0000-4000-8000-000000000001'
export const TENANT_HUELLITAS = 'b0000000-0000-4000-8000-000000000002'

export const BRANCH_CENTRO = 'c0000000-0000-4000-8000-000000000001'
export const BRANCH_DEL_VALLE = 'c0000000-0000-4000-8000-000000000002'
export const BRANCH_TIJUANA = 'c0000000-0000-4000-8000-000000000003'

export const USER_DUENO = 'a0000000-0000-4000-8000-000000000001'
export const USER_RECEPCION = 'a0000000-0000-4000-8000-000000000002'
export const USER_GROOMER = 'a0000000-0000-4000-8000-000000000003'
export const USER_VET = 'a0000000-0000-4000-8000-000000000004'

// Un id con formato de UUID válido pero que NO existe en ninguna tabla.
// Sirve para probar "¿qué pasa si busco algo que no existe?" sin
// depender de que la semilla no haya cambiado.
export const NONEXISTENT_UUID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
