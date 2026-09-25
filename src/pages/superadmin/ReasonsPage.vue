<script setup lang="ts">
// Catálogo de motivos públicos de suspensión/baja (tarea #1905). Es lo que el
// superadmin elige al suspender o dar de baja una empresa, y lo que el cliente
// lee al iniciar sesión. Un motivo ya usado no se borra: se desactiva y deja de
// ofrecerse. Los dos motivos que usan las automatizaciones (falta de pago,
// cancelación del cliente) se pueden renombrar pero llevan su etiqueta de tipo.
import { onMounted, ref } from 'vue'

import * as platformService from '@/services/platform'
import type { CancellationReason } from '@/services/platform'

const reasons = ref<CancellationReason[]>([])
const loading = ref(false)
const errorMessage = ref<string | null>(null)

const KIND_LABEL: Record<CancellationReason['kind'], string> = {
  non_payment: 'Automático: falta de pago',
  customer_request: 'Automático: cancelación del dueño',
  other: '',
}

async function load(): Promise<void> {
  loading.value = true
  errorMessage.value = null
  try {
    reasons.value = await platformService.listReasons()
  } catch (e) {
    errorMessage.value =
      e instanceof Error ? e.message : 'No se pudieron cargar los motivos.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

// --- Alta -------------------------------------------------------------------
const newLabel = ref('')
const saving = ref(false)

async function addReason(): Promise<void> {
  if (newLabel.value.trim() === '') return
  saving.value = true
  errorMessage.value = null
  try {
    await platformService.createReason(newLabel.value)
    newLabel.value = ''
    await load()
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'No se pudo guardar el motivo.'
  } finally {
    saving.value = false
  }
}

// --- Edición ----------------------------------------------------------------
const editing = ref<CancellationReason | null>(null)
const editLabel = ref('')

function startEdit(reason: CancellationReason): void {
  editing.value = reason
  editLabel.value = reason.label
}

async function saveEdit(): Promise<void> {
  if (!editing.value) return
  await update(editing.value, editLabel.value, editing.value.isActive)
  editing.value = null
}

async function toggleActive(reason: CancellationReason): Promise<void> {
  await update(reason, reason.label, !reason.isActive)
}

async function update(
  reason: CancellationReason,
  label: string,
  isActive: boolean,
): Promise<void> {
  errorMessage.value = null
  try {
    await platformService.updateReason(reason.id, label, isActive)
    await load()
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'No se pudo guardar el motivo.'
  }
}
</script>

<template>
  <v-container max-width="800">
    <h1 class="text-h5 mb-1">Motivos de suspensión y baja</h1>
    <p class="text-body-2 text-medium-emphasis mb-4">
      Son los motivos que puedes elegir al suspender o dar de baja una empresa. El cliente
      ve exactamente este texto al iniciar sesión. Los comentarios internos se escriben
      aparte, al cambiar el estado, y solo los ves tú.
    </p>

    <v-alert
      v-if="errorMessage"
      type="error"
      density="compact"
      variant="tonal"
      class="mb-4"
    >
      {{ errorMessage }}
    </v-alert>

    <v-form class="d-flex ga-2 mb-4" @submit.prevent="addReason">
      <v-text-field
        v-model="newLabel"
        label="Nuevo motivo"
        density="compact"
        hide-details
        placeholder="Ej. Cierre temporal por remodelación"
      />
      <v-btn
        type="submit"
        color="primary"
        :loading="saving"
        :disabled="newLabel.trim() === ''"
      >
        Agregar
      </v-btn>
    </v-form>

    <v-progress-linear v-if="loading" indeterminate class="mb-2" />

    <v-table density="comfortable">
      <thead>
        <tr>
          <th>Motivo</th>
          <th>Tipo</th>
          <th>Activo</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="reason in reasons" :key="reason.id">
          <td :class="{ 'text-medium-emphasis': !reason.isActive }">
            {{ reason.label }}
          </td>
          <td class="text-caption">{{ KIND_LABEL[reason.kind] }}</td>
          <td>
            <v-switch
              :model-value="reason.isActive"
              density="compact"
              hide-details
              color="primary"
              @update:model-value="toggleActive(reason)"
            />
          </td>
          <td class="text-right">
            <v-btn
              icon="mdi-pencil"
              variant="text"
              size="small"
              title="Renombrar"
              @click="startEdit(reason)"
            />
          </td>
        </tr>
      </tbody>
    </v-table>

    <v-dialog
      :model-value="editing !== null"
      max-width="420"
      @update:model-value="editing = null"
    >
      <v-card>
        <v-card-title>Renombrar motivo</v-card-title>
        <v-card-text>
          <v-text-field v-model="editLabel" label="Texto del motivo" />
          <p class="text-caption text-medium-emphasis">
            Las empresas que ya tienen este motivo conservan el texto con el que se les
            avisó.
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="editing = null">Cancelar</v-btn>
          <v-btn color="primary" :disabled="editLabel.trim() === ''" @click="saveEdit">
            Guardar
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>
