-- Tabla employee_documents + bucket de Storage "employee-documents"
-- (CLAUDE.md §6.7, fase 9): los documentos escaneados de un empleado
-- (credencial de elector, comprobante de domicilio, contrato firmado).
-- Mismo patrón que pet_photos_bucket.sql (fase 2): la tabla guarda la
-- RUTA del archivo (nunca el archivo en sí, eso vive en Storage) más
-- quién lo subió y cuándo; el archivo real se protege con políticas sobre
-- storage.objects, escritas igual que cualquier política de este
-- proyecto (Storage no es un sistema aparte, es una tabla de Postgres con
-- RLS encima — ver el comentario completo en pet_photos_bucket.sql).
create type employee_document_type as enum (
  'voter_id',           -- credencial de elector (INE)
  'address_proof',      -- comprobante de domicilio
  'employment_contract' -- contrato firmado
);

create table employee_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  membership_id uuid not null references memberships(id),
  document_type employee_document_type not null,
  storage_path text not null,
  -- default auth.uid(): quien sube el archivo es siempre quien está
  -- autenticado en ese momento — no hace falta que el frontend lo mande
  -- explícito (services/employeeDocuments.ts no necesita una consulta
  -- aparte solo para saber "quién soy").
  uploaded_by uuid not null references auth.users(id) default auth.uid(),
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- Un solo documento VIGENTE por tipo y por empleado — igual criterio
  -- que pets.photo_path: volver a subir la credencial de elector
  -- reemplaza el archivo en la MISMA ruta (upsert: true en
  -- services/employeeDocuments.ts), no acumula versiones viejas
  -- huérfanas en el bucket.
  unique (membership_id, document_type)
);

create index employee_documents_tenant_id_idx on employee_documents (tenant_id);
create index employee_documents_tenant_membership_idx on employee_documents (tenant_id, membership_id);

create trigger employee_documents_set_updated_at
  before update on employee_documents
  for each row execute function app.set_updated_at();

create trigger employee_documents_audit
  after insert or update or delete on employee_documents
  for each row execute function app.log_change();

comment on table employee_documents is
  'Metadatos de un documento escaneado de un empleado (ruta en Storage, quién lo subió, cuándo). El archivo vive en el bucket "employee-documents".';

alter table employee_documents enable row level security;
alter table employee_documents force row level security;

-- Misma trampa de siempre (CLAUDE.md §7.2): esta tabla tiene UPDATE para
-- un rol autenticado (reemplazar un documento actualiza uploaded_by/
-- uploaded_at de la misma fila), así que el SELECT no filtra
-- "deleted_at is null" — eso lo hace services/employeeDocuments.ts.
create policy employee_documents_select on employee_documents for select
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and app.has_permission(tenant_id, 'employees', 'view')
  );

create policy employee_documents_insert on employee_documents for insert
  to authenticated
  with check (
    app.is_member_of(tenant_id)
    and app.has_permission(tenant_id, 'employees', 'edit')
  );

create policy employee_documents_update on employee_documents for update
  to authenticated
  using (
    app.is_member_of(tenant_id)
    and app.has_permission(tenant_id, 'employees', 'edit')
  )
  with check (
    app.is_member_of(tenant_id)
    and app.has_permission(tenant_id, 'employees', 'edit')
  );

-- Sin política de DELETE (CLAUDE.md §7.3): reemplazar un documento es un
-- UPDATE de la misma fila (mismo storage_path fijo), no un borrado.

-- =============================================================================
-- Bucket "employee-documents"
-- =============================================================================
-- `public: false`: cada lectura pasa por las políticas de abajo, igual
-- que "pet-photos" (pet_photos_bucket.sql). 10 MB (más que los 5 MB de
-- las fotos de mascota) porque un PDF de contrato escaneado pesa más que
-- una foto de celular comprimida.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'employee-documents',
  'employee-documents',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
);

-- Misma convención que pet-photos: el PRIMER segmento de la ruta es el
-- tenant_id — `storage.foldername(name)` la parte en carpetas, `[1]` es
-- la primera (los arreglos de Postgres empiezan en 1, no en 0). La ruta
-- completa que usa services/employeeDocuments.ts es
-- "{tenant_id}/{membership_id}/{document_type}.{ext}".
--
-- A diferencia de pet-photos (que compara el ROL directo), aquí se
-- reutiliza app.has_permission() — el mismo criterio configurable de
-- "employees:view"/"employees:edit" que ya protege employee_details y
-- employee_documents.
create policy employee_documents_storage_select on storage.objects for select
  to authenticated
  using (
    bucket_id = 'employee-documents'
    and app.has_permission((storage.foldername(name))[1]::uuid, 'employees', 'view')
  );

create policy employee_documents_storage_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'employee-documents'
    and app.has_permission((storage.foldername(name))[1]::uuid, 'employees', 'edit')
  );

-- Reemplazar un documento es subir con `upsert: true` al MISMO nombre de
-- archivo (mismo criterio que pet-photos) — eso internamente ya cubre el
-- "update" del archivo vía la política de INSERT; Supabase Storage no
-- distingue upsert como un comando UPDATE aparte a nivel de política.
-- Sin política de DELETE, mismo motivo que en la tabla: nunca se borra,
-- se reemplaza.
