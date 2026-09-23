<script setup lang="ts">
// <v-app> va UNA sola vez en toda la aplicación, aquí — es el contenedor
// raíz que Vuetify espera para su sistema de layout (v-main, overlays,
// etc.). Cada página/layout de abajo (LoginPage, AppLayout...) renderiza
// su propio <v-main> o <v-app-bar>, pero NUNCA otro <v-app>.
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const router = useRouter()
const route = useRoute()

// Si la sesión se pierde sin que el usuario pulse "Salir" (token vencido
// o revocado, timebox/inactividad del servidor, cierre en otra pestaña),
// el store ya limpió su estado — pero la pantalla seguiría mostrando
// datos hasta la siguiente navegación. Aquí se saca al usuario de la
// zona privada de inmediato, guardando a dónde iba para volver después.
watch(
  () => session.sessionExpired,
  (expired) => {
    if (expired && route.path.startsWith('/app')) {
      router.push({ path: '/login', query: { reason: 'expired', redirect: route.fullPath } })
    }
  },
)
</script>

<template>
  <v-app>
    <router-view />
  </v-app>
</template>
