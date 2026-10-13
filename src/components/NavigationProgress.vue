<script setup lang="ts">
// Barra fina fija arriba de todo (PLAN.md D22): aparece si cambiar de pantalla tarda
// más de ~150 ms y desaparece al terminar o fallar. Va una sola vez en App.vue, así
// cubre el área del negocio, el panel de plataforma y la vista pública. Decorativa
// para lectores de pantalla salvo por su rol de progreso.
import { useNavigationProgress } from '@/composables/useNavigationProgress'

const visible = useNavigationProgress()
</script>

<template>
  <v-progress-linear
    v-if="visible"
    class="navigation-progress"
    indeterminate
    color="primary"
    height="3"
    aria-label="Cargando pantalla"
  />
</template>

<style scoped lang="scss">
.navigation-progress {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  // Por encima de la barra superior y del menú lateral de Vuetify.
  z-index: 2600;
}
</style>
