-- Correcciones 1, tarea C1.5 (PLAN.md D26 punto 5): búsqueda sin acentos ni
-- mayúsculas resuelta en la base.
--
-- =============================================================================
-- Qué se agrega
-- =============================================================================
--   * La extensión `unaccent` (contrib oficial de Postgres, disponible tanto
--     en el Supabase local como en el alojado): quita acentos.
--   * app.search_norm(texto): "minúsculas y sin acentos", pero SIN confundir la
--     ñ con la n. En español "año" y "ano" son palabras distintas.
--   * Tres funciones de búsqueda para el frontend (las llama por RPC):
--       search_customers(tenant, término)  -> EMPIEZA con, en nombre, apellido,
--                                             teléfono o correo
--       search_pets(tenant, término)       -> CONTIENE, en nombre, especie (en
--                                             español) o nombre del dueño
--       search_products(tenant, término)   -> CONTIENE, en nombre o código
--     Cada una conserva el criterio que ya tenía su pantalla.
--
-- =============================================================================
-- Seguridad: SECURITY INVOKER a propósito
-- =============================================================================
-- A diferencia de las RPC de escritura (SECURITY DEFINER, que saltan RLS y por
-- eso revalidan a mano), estas funciones corren con los permisos de QUIEN LLAMA:
-- las políticas RLS de customers, pets y products se aplican igual que en un
-- SELECT normal (CLAUDE.md §7.3). Por eso un groomer no ve de más ni nadie ve
-- otro negocio, aunque pase un p_tenant_id ajeno: la política lo filtra.
-- EXECUTE solo para authenticated (revocado a anon y PUBLIC).
--
-- Migración aditiva (§8.1): una extensión y funciones nuevas; ninguna tabla cambia.

-- La extensión va en el esquema `extensions`, como pgcrypto (migración
-- extensions_and_helpers.sql). Es el esquema que Supabase ya trae y que está en
-- el search_path de la API, así que funciona igual en local, staging y
-- producción sin permisos especiales. `if not exists` la hace repetible.
create extension if not exists unaccent with schema extensions;

-- =============================================================================
-- app.search_norm(): "jose", "JOSÉ" y "José" dan lo mismo; "año" sigue siendo
-- distinto de "ano".
-- =============================================================================
-- IMMUTABLE: para el mismo texto siempre devuelve lo mismo. Eso permite, si un
-- negocio crece, crear un índice sobre la expresión. La función `unaccent(texto)`
-- original es STABLE (depende de la configuración de búsqueda de texto de la
-- sesión), por eso NO sirve para índices; aquí se llama la versión con el
-- diccionario fijo (`extensions.unaccent` como regdictionary), que no depende de
-- nada de la sesión y sí se puede declarar IMMUTABLE.
-- PARALLEL SAFE: Postgres puede usarla en consultas paralelas.
-- STRICT: texto nulo -> resultado nulo, sin ejecutar el cuerpo.
-- search_path vacío y todo calificado: una función no debería depender del
-- search_path de quien la llama (si alguien creara otra `unaccent` en un
-- esquema anterior, no la usaría).
--
-- El truco de la ñ: se cambia por un carácter de control (chr(1)) ANTES de
-- quitar acentos y se restaura después, así unaccent no la convierte en n.
-- normalize(..., NFC) primero: una ñ escrita como "n" + tilde combinada
-- (NFD, p. ej. de un teclado o archivo distinto) cuenta igual que la ñ de una
-- sola pieza. Se cambian ñ y Ñ explícitamente en vez de confiar en lower() para
-- no depender de la configuración regional de la base.
create function app.search_norm(p_text text)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select replace(
    lower(
      btrim(
        extensions.unaccent(
          'extensions.unaccent'::regdictionary,
          replace(replace(normalize(p_text, NFC), 'ñ', chr(1)), 'Ñ', chr(1))
        )
      )
    ),
    chr(1),
    'ñ'
  )
$$;

comment on function app.search_norm(text) is
  'Texto en minúsculas, sin acentos y sin espacios en los extremos, conservando la ñ. IMMUTABLE (indexable). Base de las funciones search_*.';

-- Se llama desde funciones SECURITY INVOKER: quien llama necesita EXECUTE.
revoke execute on function app.search_norm(text) from public, anon;
grant execute on function app.search_norm(text) to authenticated;

