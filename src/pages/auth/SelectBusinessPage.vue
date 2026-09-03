<script setup lang="ts">
// Solo se ve esta pantalla cuando de verdad hay algo que elegir: si el
// usuario pertenece a un único negocio con una única sucursal,
// useSessionStore ya la seleccionó sola al cargar las membresías
// (loadMemberships(), ver CLAUDE.md/PLAN.md §1.5) y el guard del router
// (router/index.ts) nunca manda aquí — va directo a /app/agenda.
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { roleLabel } from '@/lib/roles'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const router = useRouter()

// Mientras no haya tenant elegido, se pregunta el negocio; en cuanto lo
// hay, el siguiente paso es la sucursal (solo se llega aquí si esa
// membresía tiene más de una).
const step = computed<'tenant' | 'branch'>(() =>
  session.activeTenantId ? 'branch' : 'tenant',
)

function chooseTenant(tenantId: string): void {
  session.selectTenant(tenantId)
  // selectTenant() ya intenta autoseleccionar la sucursal si solo hay una
  // — si lo logró, no hace falta preguntar y se avanza directo.
  if (session.activeBranchId) {
    router.push('/app/agenda')
  }
}

function chooseBranch(branchId: string): void {
  session.selectBranch(branchId)
  router.push('/app/agenda')
}
</script>

<template>
  <v-main class="d-flex align-center justify-center" style="min-height: 100vh">
    <v-card max-width="420" width="100%" class="pa-2 mx-4" elevation="2">
      <v-card-title class="text-h6">
        {{ step === 'tenant' ? 'Elige tu negocio' : 'Elige la sucursal' }}
      </v-card-title>

      <v-list v-if="step === 'tenant'">
        <v-list-item
          v-for="m in session.memberships"
          :key="m.tenantId"
          :title="m.tenantName"
          :subtitle="roleLabel(m.role)"
          @click="chooseTenant(m.tenantId)"
        />
      </v-list>

      <v-list v-else>
        <v-list-item
          v-for="b in session.activeBranches"
          :key="b.id"
          :title="b.name"
          @click="chooseBranch(b.id)"
        />
      </v-list>
    </v-card>
  </v-main>
</template>
