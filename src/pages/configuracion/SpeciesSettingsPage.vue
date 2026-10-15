<script setup lang="ts">
// Catálogo de especies y razas (fase 27, PLAN.md D30). Pantalla vacía de la oleada 0: la
// ruta, el menú y el permiso ya existen para que la rama de la fase 27 solo llene esta
// página sin tocar el router ni el marco de Configuración.
import EmptyState from '@/components/EmptyState.vue'
import PageHeader from '@/components/PageHeader.vue'
</script>

<template>
  <div>
    <PageHeader
      title="Especies y razas"
      subtitle="Los grupos, especies y razas que se ofrecen al registrar una mascota."
    />
    <EmptyState
      illustration="customers"
      title="Muy pronto"
      message="Aquí se administrará el catálogo de especies y razas."
    />
  </div>
</template>
