-- Nuevo módulo de permisos: 'invoicing' (fase 11, tarea 11.17 / HMH Four #2045).
-- Una sola cosa a propósito: agregar el valor al enum. La migración siguiente
-- ya lo USA; van separadas porque Postgres no deja usar un valor de enum
-- recién agregado en la misma transacción (mismo caso que inventory_permission_module).
alter type permission_module add value 'invoicing';
