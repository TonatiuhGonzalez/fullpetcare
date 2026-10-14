<script setup lang="ts">
// Catálogo de proveedores (fase 29B, PLAN.md D30). Pantalla vacía de la oleada 0: la ruta,
// el menú y el permiso (`inventory`) ya existen para que la rama de la fase 29B solo llene
// esta página sin tocar el router ni el layout.
import EmptyState from '@/components/EmptyState.vue'
import PageHeader from '@/components/PageHeader.vue'
</script>

<template>
  <v-container class="py-6">
    <PageHeader
      title="Proveedores"
      subtitle="A quién se le compra cada insumo: contacto y tipo de proveedor."
    />
    <EmptyState
      illustration="products"
      title="Muy pronto"
      message="Aquí se administrará el catálogo de proveedores."
    />
  </v-container>
</template>
