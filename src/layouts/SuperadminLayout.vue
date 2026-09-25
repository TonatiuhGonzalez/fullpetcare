<script setup lang="ts">
// Marco del panel de superadmin (fase 10): barra superior con las dos áreas
// (Empresas y Superadmins) y la salida. A diferencia de AppLayout.vue no hay
// negocio ni sucursal activos: un superadmin no pertenece a ninguno
// (PLAN.md D14), así que aquí no existe selector de sucursal.
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const router = useRouter()

const userLabel = computed(() => session.profile?.fullName ?? session.user?.email ?? '')

async function handleLogout(): Promise<void> {
  // "finally": aunque el servidor no responda, la sesión local ya se limpió
  // en session.logout() — hay que salir de la pantalla igual.
  try {
    await session.logout()
  } finally {
    router.push('/login')
  }
}
</script>

<template>
  <v-app-bar color="primary" density="comfortable">
    <v-app-bar-title>
      <v-icon icon="mdi-shield-crown-outline" class="mr-2" />
      FullPetCare · Plataforma
    </v-app-bar-title>

    <v-btn to="/superadmin/empresas" variant="text" class="mr-1">Empresas</v-btn>
    <v-btn to="/superadmin/administradores" variant="text" class="mr-4">Superadmins</v-btn>

    <!-- En pantallas angostas la barra no alcanza para el chip y el nombre, y
         se amontonaban en tres líneas: se ocultan. Este panel es de
         escritorio (solo la vista pública de mascotas es mobile-first). -->
    <v-chip class="mr-4 d-none d-sm-flex" size="small" variant="tonal">Superadmin</v-chip>
    <span class="mr-2 text-body-2 d-none d-md-inline">{{ userLabel }}</span>
    <v-btn icon="mdi-logout" variant="text" title="Salir" @click="handleLogout" />
  </v-app-bar>

  <v-main>
    <router-view />
  </v-main>
</template>
