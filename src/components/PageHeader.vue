<script setup lang="ts">
// Encabezado estándar de pantalla (PLAN.md D20): título, subtítulo opcional y, a la
// derecha, las acciones principales (slot `actions`). Así todas las pantallas ponen el
// título y el botón principal en el mismo sitio y con el mismo tamaño. En pantallas
// angostas las acciones bajan debajo del título en vez de apretarlo.
defineProps<{
  title: string
  subtitle?: string
}>()
</script>

<template>
  <header class="page-header">
    <div class="page-header__text">
      <h1 class="text-h5 font-weight-bold">{{ title }}</h1>
      <p v-if="subtitle" class="text-body-2 text-medium-emphasis mt-1">{{ subtitle }}</p>
    </div>
    <div v-if="$slots.actions" class="page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped lang="scss">
.page-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  margin-bottom: 16px;

  &__text {
    flex: 1 1 auto;
    min-width: 0;
  }

  &__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
}
</style>
