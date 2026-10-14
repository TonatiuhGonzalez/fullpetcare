<script setup lang="ts">
// Cobro rápido (fase 30, PLAN.md D30 punto 6). Pantalla vacía de la preparación de la
// oleada 3: la ruta y el menú ya existen para que la rama de la fase 30 solo llene esta
// página sin tocar el router ni el layout.
import EmptyState from '@/components/EmptyState.vue'
import PageHeader from '@/components/PageHeader.vue'
</script>

<template>
  <v-container class="py-6">
    <PageHeader
      title="Cobro rápido"
      subtitle="Cobra un servicio o productos al paso, sin cita y sin registrar al cliente."
    />
    <EmptyState illustration="sales" title="Muy pronto" message="Aquí se hará el cobro rápido." />
  </v-container>
</template>
