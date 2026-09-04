-- Migración trivial para verificar la tarea 1.41: confirmar que un merge
-- a main dispara el despliegue automático de migraciones a
-- fullpetcare-prod, sin que nadie tenga que correr "supabase db push" a
-- mano. No cambia ningún comportamiento, solo deja un comentario
-- verificable en la tabla tenants.
comment on table tenants is 'Negocios registrados en la plataforma (CLAUDE.md §6.1). Comentario agregado para verificar el despliegue automático de migraciones (tarea 1.41).';
