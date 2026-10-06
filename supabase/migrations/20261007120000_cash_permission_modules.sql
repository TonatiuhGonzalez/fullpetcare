-- Nuevos módulos de permisos: 'cash_register' y 'reports' (fase 12, tareas 12.3 /
-- HMH Four #2073). Una sola cosa a propósito: agregar los valores al enum. La
-- migración siguiente ya los USA; van separadas porque Postgres no deja usar un
-- valor de enum recién agregado en la misma transacción (mismo caso que
-- inventory_permission_module e invoicing_permission_module).
alter type permission_module add value 'cash_register';
alter type permission_module add value 'reports';
