<script setup lang="ts">
// Catálogo de cirugías (fase 32, PLAN.md D30 punto 9). Pantalla vacía de la preparación de la
// oleada 3: la ruta, el menú y el permiso ya existen para que la rama de la fase 32 solo
// llene esta página sin tocar el router ni el marco de Configuración.
import EmptyState from '@/components/EmptyState.vue'
import PageHeader from '@/components/PageHeader.vue'
</script>

<template>
  <div>
    <PageHeader
      title="Cirugías"
      subtitle="Paquetes con los consumibles, medicamentos y honorarios de cada cirugía."
    />
    <EmptyState
      illustration="products"
      title="Muy pronto"
      message="Aquí se administrará el catálogo de cirugías."
    />
  </div>
</template>
