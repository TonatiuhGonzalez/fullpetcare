<script setup lang="ts">
// <v-app> va UNA sola vez en toda la aplicación, aquí — es el contenedor
// raíz que Vuetify espera para su sistema de layout (v-main, overlays,
// etc.). Cada página/layout de abajo (LoginPage, AppLayout...) renderiza
// su propio <v-main> o <v-app-bar>, pero NUNCA otro <v-app>.
</script>

<template>
  <v-app>
    <router-view />
  </v-app>
</template>
