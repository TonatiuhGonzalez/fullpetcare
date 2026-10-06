-- Resumen de un turno de caja para la pantalla (fase 12, tarea 12.10/12.11 /
-- HMH Four #2077).
--
-- `app.cash_session_summary()` (cash_register.sql) calcula lo cobrado en un turno
-- pero es interna: ningún usuario puede ejecutarla. Esta función pública la
-- envuelve y revalida membresía, permiso y sucursal (§7.3.4), porque la pantalla
-- de Caja necesita mostrar "cobrado en el turno" mientras la caja sigue abierta.
--
-- Hasta cuándo se cuenta: una caja ABIERTA, hasta este instante; una CERRADA,
-- hasta su cierre (la misma ventana que usó close_cash_session al calcular el
-- esperado, así que el resumen de un corte pasado nunca cambia).
--
-- Nota sobre el "conteo a ciegas": la pantalla no muestra el esperado hasta que
-- se captura el conteo, para que contar sea honesto. Eso es solo de la
-- interfaz: esta función sí lo devuelve, porque quien tiene permiso de caja ya
-- puede calcularlo con lo que ve (fondo + efectivo + movimientos).
create function cash_session_overview(p_session_id uuid)
returns table (
  cash_cents bigint,
  card_cents bigint,
  transfer_cents bigint,
  openpay_cents bigint,
  change_given_cents bigint,
  income_cents bigint,
  outflow_cents bigint,
  expected_cents bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_session cash_sessions;
begin
  select * into v_session from cash_sessions where id = p_session_id and deleted_at is null;
  -- Inexistente, de otro negocio o sin acceso: el mismo mensaje, sin revelar cuál.
  if not found
     or not app.is_member_of(v_session.tenant_id)
     or not app.can_access_branch(v_session.branch_id)
     or not app.has_permission(v_session.tenant_id, 'cash_register', 'view') then
    raise exception 'No tienes permiso para ver esta caja.' using errcode = '42501';
  end if;

  return query
  select * from app.cash_session_summary(p_session_id, coalesce(v_session.closed_at, clock_timestamp()));
end;
$$;

revoke execute on function cash_session_overview(uuid) from public, anon;
grant execute on function cash_session_overview(uuid) to authenticated;

comment on function cash_session_overview(uuid) is
  'Cobrado en un turno de caja por método, cambio, ingresos, salidas y efectivo esperado. Abierta: hasta ahora; cerrada: hasta su cierre. Exige permiso cash_register/ver y acceso a la sucursal.';
