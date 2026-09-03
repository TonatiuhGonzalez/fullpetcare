-- Extensiones y esquema base que usan las migraciones siguientes.
-- No crea ninguna tabla de negocio todavía.

-- pgcrypto da funciones criptográficas: gen_random_uuid() (ids de las
-- tablas de negocio) y digest() (hash SHA-256 de los tokens de la vista
-- pública en la fase 7). Postgres 13+ ya trae gen_random_uuid() en el
-- núcleo, pero se habilita pgcrypto de una vez para tener digest()
-- disponible sin otra migración cuando llegue esa fase.
create extension if not exists pgcrypto with schema extensions;

-- Esquema "app": aquí viven las funciones auxiliares de RLS
-- (app.is_member_of, app.role_in, ...) y los triggers genéricos
-- (app.set_updated_at, más adelante app.log_change). Separado de
-- "public" a propósito: "public" es donde viven las TABLAS de negocio
-- (lo que PostgREST expone como API), "app" es infraestructura interna
-- que ninguna tabla necesita "ver" directamente. Con esto, de un vistazo
-- al esquema se distingue "esto es una tabla" de "esto es un mecanismo
-- del sistema".
create schema if not exists app;

-- Los roles con los que la API habla (anon, authenticated) y el rol que
-- usan las Edge Functions (service_role) necesitan poder "entrar" al
-- esquema para ejecutar sus funciones. "usage" no da acceso a los datos
-- de ninguna tabla, solo permite resolver el nombre "app.algo(...)" — el
-- acceso real a los datos lo sigue controlando cada política RLS.
grant usage on schema app to anon, authenticated, service_role;

-- Trigger genérico para mantener "updated_at" al día sin repetir la
-- lógica en cada tabla. Cada tabla de negocio le agrega su propio
-- "create trigger ... before update ... execute function
-- app.set_updated_at()" en la migración donde se crea esa tabla.
create or replace function app.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function app.set_updated_at() is
  'Trigger BEFORE UPDATE genérico: fija updated_at = now() en cada fila modificada.';
