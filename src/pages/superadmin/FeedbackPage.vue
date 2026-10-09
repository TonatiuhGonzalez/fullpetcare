<script setup lang="ts">
// Reportes de errores y sugerencias que envían los usuarios de los negocios
// (tarea #1958). Solo lectura: quién, de qué empresa, cuándo y qué escribió,
// con su captura si la adjuntó. Un superadmin no pertenece a ningún negocio,
// así que las fechas se muestran en la zona de la plataforma (Ciudad de México,
// la misma del alta de empresas, CLAUDE.md §6.8), no en la del navegador.
import { onMounted, ref } from 'vue'

import { formatDate, formatTime } from '@/lib/datetime'
import * as platformService from '@/services/platform'
import type { FeedbackReport } from '@/services/platform'
import PageHeader from '@/components/PageHeader.vue'

const PLATFORM_TIMEZONE = 'America/Mexico_City'

const reports = ref<FeedbackReport[]>([])
const loading = ref(false)
const errorMessage = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  errorMessage.value = null
  try {
    reports.value = await platformService.listFeedback()
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'No se pudieron cargar los reportes.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function when(report: FeedbackReport): string {
  return `${formatDate(report.createdAt, PLATFORM_TIMEZONE)}, ${formatTime(report.createdAt, PLATFORM_TIMEZONE)}`
}

// La URL firmada dura 60 s: se pide al hacer clic, no al cargar la lista.
async function openScreenshot(report: FeedbackReport): Promise<void> {
  if (!report.screenshotPath) return
  errorMessage.value = null
  try {
    const url = await platformService.getFeedbackScreenshotUrl(report.screenshotPath)
    window.open(url, '_blank', 'noopener')
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'No se pudo abrir la captura.'
  }
}
</script>

<template>
  <v-container class="py-6">
    <PageHeader
      title="Reportes y sugerencias"
      subtitle="Comentarios que los usuarios envían desde el menú de ayuda de la barra superior, del más reciente al más antiguo."
    />

    <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mb-4">
      {{ errorMessage }}
    </v-alert>

    <v-progress-linear v-if="loading" indeterminate class="mb-2" />

    <p v-if="!loading && reports.length === 0 && !errorMessage" class="text-medium-emphasis">
      Todavía no hay reportes.
    </p>

    <v-card v-for="report in reports" :key="report.id" variant="outlined" class="mb-3">
      <v-card-title class="text-subtitle-1">{{ report.tenantName }}</v-card-title>
      <v-card-subtitle>
        {{ report.userName ?? 'Sin nombre' }}
        <template v-if="report.userEmail"> · {{ report.userEmail }}</template>
        · {{ when(report) }}
      </v-card-subtitle>
      <v-card-text>
        <p style="white-space: pre-wrap">{{ report.message }}</p>
      </v-card-text>
      <v-card-actions v-if="report.screenshotPath">
        <v-btn
          prepend-icon="mdi-image-outline"
          variant="text"
          size="small"
          @click="openScreenshot(report)"
        >
          Ver captura
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-container>
</template>
