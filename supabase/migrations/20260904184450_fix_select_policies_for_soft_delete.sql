-- Corrige una trampa real de Postgres RLS descubierta al escribir la
-- migración de customers (fase 2): cuando una política de SELECT filtra
-- "deleted_at is null", cualquier UPDATE que ponga deleted_at (el
-- borrado suave, CLAUDE.md §8.5) falla con "new row violates row-level
-- security policy" — Postgres exige que la fila RESULTANTE de un UPDATE
-- siga pasando la política de SELECT de la tabla, sin importar qué diga
-- el "with check" de la propia política de UPDATE. El detalle completo,
-- verificado a mano varias veces, está en el comentario de
-- customers_select (migración customers.sql).
--
-- Estas 4 tablas de tenencia (fase 1) tienen el mismo patrón, pero HOY
-- no están rotas en la práctica: ninguna tiene política de UPDATE para
-- un rol autenticado normal, solo service_role puede escribir en ellas
-- (rls_tenancy.sql), y service_role no le hace caso a RLS de todos
-- modos. Este ajuste es preventivo: para cuando una fase futura agregue
-- una pantalla de administración con UPDATE sobre alguna de estas
-- tablas, el mismo problema no vuelva a aparecer.
--
-- No se puede editar rls_tenancy.sql directamente — ya está en main
-- (CLAUDE.md §8.1: una migración mergeada no se edita, se escribe otra
-- encima). "alter policy ... using (...)" reemplaza solo la condición,
-- sin tener que borrar y recrear la política entera.
--
-- El comportamiento visible de la app no cambia con esta migración: como
-- nada hoy actualiza deleted_at en estas tablas vía un rol autenticado,
-- quitar la condición de la política no abre ninguna fila que antes
-- estuviera oculta en un flujo real.
alter policy tenants_select on tenants
  using (app.is_member_of(id));

alter policy branches_select on branches
  using (app.is_member_of(tenant_id));

alter policy memberships_select on memberships
  using (app.is_member_of(tenant_id));

alter policy membership_branches_select on membership_branches
  using (app.is_member_of(tenant_id));
