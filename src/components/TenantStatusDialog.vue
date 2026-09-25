<script setup lang="ts">
// Pide el motivo al suspender o dar de baja una empresa. El motivo es
// obligatorio (lo exige también la base): es lo que hace útil la bitácora
// meses después. Componente tonto: no llama a ningún servicio, solo entrega
// el motivo al padre por `confirm`.
import { computed, ref, watch } from 'vue'

import { tenantStatusLabel, type TenantStatus } from '@/lib/platform'

const props = defineProps<{
  modelValue: boolean
  tenantName: string
  targetStatus: Exclude<TenantStatus, 'active'>
  saving: boolean
  errorMessage: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [reason: string]
}>()

const reason = ref('')
const showValidation = ref(false)

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      reason.value = ''
      showValidation.value = false
    }
  },
)

const title = computed(() =>
  props.targetStatus === 'suspended' ? 'Suspender empresa' : 'Dar de baja empresa',
)

function handleConfirm(): void {
  showValidation.value = true
  if (reason.value.trim() === '') return
  emit('confirm', reason.value.trim())
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="460"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>{{ title }}</v-card-title>

      <v-card-text>
        <p class="mb-2">
          <strong>{{ tenantName }}</strong> pasará a estado
          <strong>{{ tenantStatusLabel(targetStatus) }}</strong
          >.
        </p>
        <p class="text-body-2 text-medium-emphasis mb-4">
          Por ahora es solo una etiqueta: los usuarios de la empresa seguirán pudiendo entrar. Se
          puede revertir en cualquier momento.
        </p>

        <v-textarea
          v-model="reason"
          label="Motivo *"
          rows="3"
          auto-grow
          :error-messages="showValidation && reason.trim() === '' ? ['Indica el motivo.'] : []"
        />

        <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal">
          {{ errorMessage }}
        </v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="saving" @click="emit('update:modelValue', false)">
          Cancelar
        </v-btn>
        <v-btn :color="targetStatus === 'closed' ? 'error' : 'warning'" :loading="saving" @click="handleConfirm">
          {{ targetStatus === 'suspended' ? 'Suspender' : 'Dar de baja' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
