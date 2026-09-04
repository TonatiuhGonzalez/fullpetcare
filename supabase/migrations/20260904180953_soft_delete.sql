-- app.prevent_hard_delete(): cinturón además del tirante para el
-- expediente clínico (CLAUDE.md §8.5). Las tablas de expediente
-- (grooming_records, medical_records, vaccinations, que llegan en fases
-- posteriores) nunca tienen política de DELETE — sin política, Postgres
-- ya rechaza un DELETE de cualquier rol autenticado normal (CLAUDE.md
-- §7.3, regla 2). Pero eso NO cubre a `service_role`: ese rol tiene el
-- atributo BYPASSRLS, así que las políticas de RLS (incluida "ninguna
-- política de DELETE") no lo detienen a él. Un script de administración,
-- o alguien con la service_role key en la mano, sí podría borrar un
-- expediente directo si solo se confiara en RLS.
--
-- Por eso esto se refuerza con un trigger: un trigger SIEMPRE se ejecuta,
-- sin importar el rol que disparó la sentencia — RLS y los triggers son
-- dos mecanismos independientes, "bypass RLS" no significa "bypass
-- triggers". Un expediente clínico es, para efectos de este proyecto, un
-- documento legal: se corrige con una nueva versión del registro (que
-- queda en la bitácora vía app.log_change()), nunca se hace desaparecer.
--
-- BEFORE DELETE (a diferencia de app.log_change(), que es AFTER): aquí sí
-- importa que dispare ANTES de que Postgres borre la fila — el propósito
-- es CANCELAR la operación, y eso solo se puede hacer desde un trigger
-- BEFORE (uno AFTER ya no puede "deshacer" el borrado; solo podría
-- forzar un rollback de toda la transacción levantando la excepción más
-- tarde, con más trabajo ya hecho de más).
create function app.prevent_hard_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'No se puede borrar directamente una fila de "%": es un expediente y no se elimina, se corrige con una nueva versión (CLAUDE.md §8.5).',
    tg_table_name
    using errcode = 'insufficient_privilege';
end;
$$;

comment on function app.prevent_hard_delete() is
  'Trigger BEFORE DELETE: cancela cualquier intento de borrado físico, incluso desde service_role. Se engancha a una tabla con: before delete for each row execute function app.prevent_hard_delete().';
