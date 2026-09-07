<script setup lang="ts">
// Layout de la vista pública (tarea 7.11): SIN nada de la navegación
// interna (agenda, clientes, catálogo, selector de sucursal, botón de
// salir) — quien abre `/c/:token` no tiene sesión ni la necesita. Móvil
// primero: es un link que se abre desde WhatsApp en un teléfono, no desde
// el navegador de escritorio de un empleado.
//
// El nombre del negocio no se conoce hasta que PublicPetPage.vue termina
// de cargar (viene en la respuesta de la Edge Function, no de una ruta
// interna con sesión) — se recibe por evento en vez de traerlo aparte
// aquí: pedirlo dos veces sería una llamada de más a la función pública
// por la misma información.
import { ref } from 'vue'

const businessName = ref('')
</script>

<template>
  <v-app-bar color="primary" density="comfortable" flat>
    <v-app-bar-title>
      <v-icon icon="mdi-paw" class="mr-2" />
      {{ businessName || 'FullPetCare' }}
    </v-app-bar-title>
  </v-app-bar>

  <v-main>
    <router-view v-slot="{ Component }">
      <component :is="Component" @business-name="businessName = $event" />
    </router-view>
  </v-main>
</template>
