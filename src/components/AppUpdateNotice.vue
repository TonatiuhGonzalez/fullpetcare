<script setup lang="ts">
// Aviso de versión nueva (PLAN.md D22): se queda visible (sin cerrarse solo) hasta que
// la persona recargue, porque sin recargar no puede entrar a la pantalla que pidió.
import { APP_UPDATE_MESSAGE, useAppUpdateNotice } from '@/composables/useAppUpdateNotice'

const { visible, reload } = useAppUpdateNotice()
</script>

<template>
  <v-snackbar
    v-model="visible"
    :timeout="-1"
    color="primary"
    multi-line
    location="bottom"
  >
    {{ APP_UPDATE_MESSAGE }}
    <template #actions>
      <v-btn variant="text" @click="reload">Recargar</v-btn>
    </template>
  </v-snackbar>
</template>
