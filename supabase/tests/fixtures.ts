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

// Clientes (fase 2, tarea 2.6) — los 6 primeros son de Patitas Felices,
// los últimos 2 de Huellitas Spa (para los tests de aislamiento).
export const CUSTOMER_SOFIA = 'd0000000-0000-4000-8000-000000000001'
export const CUSTOMER_DIEGO = 'd0000000-0000-4000-8000-000000000002'
export const CUSTOMER_VALENTINA = 'd0000000-0000-4000-8000-000000000003'
export const CUSTOMER_EMILIANO = 'd0000000-0000-4000-8000-000000000004'
export const CUSTOMER_CAMILA = 'd0000000-0000-4000-8000-000000000005'
export const CUSTOMER_SANTIAGO = 'd0000000-0000-4000-8000-000000000006' // el único que factura
export const CUSTOMER_FERNANDA = 'd0000000-0000-4000-8000-000000000007' // Huellitas Spa
export const CUSTOMER_RICARDO = 'd0000000-0000-4000-8000-000000000008' // Huellitas Spa

// Mascotas (fase 2, tarea 2.6).
export const PET_ROCKY = 'e0000000-0000-4000-8000-000000000001' // de Sofía, tiene pesos de ejemplo
export const PET_MICHI = 'e0000000-0000-4000-8000-000000000002' // de Sofía
export const PET_LUNA = 'e0000000-0000-4000-8000-000000000003' // de Diego
export const PET_TOBY = 'e0000000-0000-4000-8000-000000000004' // de Valentina
export const PET_NUBE = 'e0000000-0000-4000-8000-000000000005' // de Valentina
export const PET_KIRA = 'e0000000-0000-4000-8000-000000000006' // de Emiliano
export const PET_SIMON = 'e0000000-0000-4000-8000-000000000007' // de Camila
export const PET_COCO = 'e0000000-0000-4000-8000-000000000008' // de Camila
export const PET_MAX = 'e0000000-0000-4000-8000-000000000009' // de Santiago
export const PET_BRUNO = 'e0000000-0000-4000-8000-000000000010' // de Fernanda, Huellitas Spa
export const PET_PELUSA = 'e0000000-0000-4000-8000-000000000011' // de Fernanda, Huellitas Spa
export const PET_DUNA = 'e0000000-0000-4000-8000-000000000012' // de Ricardo, Huellitas Spa

// Catálogo de servicios (fase 3, tarea 3.3) — todos en Patitas Felices.
export const SERVICE_BANO = 'f0000000-0000-4000-8000-000000000001'
export const SERVICE_CORTE_RAZA = 'f0000000-0000-4000-8000-000000000002'
export const SERVICE_DESLANADO = 'f0000000-0000-4000-8000-000000000003'
export const SERVICE_CONSULTA_GENERAL = 'f0000000-0000-4000-8000-000000000004'
export const SERVICE_VACUNACION = 'f0000000-0000-4000-8000-000000000005'
export const SERVICE_DESPARASITACION = 'f0000000-0000-4000-8000-000000000006'

// Catálogo de vacunas (fase 4, tarea 4.5) — todas en Patitas Felices.
export const VACCINE_RABIA = '10000000-0000-4000-8000-000000000001'
export const VACCINE_TRIPLE_FELINA = '10000000-0000-4000-8000-000000000002'
export const VACCINE_SEXTUPLE_CANINA = '10000000-0000-4000-8000-000000000003'
export const VACCINE_BORDETELLA = '10000000-0000-4000-8000-000000000004'

// Un id con formato de UUID válido pero que NO existe en ninguna tabla.
// Sirve para probar "¿qué pasa si busco algo que no existe?" sin
// depender de que la semilla no haya cambiado.
export const NONEXISTENT_UUID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
