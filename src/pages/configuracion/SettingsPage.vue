<script setup lang="ts">
// Marco de la vista de configuración (tarea #1959): menú vertical a la
// izquierda que clasifica la configuración y, a la derecha, la sección elegida
// (ruta hija). "Empresa y sucursales" es solo del dueño; "Cuenta" la ven todos.
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
</script>

<template>
  <v-container fluid class="pa-4">
    <v-row>
      <v-col cols="12" md="3" lg="2">
        <v-list nav density="comfortable" class="border rounded">
          <v-list-item
            v-if="session.role === 'owner'"
            to="/app/configuracion/sucursales"
            prepend-icon="mdi-store-cog-outline"
            title="Empresa y sucursales"
          />
          <v-list-item
            to="/app/configuracion/cuenta"
            prepend-icon="mdi-account-cog-outline"
            title="Cuenta"
          />
        </v-list>
      </v-col>
      <v-col cols="12" md="9" lg="10">
        <router-view />
      </v-col>
    </v-row>
  </v-container>
</template>
