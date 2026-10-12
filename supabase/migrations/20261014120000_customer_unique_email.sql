-- Correcciones 1, tarea C1.3 (PLAN.md D26 punto 3): el correo de un cliente es
-- único por negocio AL GUARDAR.
--
-- =============================================================================
-- Por qué un trigger y no un índice único
-- =============================================================================
-- Lo natural sería `create unique index ... (tenant_id, lower(email)) where
-- deleted_at is null`. No sirve aquí por dos razones:
--   1. Crear el índice FALLARÍA si hoy ya existen dos clientes con el mismo
--      correo en algún negocio (la migración no se aplicaría).
--   2. Un índice único bloquea CUALQUIER escritura de esa fila, y se pidió
--      que un cliente cuyo correo ya está duplicado pueda seguir editándose
--      (teléfono, notas...). Un índice no puede decir "solo si el correo
--      cambia".
-- El trigger sí: compara el correo nuevo contra el viejo y solo entonces busca
-- duplicados. Los duplicados que ya existen no se tocan.
--
-- Costo aceptado: es una regla nuestra, no una garantía del motor. Por eso
-- toma un candado (ver abajo) para que dos altas al mismo tiempo no pasen
-- las dos.
--
-- =============================================================================
-- Reglas
-- =============================================================================
--   * Se compara sin distinguir mayúsculas ni espacios en los extremos:
--     lower(btrim(email)).
--   * Solo choca contra clientes NO eliminados del MISMO negocio. Un cliente
--     eliminado libera su correo; otro negocio puede usar el mismo correo.
--   * Un correo nulo o vacío nunca choca (muchos clientes no dan correo).
--   * En UPDATE solo se revisa si el correo cambió.
--   * Error 23505 (unique_violation) con hint 'customer_email_taken', para que
--     el service lo reconozca sin depender del texto del mensaje.
--
-- =============================================================================
-- El candado
-- =============================================================================
-- Sin candado, dos personas que dan de alta "ana@x.mx" en el mismo instante
-- harían cada una su búsqueda ("no hay nadie"), y las dos insertarían.
-- pg_advisory_xact_lock(llave) hace que la segunda transacción ESPERE a que la
-- primera termine; al reanudar, su búsqueda ya ve al cliente recién creado y
-- falla. La llave se arma con (negocio, correo normalizado), así que solo se
-- esperan entre sí las altas del mismo correo en el mismo negocio. El candado
-- se suelta solo al terminar la transacción (xact).

create function app.prevent_duplicate_customer_email()
returns trigger
language plpgsql
-- SECURITY DEFINER para que la búsqueda vea a TODOS los clientes del negocio
-- sin depender de las políticas del usuario que guarda (la política de SELECT
-- de customers deja ver a cualquier miembro, pero así la regla no depende de
-- ella). El mensaje no dice QUIÉN tiene el correo, así que no revela datos.
security definer
set search_path = public, extensions
as $$
declare
  v_email text;
begin
  -- Un cliente que se está eliminando no compite por el correo.
  if new.deleted_at is not null then
    return new;
  end if;

  -- Solo importa si el correo es nuevo o cambió. Así un cliente con correo ya
  -- duplicado sigue pudiendo editarse en lo demás.
  if tg_op = 'UPDATE' and new.email is not distinct from old.email then
    return new;
  end if;

  v_email := lower(btrim(new.email));
  if v_email is null or v_email = '' then
    return new;
  end if;

  -- Candado por (negocio, correo normalizado). hashtextextended devuelve un
  -- bigint, que es lo que pide pg_advisory_xact_lock.
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || ':' || v_email, 0));

  if exists (
    select 1
    from customers c
    where c.tenant_id = new.tenant_id
      and c.id <> new.id
      and c.deleted_at is null
      and lower(btrim(c.email)) = v_email
  ) then
    raise exception 'Este correo ya está registrado.'
      using errcode = '23505', hint = 'customer_email_taken';
  end if;

  return new;
end;
$$;

comment on function app.prevent_duplicate_customer_email() is
  'Trigger BEFORE INSERT OR UPDATE OF email en customers: rechaza (23505, hint customer_email_taken) un correo ya usado por otro cliente no eliminado del mismo negocio, sin distinguir mayúsculas ni espacios, y solo si el correo cambia. Toma un candado por (negocio, correo).';

revoke execute on function app.prevent_duplicate_customer_email() from public, anon, authenticated;

-- BEFORE INSERT OR UPDATE OF email: en UPDATE solo se dispara si la columna
-- email aparece en el SET (y aun así la función compara viejo contra nuevo).
create trigger customers_prevent_duplicate_email
  before insert or update of email on customers
  for each row execute function app.prevent_duplicate_customer_email();

-- Índice para que la búsqueda de duplicados no sea un barrido de la tabla.
-- NO es único (ya hay duplicados posibles, ver arriba). Empieza por tenant_id
-- como todo índice del proyecto (CLAUDE.md §6).
create index customers_tenant_email_norm_idx
  on customers (tenant_id, lower(btrim(email)))
  where deleted_at is null and email is not null;
