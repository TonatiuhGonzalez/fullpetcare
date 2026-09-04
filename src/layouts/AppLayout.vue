<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { roleLabel } from '@/lib/roles'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const router = useRouter()

const businessName = computed(() => session.activeMembership?.tenantName ?? '')
const userLabel = computed(() => session.profile?.fullName ?? session.user?.email ?? '')

async function handleLogout(): Promise<void> {
  await session.logout()
  router.push('/login')
}

function handleBranchChange(branchId: unknown): void {
  if (typeof branchId === 'string') session.selectBranch(branchId)
}
</script>

<template>
  <v-app-bar color="primary" density="comfortable">
    <v-app-bar-title>
      <v-icon icon="mdi-paw" class="mr-2" />
      {{ businessName }}
    </v-app-bar-title>

    <!-- Navegación mínima: solo hay dos áreas construidas hasta ahora
         (agenda y clientes). Un v-navigation-drawer completo se agrega
         cuando haya suficientes secciones para justificarlo. -->
    <v-btn to="/app/agenda" variant="text" class="mr-1">Agenda</v-btn>
    <v-btn to="/app/clientes" variant="text" class="mr-1">Clientes</v-btn>
    <v-btn to="/app/catalogo" variant="text" class="mr-4">Catálogo</v-btn>

    <!-- El selector de sucursal solo tiene sentido si hay más de una que
         elegir — con una sola, se muestra su nombre como texto fijo. -->
    <v-select
      v-if="session.activeBranches.length > 1"
      :model-value="session.activeBranchId"
      :items="session.activeBranches"
      item-title="name"
      item-value="id"
      density="compact"
      variant="solo"
      hide-details
      style="max-width: 220px"
      class="mr-4"
      @update:model-value="handleBranchChange"
    />
    <span v-else class="text-body-2 mr-4">{{ session.activeBranch?.name }}</span>

    <v-chip class="mr-4" size="small" variant="tonal">{{
      roleLabel(session.role)
    }}</v-chip>
    <span class="mr-2 text-body-2">{{ userLabel }}</span>
    <v-btn icon="mdi-logout" variant="text" title="Salir" @click="handleLogout" />
  </v-app-bar>

  <v-main>
    <router-view />
  </v-main>
</template>
