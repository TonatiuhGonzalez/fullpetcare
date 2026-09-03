<script setup lang="ts">
// Provisional: solo confirma que el flujo completo funciona de punta a
// punta (login → selección de negocio → esta pantalla, con sesión y RLS
// reales). Se reemplaza por la agenda del día de verdad en la fase 3.
import { roleLabel } from '@/lib/roles'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
</script>

<template>
  <v-container class="py-8">
    <v-card max-width="480" class="pa-6">
      <h1 class="text-h5 mb-4">Agenda del día</h1>
      <p class="mb-1">
        <strong>Usuario:</strong> {{ session.profile?.fullName ?? session.user?.email }}
      </p>
      <p class="mb-1"><strong>Rol:</strong> {{ roleLabel(session.role) }}</p>
      <p class="mb-1">
        <strong>Negocio:</strong> {{ session.activeMembership?.tenantName }}
      </p>
      <p class="mb-1"><strong>Sucursal:</strong> {{ session.activeBranch?.name }}</p>
      <p class="text-medium-emphasis mt-4 text-body-2">
        Esta pantalla se reemplaza por la agenda real en la fase 3.
      </p>
    </v-card>
  </v-container>
</template>
