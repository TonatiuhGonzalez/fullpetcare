/// <reference types="vite/client" />

// Tipa las variables de entorno que usa la app (todas con prefijo VITE_,
// que es lo único que Vite incrusta en el bundle del navegador — ver
// README "Variables de entorno" y CLAUDE.md §10). Sin esto,
// import.meta.env.VITE_SUPABASE_URL sería de tipo "any".
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
