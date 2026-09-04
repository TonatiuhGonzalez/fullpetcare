-- Bitácora de auditoría (CLAUDE.md §8.6, tabla en §6.6): quién cambió
-- qué, en qué tabla, cuándo, y qué valores tenía la fila antes/después.
-- Esta migración solo deja lista la TABLA y el MECANISMO (la función
-- app.log_change()) — todavía no hay ninguna tabla sensible que auditar.
-- A partir de la migración de expediente clínico (fase 4) y otras tablas
-- sensibles (ventas, pagos, memberships, share_links), cada una se
-- engancha con:
--
--   create trigger <tabla>_audit
--     after insert or update or delete on <tabla>
--     for each row execute function app.log_change();
--
-- ===========================================================================
-- Qué es un trigger, para quien nunca escribió uno
-- ===========================================================================
--
-- Un trigger es una función que Postgres ejecuta SOLO POR SÍ MISMO cada
-- vez que pasa algo en una tabla (aquí: un INSERT, UPDATE o DELETE) — a
-- diferencia de una función normal, nadie la "llama"; Postgres la dispara.
-- Dos decisiones al declarar uno:
--
-- - CUÁNDO dispara: "AFTER" (después de que el cambio ya se guardó,
--   usado aquí — la auditoría no necesita bloquear ni modificar el
--   cambio, solo registrarlo) vs "BEFORE" (antes de guardar, se usa
--   cuando el trigger necesita poder rechazar o modificar la fila —
--   así funciona app.prevent_hard_delete() en la próxima migración).
-- - CON QUÉ GRANULARIDAD: "FOR EACH ROW" (una ejecución por cada fila
--   afectada — si un UPDATE cambia 5 filas, el trigger corre 5 veces)
--   vs "FOR EACH STATEMENT" (una sola vez por la sentencia completa,
--   sin acceso a los datos de cada fila). La auditoría necesita el
--   detalle de cada fila, así que es FOR EACH ROW.
--
-- Por qué la auditoría vive en un trigger y no en el código de la app
-- (en services/records.ts, por ejemplo): un trigger corre SIEMPRE que la
-- fila cambia, sin importar de dónde vino el cambio — el frontend, un
-- script de administración, o alguien editando a mano desde el Table
-- Editor de Supabase. Si la auditoría dependiera de que cada función de
-- services/ se acuerde de registrarla, cualquier camino que no pase por
-- ahí (y en un demo, con scripts y el Table Editor, hay varios) quedaría
-- sin registrar. Puesto en la base, es imposible de evadir.

-- 'action' usa los mismos tres valores que Postgres ya expone dentro de
-- un trigger vía la variable especial TG_OP ('INSERT'/'UPDATE'/'DELETE')
-- — así la función de abajo puede convertir uno directo al otro con un
-- simple cast, sin tener que traducir nombres.
create type audit_action as enum ('INSERT', 'UPDATE', 'DELETE');

-- audit_log es la única tabla de negocio que NO lleva updated_at ni
-- deleted_at (CLAUDE.md §6 dice "sin excepción", y esta es la excepción
-- deliberada): una fila de auditoría es un hecho que ya pasó — no tiene
-- sentido que alguien la "edite" o la "borre suavemente" después. Que la
-- tabla ni siquiera tenga esas columnas es parte de cómo se garantiza
-- que sea inmutable, además de que más abajo no se le da ninguna
-- política de UPDATE ni DELETE.
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  table_name text not null,
  record_id uuid not null,
  action audit_action not null,
  -- Sin "not null": un cambio disparado por un proceso sin sesión de
  -- usuario (un script con service_role, por ejemplo) no tiene un
  -- auth.uid() que registrar, y aun así se quiere guardar el hecho.
  actor_user_id uuid references auth.users(id),
  changed_at timestamptz not null default now(),
  -- La fila ANTES del cambio (null en un INSERT, que no tiene "antes").
  old_data jsonb,
  -- La fila DESPUÉS del cambio (null en un DELETE, que no tiene "después").
  new_data jsonb
);

