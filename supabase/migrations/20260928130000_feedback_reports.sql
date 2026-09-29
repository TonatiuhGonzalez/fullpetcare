-- Tarea #1958: reportes de errores y sugerencias de mejora del cliente.
--
-- Cualquier usuario de un negocio puede escribir un mensaje (con una captura de
-- pantalla opcional) desde el botón de la barra superior. Los reportes los lee
-- SOLO el equipo de la plataforma, desde /superadmin.
--
-- Por qué la tabla lleva `tenant_id` aunque el superadmin la lea:
-- a la plataforma le importa saber DE QUÉ negocio viene el reporte, y así el
-- aislamiento sigue el patrón de siempre (CLAUDE.md §6). Pero un reporte NO es
-- un dato de negocio que el propio negocio consulte, por eso:
--   - Los miembros solo pueden INSERTAR (y solo a nombre suyo). No hay política
--     de SELECT para ellos: no releen lo que enviaron ni lo que enviaron sus
--     compañeros.
--   - El superadmin NO lo lee con una política de la tabla (ninguna política de
--     negocio lo menciona, CLAUDE.md §7.5) sino por la RPC
--     `platform_list_feedback`, que revalida `is_platform_admin()`.
--   - Sin política de UPDATE ni de DELETE: un reporte enviado no se edita.
create table feedback_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  -- default auth.uid(): quien envía es siempre quien está autenticado; la
  -- política de INSERT exige además que coincida.
  user_id uuid not null references auth.users(id) default auth.uid(),
  message text not null check (btrim(message) <> '' and char_length(message) <= 2000),
  -- Ruta de la captura en el bucket "feedback-screenshots"; null si no adjuntó.
  screenshot_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index feedback_reports_tenant_id_idx on feedback_reports (tenant_id, created_at desc);

create trigger feedback_reports_set_updated_at
  before update on feedback_reports
  for each row execute function app.set_updated_at();

-- Negocio en solo lectura, suspendido o dado de baja: no puede enviar reportes
-- (misma regla que el resto de las tablas con tenant_id, tenant-blocking.spec.ts).
create trigger enforce_tenant_writable
  before insert or update on feedback_reports
  for each row execute function app.enforce_tenant_writable();

comment on table feedback_reports is
  'Reportes de errores y sugerencias enviados por usuarios de un negocio. Los miembros solo insertan; solo superadmins leen (RPC platform_list_feedback).';

alter table feedback_reports enable row level security;
alter table feedback_reports force row level security;

create policy feedback_reports_insert on feedback_reports for insert
  to authenticated
  with check (
    app.is_member_of(tenant_id)
    and user_id = auth.uid()
  );

-- =============================================================================
-- Bucket "feedback-screenshots"
-- =============================================================================
-- Privado, igual que "pet-photos" (pet_photos_bucket.sql): cada lectura pasa por
-- las políticas de abajo. Mismos 5 MB y tipos de imagen que las fotos de mascota.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feedback-screenshots',
  'feedback-screenshots',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
);

-- Ruta: "{tenant_id}/{report_id}.{ext}" — el primer segmento es el tenant_id,
-- como en el resto de los buckets. Subir una captura exige ser miembro Y que el
-- negocio pueda escribir: el trigger de la tabla no cubre Storage (CLAUDE.md
-- §6.8), así que se repite aquí para que un negocio en solo lectura no deje
-- archivos huérfanos.
create policy feedback_screenshots_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'feedback-screenshots'
    and app.is_member_of((storage.foldername(name))[1]::uuid)
    and app.tenant_access_level((storage.foldername(name))[1]::uuid) in ('full', 'grace')
  );

-- Leer la captura: solo superadmins (para verla en su panel). Los miembros del
-- negocio no tienen política de SELECT, igual que en la tabla.
create policy feedback_screenshots_select on storage.objects for select
  to authenticated
  using (
    bucket_id = 'feedback-screenshots'
    and app.is_platform_admin()
  );

-- =============================================================================
-- platform_list_feedback()
-- =============================================================================
-- Reportes de todos los negocios, del más reciente al más antiguo, con quién y
-- desde qué empresa lo envió. LEFT JOIN al perfil: si el perfil no existe, el
-- reporte debe verse igual.
create function platform_list_feedback()
returns table (
  id uuid,
  tenant_id uuid,
  tenant_name text,
  user_id uuid,
  user_name text,
  user_email text,
  message text,
  screenshot_path text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if not app.is_platform_admin() then
    raise exception 'No tienes permiso para administrar la plataforma.' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    f.id,
    f.tenant_id,
    t.name,
    f.user_id,
    p.full_name,
    u.email::text, -- auth.users.email es varchar; se unifica a text
    f.message,
    f.screenshot_path,
    f.created_at
  from feedback_reports f
  join tenants t on t.id = f.tenant_id
  left join profiles p on p.id = f.user_id
  left join auth.users u on u.id = f.user_id
  where f.deleted_at is null
  order by f.created_at desc;
end;
$$;

comment on function platform_list_feedback() is
  'Superadmin: reportes de errores y sugerencias de todos los negocios. Revalida is_platform_admin().';

revoke execute on function platform_list_feedback() from public, anon;
grant execute on function platform_list_feedback() to authenticated;
