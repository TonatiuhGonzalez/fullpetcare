-- Bucket de Storage para fotos de mascotas (tarea 2.14).
--
-- =============================================================================
-- Qué es un "bucket" y cómo se relaciona con las tablas normales
-- =============================================================================
-- Storage en Supabase no es un sistema aparte: es una tabla más de
-- Postgres (`storage.objects`, una fila por archivo subido) con RLS
-- encima, exactamente como `customers` o `pets`. Un "bucket" es solo una
-- fila en `storage.buckets` que agrupa archivos bajo un nombre — algo
-- así como una carpeta raíz. Por eso las políticas de Storage se
-- escriben con la MISMA sintaxis `create policy` que ya se usó en todo
-- el proyecto, aunque la tabla en cuestión (`storage.objects`) no la
-- creó una migración de este repo, la trae Supabase de fábrica.
--
-- `public: false` es la pieza importante: un bucket público serviría
-- cualquier archivo por URL directa a cualquiera que la tenga, sin
-- pasar por RLS ni por sesión — el equivalente de Storage a no tener
-- políticas en una tabla normal. Con `public: false`, cada intento de
-- leer o subir un archivo pasa por las políticas de abajo, igual que
-- una consulta a una tabla.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pet-photos',
  'pet-photos',
  false,
  5242880, -- 5 MB, generoso para una foto de celular sin ser excesivo
  array['image/jpeg', 'image/png', 'image/webp']
);

-- =============================================================================
-- Por qué la ruta del archivo ES la seguridad
-- =============================================================================
-- `storage.objects.name` es la RUTA completa del archivo dentro del
-- bucket (p. ej. "b0000000-.../e0000000-.../foto1.jpg"), no solo el
-- nombre. La convención que usa este proyecto: el PRIMER segmento de la
-- ruta es siempre el tenant_id — así, quien sube el archivo (la UI, en
-- la tarea 2.19) decide en qué "carpeta" de tenant queda, y la política
-- de abajo solo necesita mirar ESE primer segmento para saber si el
-- usuario tiene permiso.
--
-- `storage.foldername(name)` es una función que trae Supabase: parte la
-- ruta por "/" y devuelve un arreglo con cada carpeta (sin el nombre de
-- archivo final). `(storage.foldername(name))[1]` es el primer elemento
-- de ese arreglo — el tenant_id como texto. Los arreglos en Postgres
-- empiezan en el índice 1, no en 0.
--
-- Esto es lo mismo aislamiento multi-tenant que en cualquier tabla
-- (CLAUDE.md §7), aplicado a archivos: la ruta hace el papel que
-- normalmente hace la columna `tenant_id`.
create policy pet_photos_select on storage.objects for select
  to authenticated
  using (
    bucket_id = 'pet-photos'
    and app.is_member_of((storage.foldername(name))[1]::uuid)
  );

-- Igual que con pets/customers: cualquier miembro activo puede VER las
-- fotos, pero solo owner/receptionist pueden SUBIR una nueva (dar de
-- alta o editar una mascota es su tarea, CLAUDE.md §6.1).
create policy pet_photos_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'pet-photos'
    and app.is_member_of((storage.foldername(name))[1]::uuid)
    and app.role_in((storage.foldername(name))[1]::uuid) in ('owner', 'receptionist')
  );

-- Sin política de UPDATE ni DELETE a propósito: reemplazar la foto de
-- una mascota es subir un archivo nuevo (una ruta nueva, vía
-- PetFormDialog en la tarea 2.19) y actualizar `pets.photo_path` para
-- que apunte ahí — no editar el archivo existente. El archivo viejo
-- queda huérfano en el bucket, aceptable para un demo (CLAUDE.md §11,
-- "simple sobre elegante"); una limpieza de archivos huérfanos no está
-- en el alcance de v1.
