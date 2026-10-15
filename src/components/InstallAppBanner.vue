<script setup lang="ts">
// Aviso "Agregar a inicio" de la vista pública (fase 16A, PLAN.md D21): en Android se ofrece
// con un botón; en iPhone y iPad se explica el menú Compartir, porque Safari no deja
// instalar desde un botón. Se puede descartar y no vuelve a salir durante un tiempo.
import { usePwaInstall } from '@/composables/usePwaInstall'

const { mode, showHint, install, dismiss } = usePwaInstall()
</script>

<template>
  <v-alert
    v-if="showHint"
    density="comfortable"
    variant="tonal"
    color="primary"
    icon="mdi-cellphone-arrow-down"
    closable
    class="mb-4"
    data-testid="install-banner"
    @click:close="dismiss"
  >
    <template v-if="mode === 'prompt'">
      <p class="text-body-2 mb-3">
        Agrega la app a tu pantalla de inicio para abrirla más rápido.
      </p>
      <div class="d-flex ga-2">
        <v-btn color="primary" size="small" @click="install">Agregar a inicio</v-btn>
        <v-btn variant="text" size="small" @click="dismiss">Ahora no</v-btn>
      </div>
    </template>
    <template v-else>
      <p class="text-body-2 mb-1">
        Para agregarla a tu pantalla de inicio: toca
        <v-icon icon="mdi-export-variant" size="small" aria-label="Compartir" />
        <strong>Compartir</strong> y luego <strong>Agregar a pantalla de inicio</strong>.
      </p>
      <v-btn variant="text" size="small" class="px-0" @click="dismiss">Entendido</v-btn>
    </template>
  </v-alert>
</template>
