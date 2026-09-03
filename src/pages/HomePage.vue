<script setup lang="ts">
// Página provisional de la fase 1: solo confirma que Vue, Vuetify, Pinia
// y el router están conectados. Se reemplaza en la tarea 1.33 por la
// agenda real, y antes por LoginPage (1.29) y SelectBusinessPage (1.30).
</script>

<template>
  <v-app>
    <v-main class="d-flex align-center justify-center" style="min-height: 100vh">
      <v-card max-width="420" class="pa-6 text-center" elevation="2">
        <v-icon icon="mdi-paw" size="48" color="primary" class="mb-4" />
        <h1 class="text-h5 mb-2">FullPetCare</h1>
        <p class="text-body-2 text-medium-emphasis">
          Esqueleto de la aplicación funcionando: Vue 3 + Vuetify 3 + Pinia + Vue Router.
        </p>
      </v-card>
    </v-main>
  </v-app>
</template>
