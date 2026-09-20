-- Corrige la política de SELECT de membership_branches para la MISMA
-- trampa documentada en CLAUDE.md §7.2 y ya corregida una vez en
-- fix_select_policies_for_soft_delete.sql (fase 2): Postgres exige que la
-- fila RESULTANTE de un UPDATE siga pasando la política de SELECT de su
-- propia tabla. La política original (rls_tenancy.sql, fase 1) filtraba
-- "and deleted_at is null" porque en ese momento la tabla no tenía
-- ninguna política de UPDATE — el comentario de esa migración ya avisaba
-- "se corrige con su propio test cuando exista esa pantalla".
--
-- Esa pantalla es la de esta fase: editar los empleados incluye
-- reasignar sucursales, lo que significa dar de baja una fila de
-- membership_branches con `update ... set deleted_at = now()` (nunca un
-- DELETE de verdad, CLAUDE.md §7.3). Con el filtro de arriba todavía en
-- la política de SELECT, ese UPDATE fallaría siempre con "new row
-- violates row-level security policy" — el mismo bug, en la misma forma,
-- que ya se encontró y corrigió para customers/pets en la fase 2.
--
-- La regla de "solo mostrar las sucursales VIGENTES de un empleado" se
-- mueve a la capa de servicios (`.is('membership_branches.deleted_at',
-- null)` explícito en services/memberships.ts y services/employees.ts),
-- igual que ya hacen customers.ts/pets.ts para sus propias tablas.
drop policy membership_branches_select on membership_branches;

create policy membership_branches_select on membership_branches for select
  to authenticated
  using (app.is_member_of(tenant_id));
