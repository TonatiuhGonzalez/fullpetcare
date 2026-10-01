<script setup lang="ts">
// Marco del panel de superadmin (fase 10): barra superior con la salida y
// menú lateral con las áreas (Empresas, Motivos, Planes, Reportes, Superadmins). A diferencia de AppLayout.vue no hay
// negocio ni sucursal activos: un superadmin no pertenece a ninguno
// (PLAN.md D14), así que aquí no existe selector de sucursal.
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import ChangePasswordDialog from '@/components/ChangePasswordDialog.vue'
import SideMenu, { type SideMenuItem } from '@/components/SideMenu.vue'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const router = useRouter()

const userLabel = computed(() => session.profile?.fullName ?? session.user?.email ?? '')

const menuOpen = ref(false)
const menuItems: SideMenuItem[] = [
  { title: 'Empresas', icon: 'mdi-domain', to: '/superadmin/empresas' },
  { title: 'Motivos', icon: 'mdi-comment-question-outline', to: '/superadmin/motivos' },
  { title: 'Planes', icon: 'mdi-star-circle-outline', to: '/superadmin/planes' },
  { title: 'Reportes', icon: 'mdi-bug-outline', to: '/superadmin/reportes' },
  { title: 'Superadmins', icon: 'mdi-shield-account-outline', to: '/superadmin/administradores' },
]

const showChangePassword = ref(false)
const passwordChangedNotice = ref(false)

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
    <!-- Hamburguesa: solo en pantallas angostas (el menú lateral se oculta). -->
    <v-app-bar-nav-icon class="d-md-none" @click="menuOpen = !menuOpen" />
    <v-app-bar-title>
      <v-icon icon="mdi-shield-crown-outline" class="mr-2" />
      FullPetCare · Plataforma
    </v-app-bar-title>

    <v-spacer />

    <!-- En pantallas angostas la barra no alcanza para el chip y el nombre, y
         se amontonaban en tres líneas: se ocultan. Este panel es de
         escritorio (solo la vista pública de mascotas es mobile-first). -->
    <v-chip class="mr-4 d-none d-sm-flex" size="small" variant="tonal">Superadmin</v-chip>
    <span class="mr-2 text-body-2 d-none d-md-inline">{{ userLabel }}</span>
    <v-btn
      icon="mdi-lock-reset"
      variant="text"
      title="Cambiar contraseña"
      @click="showChangePassword = true"
    />
    <v-btn icon="mdi-logout" variant="text" title="Salir" @click="handleLogout" />
  </v-app-bar>

  <SideMenu v-model:open="menuOpen" :items="menuItems" />

  <ChangePasswordDialog
    v-model="showChangePassword"
    :email="session.user?.email ?? ''"
    @changed="passwordChangedNotice = true"
  />

  <v-snackbar v-model="passwordChangedNotice" color="success" :timeout="4000">
    Contraseña actualizada.
  </v-snackbar>

  <v-main>
    <router-view />
  </v-main>
</template>
