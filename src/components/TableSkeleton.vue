<script setup lang="ts">
// Silueta de una tabla mientras llega su primera carga (PLAN.md D22): un encabezado y
// unas filas grises con el mismo ritmo que la tabla real, para que al llegar los datos
// nada se mueva. Úsala SOLO en la primera carga; al recargar, la tabla conserva sus
// filas y lleva únicamente la barra fina. Para no parpadear, combínala con
// `useDelayedLoading`.
withDefaults(
  defineProps<{
    rows?: number
    columns?: number
  }>(),
  { rows: 5, columns: 4 },
)
</script>

<template>
  <div
    class="table-skeleton"
    role="status"
    aria-busy="true"
    aria-label="Cargando datos"
    :style="{ '--skeleton-columns': columns }"
  >
    <div class="table-skeleton__row table-skeleton__row--head">
      <v-skeleton-loader v-for="c in columns" :key="c" type="text" />
    </div>
    <div v-for="r in rows" :key="r" class="table-skeleton__row">
      <v-skeleton-loader v-for="c in columns" :key="c" type="text" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.table-skeleton {
  overflow: hidden;
}

.table-skeleton__row {
  display: grid;
  grid-template-columns: repeat(var(--skeleton-columns), minmax(0, 1fr));
  gap: 16px;
  align-items: center;
  min-height: 52px;
  padding: 0 16px;
  border-bottom: thin solid rgba(var(--v-border-color), var(--v-border-opacity));

  // Cada hueso ocupa su celda completa y no hereda el margen de v-skeleton-loader.
  :deep(.v-skeleton-loader) {
    background: transparent;
  }
}

.table-skeleton__row--head {
  min-height: 44px;
}
</style>