-- =============================================================================
-- app.like_escape(): el término del usuario es TEXTO, no un patrón
-- =============================================================================
-- En LIKE, % y _ son comodines y \ es el carácter de escape. Si alguien busca
-- "50%" o "a_b", deben compararse literalmente; sin escapar, "%" casaría con
-- todo. Se antepone \ a los tres.
create function app.like_escape(p_text text)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select replace(replace(replace(p_text, '\', '\\'), '%', '\%'), '_', '\_')
$$;

comment on function app.like_escape(text) is
  'Escapa \, % y _ para usar un texto del usuario como literal dentro de LIKE.';

revoke execute on function app.like_escape(text) from public, anon;
grant execute on function app.like_escape(text) to authenticated;

-- =============================================================================
-- search_customers(): "EMPIEZA con" en nombre, apellido, teléfono o correo
-- =============================================================================
-- Mismo criterio que services/customers.ts `search`: no "contiene en cualquier
-- parte" (ver el comentario de customers.sql). Término vacío = todos. Solo no
-- eliminados, ordenados por apellido y nombre. Sin `deleted_at` en RLS (trampa
-- de §7.2): el filtro vive aquí, igual que en el service.
create function search_customers(p_tenant_id uuid, p_term text default '')
returns setof customers
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  v_pattern text := app.like_escape(app.search_norm(coalesce(p_term, ''))) || '%';
begin
  return query
    select c.*
    from customers c
    where c.tenant_id = p_tenant_id
      and c.deleted_at is null
      and (
        v_pattern = '%'
        or app.search_norm(c.first_name) like v_pattern
        or app.search_norm(c.last_name) like v_pattern
        or app.search_norm(c.phone) like v_pattern
        or app.search_norm(c.email) like v_pattern
      )
    order by c.last_name, c.first_name;
end;
$$;

comment on function search_customers(uuid, text) is
  'Clientes del negocio cuyo nombre, apellido, teléfono o correo EMPIEZA con el término (sin acentos ni mayúsculas). Término vacío: todos. SECURITY INVOKER: aplica RLS.';

revoke execute on function search_customers(uuid, text) from public, anon;
grant execute on function search_customers(uuid, text) to authenticated;

-- =============================================================================
-- search_pets(): "CONTIENE" en nombre, especie (en español) o dueño
-- =============================================================================
-- Mismo criterio que lib/petSearch.ts: el nombre completo del dueño es
-- "nombre apellido", y la especie se compara con su nombre en español
-- (lib/petLabels.ts: dog=Perro, cat=Gato, other=Otro), que es lo que la persona
-- ve y escribe. Orden por nombre de la mascota.
create function search_pets(p_tenant_id uuid, p_term text default '')
returns setof pets
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  v_pattern text := '%' || app.like_escape(app.search_norm(coalesce(p_term, ''))) || '%';
begin
  return query
    select p.*
    from pets p
    join customers c on c.id = p.customer_id and c.tenant_id = p.tenant_id
    where p.tenant_id = p_tenant_id
      and p.deleted_at is null
      and c.deleted_at is null
      and (
        v_pattern = '%%'
        or app.search_norm(p.name) like v_pattern
        or app.search_norm(
             case p.species
               when 'dog' then 'Perro'
               when 'cat' then 'Gato'
               else 'Otro'
             end
           ) like v_pattern
        or app.search_norm(c.first_name || ' ' || c.last_name) like v_pattern
      )
    order by p.name;
end;
$$;

comment on function search_pets(uuid, text) is
  'Mascotas del negocio cuyo nombre, especie (en español) o nombre completo del dueño CONTIENE el término (sin acentos ni mayúsculas). Término vacío: todas. SECURITY INVOKER: aplica RLS.';

revoke execute on function search_pets(uuid, text) from public, anon;
grant execute on function search_pets(uuid, text) to authenticated;

-- =============================================================================
-- search_products(): "CONTIENE" en nombre o código
-- =============================================================================
-- Mismo criterio que lib/productSearch.ts (searchProducts/filterProducts). No
-- filtra is_active: ocultar los inactivos es decisión de cada pantalla (el
-- inventario los muestra, el punto de venta no). Orden por nombre.
create function search_products(p_tenant_id uuid, p_term text default '')
returns setof products
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  v_pattern text := '%' || app.like_escape(app.search_norm(coalesce(p_term, ''))) || '%';
begin
  return query
    select pr.*
    from products pr
    where pr.tenant_id = p_tenant_id
      and pr.deleted_at is null
      and (
        v_pattern = '%%'
        or app.search_norm(pr.name) like v_pattern
        or app.search_norm(pr.sku) like v_pattern
      )
    order by pr.name;
end;
$$;

comment on function search_products(uuid, text) is
  'Productos del negocio cuyo nombre o código CONTIENE el término (sin acentos ni mayúsculas). Término vacío: todos. No filtra is_active. SECURITY INVOKER: aplica RLS.';

revoke execute on function search_products(uuid, text) from public, anon;
grant execute on function search_products(uuid, text) to authenticated;
