<script setup lang="ts">
// Silueta de una pantalla completa (PLAN.md D22): reserva el lugar del encabezado y
// de un bloque de contenido, para pantallas de detalle (cobro, atención, venta, cita)
// que hoy muestran solo un círculo. Si la pantalla tiene una forma muy propia, es
// mejor armar su silueta con `TableSkeleton` y `CardSkeleton` en su lugar.
withDefaults(defineProps<{ blocks?: number }>(), { blocks: 2 })
</script>

<template>
  <div
    class="page-skeleton"
    role="status"
    aria-busy="true"
    aria-label="Cargando pantalla"
  >
    <div class="page-skeleton__header">
      <v-skeleton-loader type="heading" class="page-skeleton__title" />
      <v-skeleton-loader type="text" class="page-skeleton__subtitle" />
    </div>
    <v-card v-for="n in blocks" :key="n" class="pa-4 mb-4">
      <v-skeleton-loader type="heading, text, text" />
    </v-card>
  </div>
</template>

<style scoped lang="scss">
.page-skeleton__header {
  margin-bottom: 16px;

  :deep(.v-skeleton-loader) {
    background: transparent;
  }
}

.page-skeleton__title {
  max-width: 280px;
}

.page-skeleton__subtitle {
  max-width: 420px;
}

.page-skeleton :deep(.v-skeleton-loader) {
  background: transparent;
}
</style>
