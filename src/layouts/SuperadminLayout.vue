<script setup lang="ts">
// Marco del panel de superadmin (fase 10): barra superior con la salida y
// menú lateral con las áreas (Empresas, Motivos, Planes, Reportes, Superadmins). A diferencia de AppLayout.vue no hay
// negocio ni sucursal activos: un superadmin no pertenece a ninguno
// (PLAN.md D14), así que aquí no existe selector de sucursal.
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'

import BrandLogo from '@/components/BrandLogo.vue'
import ChangePasswordDialog from '@/components/ChangePasswordDialog.vue'
import SideMenu, { type SideMenuItem } from '@/components/SideMenu.vue'
import UserMenu from '@/components/UserMenu.vue'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const router = useRouter()
const { xs } = useDisplay()

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
  <v-app-bar color="surface" density="comfortable" flat border="b">
    <!-- Hamburguesa: solo en pantallas angostas (el menú lateral se oculta). -->
    <v-app-bar-nav-icon class="d-md-none" @click="menuOpen = !menuOpen" />
    <span class="brand-link ml-2 mr-3">
      <BrandLogo :size="28" :show-wordmark="!xs" />
    </span>
    <v-chip
      size="small"
      variant="tonal"
      color="primary"
      prepend-icon="mdi-shield-crown-outline"
    >
      Plataforma
    </v-chip>

    <v-spacer />

    <UserMenu
      :name="userLabel"
      role-label="Superadmin"
      :email="session.user?.email"
      can-change-password
      @change-password="showChangePassword = true"
      @logout="handleLogout"
    />
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

<style scoped lang="scss">
.brand-link {
  display: inline-flex;
}
</style>
