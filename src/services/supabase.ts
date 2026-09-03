// Cliente único de Supabase para toda la app. Ningún componente ni store
// crea su propio cliente — todos importan este (CLAUDE.md §4, "la regla
// de capas").
import { createClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  // Falla rápido y con un mensaje claro en vez de dejar que la app cargue
  // a medias y falle más adelante con un error de red críptico. Ver
  // README "Variables de entorno".
  throw new Error(
    'Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copia .env.example a .env.local y complétalo (ver README).',
  )
}

// El genérico <Database> es lo que le da a "supabase.from('customers')"
// autocompletado real de columnas, y marca en rojo un nombre de tabla o
// columna que no existe. Viene de src/types/database.ts (generado por
// "npm run db:types").
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)
