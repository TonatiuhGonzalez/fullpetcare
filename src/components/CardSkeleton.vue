<script setup lang="ts">
// Silueta de tarjetas mientras cargan (PLAN.md D22): una tarjeta con borde fino (igual
// que las reales) con un título y unas líneas grises. `count` pone varias en rejilla
// (tableros como Inicio o Reportes); `lines` ajusta cuánto contenido aparenta tener.
// Combínala con `useDelayedLoading` para que una respuesta rápida no la haga parpadear.
withDefaults(
  defineProps<{
    count?: number
    lines?: number
  }>(),
  { count: 1, lines: 2 },
)
</script>

<template>
  <div class="card-skeleton" role="status" aria-busy="true" aria-label="Cargando datos">
    <v-card v-for="n in count" :key="n" class="pa-4">
      <v-skeleton-loader type="heading" class="card-skeleton__title" />
      <v-skeleton-loader v-for="l in lines" :key="l" type="text" />
    </v-card>
  </div>
</template>

<style scoped lang="scss">
.card-skeleton {
  display: grid;
  // Las tarjetas se acomodan solas: una columna en móvil, varias en pantalla ancha.
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
  gap: 16px;

  :deep(.v-skeleton-loader) {
    background: transparent;
  }
}

.card-skeleton__title {
  max-width: 60%;
}
</style>
