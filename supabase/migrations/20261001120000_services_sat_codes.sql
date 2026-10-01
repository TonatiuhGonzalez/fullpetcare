-- Claves del SAT por servicio (fase 11, tarea 11.2 / HMH Four #2037).
--
-- Cada concepto de un CFDI 4.0 lleva dos claves del catálogo del SAT:
--   * ClaveProdServ (c_ClaveProdServ): QUÉ es — 8 dígitos.
--   * ClaveUnidad   (c_ClaveUnidad):   en qué se mide — 2 o 3 caracteres
--     alfanuméricos (E48 = "Unidad de servicio", H87 = "Pieza", KGM = "Kilogramo").
--
-- Migración aditiva (CLAUDE.md §8.1): solo agrega columnas. No cambia nada de
-- lo que ya existe, así que ningún test ni pantalla actual se entera.
--
-- Por qué NOT NULL + DEFAULT: el `default` rellena de una vez los servicios que
-- ya existen (Postgres lo aplica a las filas viejas al agregar la columna) y a
-- los que se inserten sin la clave (la semilla, los tests viejos). El `not null`
-- hace que un servicio ya no pueda quedar "sin clave" después (la factura no
-- tendría de dónde sacarla).
--
-- Los valores por defecto son SOLO una sugerencia tomada del catálogo del SAT:
-- el sistema no decide qué clave le corresponde a cada negocio. Cada dueño puede
-- cambiarla en el formulario del servicio, con ayuda de su contador.
--   70122000 = "Salud animal" (segmento 70, grupo 7012, servicios de animales vivos).
--   E48      = "Unidad de servicio".
-- PENDIENTE antes de abrir la facturación a negocios reales: que un contador
-- revise la clave de producto por defecto, sobre todo la de estética.

alter table services
  add column sat_product_code text not null default '70122000',
  add column sat_unit_code text not null default 'E48';

-- El `check` es la última línea de defensa: aunque alguien llame a la API
-- directo, la base rechaza una clave con formato imposible. Valida la FORMA,
-- no que la clave exista en el catálogo (mismo criterio que RFC y CURP en
-- lib/validation.ts).
alter table services
  add constraint services_sat_product_code_format
    check (sat_product_code ~ '^[0-9]{8}$'),
  add constraint services_sat_unit_code_format
    check (sat_unit_code ~ '^[A-Z0-9]{2,3}$');