-- Consultas típicas: "historial de este registro" (tenant_id + table_name
-- + record_id) e "historial reciente de este tenant" (tenant_id +
-- changed_at). Ambos índices empiezan por tenant_id (CLAUDE.md §6).
create index audit_log_tenant_table_record_idx
  on audit_log (tenant_id, table_name, record_id);

create index audit_log_tenant_changed_at_idx
  on audit_log (tenant_id, changed_at desc);

alter table audit_log enable row level security;
alter table audit_log force row level security;

-- Solo el dueño del negocio puede LEER la bitácora — es información
-- sensible (incluye, entre otras cosas, el contenido completo de antes/
-- después de cada cambio en el expediente clínico de una mascota).
create policy audit_log_select on audit_log for select
  to authenticated
  using (app.is_member_of(tenant_id) and app.role_in(tenant_id) = 'owner');

-- A propósito, audit_log NO tiene política de INSERT (ni de UPDATE ni de
-- DELETE, que ninguna tabla de negocio tiene — CLAUDE.md §7.3). Sin una
-- política de INSERT, ni siquiera un usuario autenticado normal puede
-- escribir ahí directo — la ÚNICA forma de que aparezca una fila nueva es
-- a través de app.log_change(), que la escribe con permisos de
-- SECURITY DEFINER (ver más abajo). Así nadie puede forjar una entrada
-- de auditoría a mano.

-- ===========================================================================
-- app.log_change(): la función de trigger genérica
-- ===========================================================================
--
-- Es UNA sola función que sirve para cualquier tabla — no hace falta
-- escribir una versión distinta por cada tabla auditada. Postgres le pasa
-- automáticamente, dentro del trigger, variables especiales:
--   - OLD / NEW: la fila completa antes / después del cambio.
--   - TG_OP: la operación que disparó el trigger ('INSERT'/'UPDATE'/'DELETE').
--   - TG_TABLE_NAME: el nombre de la tabla que disparó el trigger.
--
-- SECURITY DEFINER aquí no es opcional, y por una razón distinta a la de
-- app.is_member_of() (rls_helpers.sql): ahí evitaba una recursión
-- infinita; aquí es lo que le da permiso de escribir en audit_log pese a
-- que ninguna política se lo permite a un usuario normal. La función
-- corre con los permisos de quien es DUEÑO de la función (el rol que
-- corrió esta migración), así que su INSERT sí pasa sin importar qué rol
-- disparó el cambio original. Ojo: SECURITY DEFINER cambia CON QUÉ
-- PERMISOS corre la función, no qué sesión está activa — auth.uid()
-- adentro sigue siendo el usuario real que hizo el cambio.
create function app.log_change()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid;
  v_record_id uuid;
begin
  -- En un DELETE, NEW no existe (es null); en un INSERT, OLD no existe.
  -- coalesce() toma el primero que sí tenga valor.
  v_tenant_id := coalesce(new.tenant_id, old.tenant_id);
  v_record_id := coalesce(new.id, old.id);

  insert into audit_log (tenant_id, table_name, record_id, action, actor_user_id, old_data, new_data)
  values (
    v_tenant_id,
    tg_table_name,
    v_record_id,
    tg_op::audit_action,
    auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );

  -- El valor de retorno de un trigger AFTER no lo usa Postgres para nada
  -- (a diferencia de un trigger BEFORE, donde sí importa: ahí el valor
  -- devuelto puede modificar la fila antes de que se guarde, o
  -- cancelar la operación devolviendo null). Null es la convención para
  -- un trigger AFTER.
  return null;
end;
$$;

comment on function app.log_change() is
  'Trigger genérico: registra en audit_log quién cambió qué fila, cuándo, y los valores antes/después. Se engancha a una tabla con: after insert or update or delete for each row execute function app.log_change().';

grant execute on function app.log_change() to anon, authenticated, service_role;
