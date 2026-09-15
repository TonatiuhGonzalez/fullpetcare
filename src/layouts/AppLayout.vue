<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { isFrontDesk, roleLabel } from '@/lib/roles'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const router = useRouter()

const businessName = computed(() => session.activeMembership?.tenantName ?? '')
// "Patitas Felices - Sucursal Centro" — la sucursal activa va pegada al
// nombre del negocio en el título (pedido explícito, antes solo se veía
// más a la derecha de la barra, lejos del nombre). Mientras no haya
// sucursal elegida (p. ej. el instante entre login y que
// resolveActiveBranch() corra) se muestra solo el nombre del negocio.
const titleLabel = computed(() =>
  session.activeBranch ? `${businessName.value} - ${session.activeBranch.name}` : businessName.value,
)
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
      {{ titleLabel }}
    </v-app-bar-title>

    <!-- Navegación mínima: solo hay dos áreas construidas hasta ahora
         (agenda y clientes). Un v-navigation-drawer completo se agrega
         cuando haya suficientes secciones para justificarlo.

         "Clientes" solo para owner/receptionist (isFrontDesk) — groomer/
         vet no tienen el listado completo (router/index.ts ya redirige
         si llegan por URL directa; esto es solo para no mostrar un link
         a algo a lo que de todos modos no pueden entrar). -->
    <v-btn to="/app/agenda" variant="text" class="mr-1">Agenda</v-btn>
    <v-btn v-if="isFrontDesk(session.role)" to="/app/clientes" variant="text" class="mr-1">
      Clientes
    </v-btn>
    <v-btn to="/app/catalogo" variant="text" class="mr-4">Catálogo</v-btn>

    <!-- El selector de sucursal solo tiene sentido si hay más de una que
         elegir — con una sola, el título de arriba ya la muestra
         ("Patitas Felices - Sucursal Centro"), así que no hace falta
         repetirla aquí. -->
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
