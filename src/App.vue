<script setup lang="ts">
// App.vue queda deliberadamente vacío de layout: cada rama de rutas (privada
// bajo /app, pública en /c/:token) trae su propio layout (AppLayout,
// PublicLayout). Aquí solo se monta lo que decida el router.
</script>

<template>
  <router-view />
</template>
