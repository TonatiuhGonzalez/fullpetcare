-- =============================================================================
-- El veterinario también edita el catálogo de vacunas (fase 26, PLAN.md D29)
-- =============================================================================
-- Hasta hoy `vaccines` (el catálogo: nombre, especie y días de refuerzo) solo lo
-- escribía el dueño (vaccines.sql). Quien sabe qué vacunas se aplican en la clínica
-- es el veterinario, así que la escritura se abre a `owner` y `vet`. Lectura sin
-- cambios: cualquier miembro activo.
--
-- Recepción y groomer siguen sin poder escribirlo: el catálogo alimenta la cartilla
-- y los recordatorios, que son acto médico.
--
-- `alter policy` reemplaza solo la condición (CLAUDE.md §8.1: una migración ya
-- mergeada no se edita, se escribe otra encima).
alter policy vaccines_insert on vaccines
  with check (
    app.is_member_of(tenant_id)
    and app.role_in(tenant_id) in ('owner', 'vet')
  );

alter policy vaccines_update on vaccines
  using (
    app.is_member_of(tenant_id)
    and app.role_in(tenant_id) in ('owner', 'vet')
  )
  with check (
    app.is_member_of(tenant_id)
    and app.role_in(tenant_id) in ('owner', 'vet')
  );

-- Bitácora (§8.6): ahora que lo escribe más de una persona, queda registrado quién
-- agregó, cambió u ocultó una vacuna y qué decía antes. El catálogo no es expediente,
-- pero un cambio aquí cambia los recordatorios de todas las cartillas.
create trigger vaccines_audit
  after insert or update or delete on vaccines
  for each row execute function app.log_change();
