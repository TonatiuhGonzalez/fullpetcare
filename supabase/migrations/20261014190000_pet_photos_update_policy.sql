-- =============================================================================
-- Permite reemplazar la foto de una mascota (UPDATE en Storage, pet-photos)
-- =============================================================================
-- Problema: `uploadPhoto()` (services/pets.ts) sube SIEMPRE a la misma ruta
-- `{tenant_id}/{pet_id}/foto.{ext}` con `upsert: true`, para no acumular
-- archivos huérfanos. La primera vez es un INSERT y pasa por
-- `pet_photos_insert`. Pero cuando la mascota YA tiene foto, el upsert se
-- convierte en un UPDATE de la fila de `storage.objects`, y la migración
-- original (pet_photos_bucket.sql) no creó política de UPDATE: Postgres lo
-- rechaza con "new row violates row-level security policy" y el formulario
-- de la mascota no se puede guardar.
--
-- Solución: una política de UPDATE con el MISMO criterio que la de INSERT
-- (miembro del tenant de la primera carpeta y rol dueño o recepción).
-- `using` decide qué filas existentes se pueden tocar; `with check` repite
-- la regla sobre la fila resultante para que nadie "mueva" un archivo a la
-- carpeta de otro tenant renombrándolo.
--
-- Sigue sin haber política de DELETE: la foto se reemplaza, no se borra.
create policy pet_photos_update on storage.objects for update
  to authenticated
  using (
    bucket_id = 'pet-photos'
    and app.is_member_of((storage.foldername(name))[1]::uuid)
    and app.role_in((storage.foldername(name))[1]::uuid) in ('owner', 'receptionist')
  )
  with check (
    bucket_id = 'pet-photos'
    and app.is_member_of((storage.foldername(name))[1]::uuid)
    and app.role_in((storage.foldername(name))[1]::uuid) in ('owner', 'receptionist')
  );
