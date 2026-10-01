-- Fase 11, tarea 11.10 (HMH Four #2041): el ticket también puede llevar productos.
--
-- Va en su propia migración porque Postgres no deja USAR un valor de enum en la
-- misma transacción que lo agrega. La migración siguiente ya lo usa.
-- Es aditiva (CLAUDE.md §6.5): no toca ni una fila de las ventas existentes.
alter type sale_item_type add value if not exists 'product';
