-- Eliminar cliente y eliminar mascota desde la tabla de Clientes (fase 14,
-- tarea 14.2 / PLAN.md D19).
--
-- Qué hace cada una (todo es BORRADO SUAVE, CLAUDE.md §8.5: se llena
-- `deleted_at`, nunca se hace DELETE):
--   delete_pet(p_pet_id)           -> oculta la mascota y sus citas PROGRAMADAS.
--   delete_customer(p_customer_id) -> oculta al cliente, a sus mascotas y las
--                                     citas PROGRAMADAS del cliente y de ellas.
--
-- Qué NO se toca a propósito:
--   * Citas en curso, completadas, canceladas o que no asistieron: se quedan
--     como historia (decisión del usuario, 2026-10-08).
--   * Ventas y pagos: una venta cobrada no cambia nunca.
--   * El expediente (grooming_records, medical_records, vaccinations): no se
--     borra jamás (§8.5); sigue ligado a la cita y a la mascota aunque estas
--     queden ocultas.
--
-- Por qué una función en la base y no varias llamadas desde el navegador:
-- una función corre en UNA transacción. Si algo falla a la mitad, no queda un
-- cliente oculto con sus mascotas todavía visibles. Desde el frontend serían
-- tres UPDATE sueltos y cualquiera podía fallar solo.
--
-- Por qué SECURITY DEFINER: la política de UPDATE de `appointments` exige
-- poder entrar a la sucursal de cada cita, y un cliente puede tener citas en
-- sucursales a las que quien lo elimina no entra. El borrado de un cliente es
-- de todo el negocio, así que la función salta RLS... y por eso REVALIDA ella
-- misma membresía y rol (§7.3, regla 4) antes de tocar nada.
--
-- Migración aditiva (§8.1): solo funciones nuevas, ninguna tabla cambia.

create or replace function delete_pet(p_pet_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pet pets;
begin
  select * into v_pet from pets where id = p_pet_id and deleted_at is null;
  if not found then
    raise exception 'La mascota no existe.' using errcode = 'no_data_found';
  end if;

  if not app.is_member_of(v_pet.tenant_id) then
    raise exception 'No perteneces a este negocio.' using errcode = 'insufficient_privilege';
  end if;

  if app.role_in(v_pet.tenant_id) not in ('owner', 'receptionist') then
    raise exception 'No tienes permiso para eliminar mascotas.' using errcode = 'insufficient_privilege';
  end if;

  update appointments
     set deleted_at = now()
   where pet_id = p_pet_id
     and tenant_id = v_pet.tenant_id
     and status = 'scheduled'
     and deleted_at is null;

  update pets set deleted_at = now() where id = p_pet_id;
end;
$$;

create or replace function delete_customer(p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_customer customers;
begin
  select * into v_customer from customers where id = p_customer_id and deleted_at is null;
  if not found then
    raise exception 'El cliente no existe.' using errcode = 'no_data_found';
  end if;

  if not app.is_member_of(v_customer.tenant_id) then
    raise exception 'No perteneces a este negocio.' using errcode = 'insufficient_privilege';
  end if;

  if app.role_in(v_customer.tenant_id) not in ('owner', 'receptionist') then
    raise exception 'No tienes permiso para eliminar clientes.' using errcode = 'insufficient_privilege';
  end if;

  -- Citas programadas del cliente. Cubre también las de sus mascotas, porque
  -- toda cita lleva customer_id además de pet_id.
  update appointments
     set deleted_at = now()
   where tenant_id = v_customer.tenant_id
     and status = 'scheduled'
     and deleted_at is null
     and (customer_id = p_customer_id
          or pet_id in (select id from pets where customer_id = p_customer_id));

  update pets
     set deleted_at = now()
   where customer_id = p_customer_id
     and tenant_id = v_customer.tenant_id
     and deleted_at is null;

  update customers set deleted_at = now() where id = p_customer_id;
end;
$$;

-- Solo usuarios con sesión: sin esto, PUBLIC (y por tanto anon) puede ejecutarlas.
revoke execute on function delete_pet(uuid) from public, anon;
grant execute on function delete_pet(uuid) to authenticated;
revoke execute on function delete_customer(uuid) from public, anon;
grant execute on function delete_customer(uuid) to authenticated;
