-- Un empleado desactivado sigue mostrando su nombre en la pantalla de Empleados.
--
-- Problema: `profiles_select` (rls_tenancy.sql) dejaba leer el perfil de otra persona
-- solo si tenía una membresía ACTIVA (`m.is_active`). Al desactivar a un empleado, su
-- perfil dejaba de ser visible para el resto del negocio, el embed `profiles ( full_name )`
-- llegaba nulo y la pantalla mostraba "(sin nombre)".
--
-- Arreglo: se quita la condición `is_active`. Basta una membresía no eliminada. La
-- subconsulta sobre `memberships` sigue pasando por la RLS de quien consulta, así que solo
-- se ven perfiles de personas que pertenecen a un negocio al que la persona también
-- pertenece (aislamiento entre negocios intacto). Una membresía eliminada (borrado
-- suave) sigue sin exponer el perfil.
drop policy if exists profiles_select on profiles;

create policy profiles_select on profiles for select
  to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from memberships m
      where m.user_id = profiles.id
        and m.deleted_at is null
    )
  );
