-- =============================================================================
-- Imagen de la empresa (fase 26, PLAN.md D29)
-- =============================================================================
-- Qué agrega:
--   1. `tenants.logo_path`: la RUTA del archivo en Storage (no una URL), nula si
--      el negocio no tiene imagen. Misma idea que `pets.photo_path`.
--   2. `set_tenant_logo()`: la forma en que el dueño guarda o quita esa ruta.
--   3. El bucket privado `tenant-logos` y sus políticas de Storage.
--
-- Migración aditiva (CLAUDE.md §8.1): no toca nada existente.

-- =============================================================================
-- 1. Columna
-- =============================================================================
-- Nullable y sin valor por defecto: "sin imagen" es NULL, y la interfaz vuelve a
-- las iniciales del negocio.
alter table tenants add column logo_path text;

comment on column tenants.logo_path is
  'Ruta de la imagen de la empresa en el bucket tenant-logos ({tenant_id}/logo.{ext}); nulo si no tiene.';

-- =============================================================================
-- 2. set_tenant_logo(): el dueño guarda o quita la ruta
-- =============================================================================
-- Por qué una RPC y no una política de UPDATE en `tenants`: RLS filtra filas, no
-- columnas (CLAUDE.md §6.8). Una política de UPDATE le dejaría al dueño cambiar
-- también `timezone` o `rfc` por la API. Es el mismo criterio de
-- update_tenant_fiscal_data().
--
-- SECURITY DEFINER: salta RLS para escribir `tenants`, así que revalida adentro
-- que quien llama es el dueño activo (CLAUDE.md §7.3.4). El trigger
-- `enforce_tenant_writable` sigue aplicando (auth.uid() no es nulo): un negocio
-- en solo lectura no puede cambiar su imagen.
create function set_tenant_logo(p_tenant_id uuid, p_logo_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text := nullif(btrim(p_logo_path), '');
begin
  -- app.role_in() ya exige membresía activa y negocio no bloqueado; devuelve
  -- null si no es miembro, y `null = 'owner'` no es verdadero.
  if app.role_in(p_tenant_id) is distinct from 'owner' then
    raise exception 'Solo el dueño puede cambiar la imagen de la empresa.' using errcode = '42501';
  end if;

  -- La ruta debe vivir en la carpeta del propio negocio: es lo que la política de
  -- Storage revisa para decidir quién la lee. Sin esto, el dueño podría apuntar su
  -- imagen al archivo de otro negocio.
  if v_path is not null and v_path !~ ('^' || p_tenant_id::text || '/logo\.(jpg|jpeg|png|webp)$') then
    raise exception 'La ruta de la imagen no es válida.' using errcode = '22023';
  end if;

  update tenants set logo_path = v_path where id = p_tenant_id;
end;
$$;

comment on function set_tenant_logo(uuid, text) is
  'Guarda (o quita, con nulo) la ruta de la imagen de la empresa. Solo el dueño activo. SECURITY DEFINER: revalida el rol adentro.';

revoke execute on function set_tenant_logo(uuid, text) from public, anon;
grant execute on function set_tenant_logo(uuid, text) to authenticated;

-- =============================================================================
-- 3. Bucket privado `tenant-logos`
-- =============================================================================
-- `public: false`: cada lectura pasa por las políticas de abajo, igual que
-- `pet-photos`. 2 MB sobra para un logotipo; solo imágenes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tenant-logos',
  'tenant-logos',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
);

-- Misma convención que `pet-photos`: el PRIMER segmento de la ruta es el
-- tenant_id. La ruta completa es "{tenant_id}/logo.{ext}".
--
-- Leer: cualquier miembro activo del negocio (la imagen sale en el menú de todos).
create policy tenant_logos_select on storage.objects for select
  to authenticated
  using (
    bucket_id = 'tenant-logos'
    and app.is_member_of((storage.foldername(name))[1]::uuid)
  );

-- Escribir: solo el dueño. Subir la primera vez es INSERT; reemplazarla (upsert al
-- mismo nombre) es UPDATE, que ya aprendimos que necesita su propia política
-- (20261014190000_pet_photos_update_policy.sql). Quitarla es DELETE.
create policy tenant_logos_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'tenant-logos'
    and app.is_member_of((storage.foldername(name))[1]::uuid)
    and app.role_in((storage.foldername(name))[1]::uuid) = 'owner'
  );

create policy tenant_logos_update on storage.objects for update
  to authenticated
  using (
    bucket_id = 'tenant-logos'
    and app.is_member_of((storage.foldername(name))[1]::uuid)
    and app.role_in((storage.foldername(name))[1]::uuid) = 'owner'
  )
  with check (
    bucket_id = 'tenant-logos'
    and app.is_member_of((storage.foldername(name))[1]::uuid)
    and app.role_in((storage.foldername(name))[1]::uuid) = 'owner'
  );

-- A diferencia de la foto de una mascota, la imagen de la empresa SÍ se puede
-- quitar, y no es expediente (§8.5): sin DELETE quedaría el archivo huérfano.
create policy tenant_logos_delete on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'tenant-logos'
    and app.is_member_of((storage.foldername(name))[1]::uuid)
    and app.role_in((storage.foldername(name))[1]::uuid) = 'owner'
  );
