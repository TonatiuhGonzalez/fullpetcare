-- Fase 11, tarea 11.13 (HMH Four #2042): una vacuna descuenta su pieza.
--
-- Al aplicar una vacuna se elige el producto; la pantalla registra un insumo de la
-- consulta (add_appointment_product, 1 pieza) y la vacunación apunta a esa línea.
-- Se liga a la LÍNEA y no al producto suelto porque la línea ya es el vínculo con
-- el movimiento de stock: de la vacunación se llega a lo que se descontó.
-- El número de lote sigue siendo texto a mano (lotes y caducidades siguen fuera
-- de alcance, CLAUDE.md §1).

-- Nullable y aditiva: las vacunas ya registradas (y las capturadas sin cita) no la traen.
alter table vaccinations add column appointment_product_id uuid references appointment_products(id);

-- La línea debe ser de la misma cita y del mismo negocio que la vacunación. Sin
-- esto se podría colgar una vacuna de una pieza descontada en otra consulta.
create function app.check_vaccination_product()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.appointment_product_id is null then
    return new;
  end if;

  if not exists (
    select 1 from appointment_products ap
     where ap.id = new.appointment_product_id
       and ap.tenant_id = new.tenant_id
       and ap.appointment_id is not distinct from new.appointment_id
       and ap.deleted_at is null
  ) then
    raise exception 'El producto de la vacuna no corresponde a esta cita.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger vaccinations_check_product
  before insert or update of appointment_product_id, appointment_id on vaccinations
  for each row execute function app.check_vaccination_product();

revoke execute on function app.check_vaccination_product() from public, anon, authenticated;

-- Una pieza que corresponde a una vacuna ya registrada no se quita desde los
-- insumos: la vacunación es expediente (no se borra) y quedaría apuntando a una
-- pieza devuelta al inventario. Mismo cuerpo que 20261003130000, con esa guarda.
create or replace function remove_appointment_product(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_line appointment_products;
  v_appointment appointments;
  v_consumed integer;
begin
  select * into v_line from appointment_products where id = p_line_id and deleted_at is null;
  if not found then
    raise exception 'La línea no existe.' using errcode = 'no_data_found';
  end if;

  v_appointment := app.appointment_for_consumption(v_line.appointment_id);

  if exists (select 1 from vaccinations where appointment_product_id = p_line_id) then
    raise exception 'Esta pieza corresponde a una vacuna ya registrada.' using errcode = 'check_violation';
  end if;

  update appointment_products set deleted_at = now() where id = p_line_id;

  select -coalesce(sum(quantity), 0)::integer into v_consumed
    from stock_movements
   where appointment_product_id = p_line_id;

  if v_consumed > 0 then
    insert into stock_movements (
      tenant_id, branch_id, product_id, movement_type, quantity, appointment_product_id, created_by
    )
    values (
      v_line.tenant_id, v_appointment.branch_id, v_line.product_id, 'consumption_reversal',
      v_consumed, p_line_id, auth.uid()
    );
  end if;
end;
$$;
