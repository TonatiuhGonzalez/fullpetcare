-- Refuerza en la base el cambio del cobro (fase 13, extensión 13H).
--
-- Hasta ahora finalize_sale() aceptaba que los pagos sumaran MÁS que el total con cualquier
-- método. Pero solo el efectivo da cambio (Caja y la pantalla de cobro ya lo asumen): una
-- tarjeta por $500 en una cuenta de $300 deja $200 que nadie puede devolver. La pantalla ya lo
-- bloquea; esto lo impone la base para que una llamada directa a la API no lo salte.
--
-- Regla: (pagado - total) no puede superar el efectivo recibido.
--
-- Migración ADITIVA (§8.1): `create or replace` conserva firma y permisos; solo agrega la
-- validación al final. La función es SECURITY DEFINER, pero solo la llaman checkout_appointment()
-- y checkout_counter_sale(), que revalidan membresía y rol (§7.3.4); a ella no puede llamarla
-- nadie directo (execute revocado en la migración que la creó, y create or replace no lo cambia).

create or replace function app.finalize_sale(
  p_sale_id uuid,
  p_tenant_id uuid,
  p_discount_cents integer,
  p_payments jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_subtotal_cents integer;
  v_tax_cents integer;
  v_total_cents integer;
  v_payments_total_cents integer := 0;
  v_cash_received_cents integer := 0;
  v_payment_elem jsonb;
  v_method payment_method;
  v_amount_cents integer;
  v_status payment_status;
  v_reference text;
  v_form_code text;
begin
  select
    coalesce(sum(line_total_cents - tax_cents), 0),
    coalesce(sum(tax_cents), 0)
  into v_subtotal_cents, v_tax_cents
  from sale_items
  where sale_id = p_sale_id and deleted_at is null;

  v_total_cents := greatest(0, v_subtotal_cents + v_tax_cents - p_discount_cents);

  update sales
  set subtotal_cents = v_subtotal_cents, tax_cents = v_tax_cents, total_cents = v_total_cents
  where id = p_sale_id;

  for v_payment_elem in select * from jsonb_array_elements(p_payments) loop
    v_method := (v_payment_elem->>'method')::payment_method;
    v_amount_cents := (v_payment_elem->>'amount_cents')::integer;

    if v_amount_cents is null or v_amount_cents <= 0 then
      raise exception 'El monto de cada pago debe ser mayor a cero.' using errcode = 'check_violation';
    end if;

    v_status := case when v_method = 'cash' then 'approved' else 'simulated_approved' end;
    v_reference := v_payment_elem->>'reference';
    if v_status = 'simulated_approved' and coalesce(v_reference, '') = '' then
      v_reference := 'SIM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    end if;

    -- Con tarjeta la persona que cobra elige crédito (04) o débito (28): no hay
    -- forma de deducirlo. Los demás métodos se derivan solos.
    if v_method = 'card' then
      v_form_code := v_payment_elem->>'payment_form_code';
      if v_form_code is null or v_form_code not in ('04', '28') then
        raise exception 'Elige si la tarjeta fue de crédito o de débito.' using errcode = 'check_violation';
      end if;
    else
      v_form_code := case v_method when 'cash' then '01' when 'transfer_spei' then '03' else null end;
    end if;

    insert into payments (tenant_id, sale_id, method, amount_cents, reference, status, paid_at, payment_form_code)
    values (p_tenant_id, p_sale_id, v_method, v_amount_cents, v_reference, v_status, now(), v_form_code);

    v_payments_total_cents := v_payments_total_cents + v_amount_cents;
    if v_method = 'cash' then
      v_cash_received_cents := v_cash_received_cents + v_amount_cents;
    end if;
  end loop;

  if v_payments_total_cents < v_total_cents then
    raise exception 'El monto pagado (%) no cubre el total de la venta (%).',
      v_payments_total_cents, v_total_cents
      using errcode = 'check_violation';
  end if;

  -- Solo el EFECTIVO da cambio: lo pagado de más no puede superar el efectivo recibido. Es la
  -- misma regla de Caja (lib/cashCount.ts#changeGiven) y de la pantalla de cobro; aquí la
  -- impone la base para que una llamada directa a la API no cobre de más a una tarjeta.
  if v_payments_total_cents - v_total_cents > v_cash_received_cents then
    raise exception 'Solo se puede pagar de más en efectivo: el excedente (%) no se puede devolver.',
      v_payments_total_cents - v_total_cents - v_cash_received_cents
      using errcode = 'check_violation';
  end if;
end;
$$;
