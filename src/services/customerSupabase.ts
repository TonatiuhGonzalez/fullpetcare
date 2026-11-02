// Segundo cliente de Supabase, SOLO para la cuenta del dueño de la mascota (fase 16B, PLAN.md D31).
//
// Por qué un cliente aparte y no el de `supabase.ts`: el personal y el dueño de una mascota
// son sesiones distintas. Con un solo cliente, quien abre /mi-cuenta en el mismo navegador donde
// trabaja la recepción le cerraría (o le prestaría) la sesión de trabajo. Un `storageKey` propio
// los mantiene separados. Es la única excepción a "un solo cliente" (CLAUDE.md §4).
import { createClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const customerSupabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: { storageKey: 'fpc-customer-auth' },
})
