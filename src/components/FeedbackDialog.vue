<script setup lang="ts">
// "Reportar un error o sugerir una mejora" (tarea #1958). Lo abre el botón de
// la barra superior de AppLayout, así que lo ve cualquier rol. Igual que
// ChangePasswordDialog, valida la forma (lib/feedback.ts), llama a su service
// y avisa al padre por `sent` para que muestre la confirmación.
import { computed, ref, watch } from 'vue'

import { MAX_MESSAGE_LENGTH, messageProblem, screenshotProblem } from '@/lib/feedback'
import * as feedbackService from '@/services/feedback'

const props = defineProps<{
  modelValue: boolean
  tenantId: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  sent: []
}>()

const message = ref('')
const screenshot = ref<File | null>(null)
const saving = ref(false)
const errorMessage = ref<string | null>(null)
// Los errores de forma solo se muestran DESPUÉS del primer intento de enviar.
const showValidation = ref(false)

const messageError = computed(() => (showValidation.value ? messageProblem(message.value) : null))
// La captura se valida apenas se elige: pesar de más es un error obvio de ver.
const screenshotError = computed(() =>
  screenshot.value ? screenshotProblem(screenshot.value) : null,
)

// Se limpia cada vez que se abre, para no arrastrar el comentario anterior.
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    message.value = ''
    screenshot.value = null
    errorMessage.value = null
    showValidation.value = false
  },
)

function close(): void {
  emit('update:modelValue', false)
}

async function handleSubmit(): Promise<void> {
  errorMessage.value = null
  showValidation.value = true
  if (messageProblem(message.value) || screenshotError.value) return

  saving.value = true
  try {
    await feedbackService.send(props.tenantId, message.value, screenshot.value ?? undefined)
    emit('sent')
    close()
  } catch (e) {
    // Negocio en solo lectura: la base responde con su propio mensaje en español.
    const text = typeof e === 'object' && e !== null && 'message' in e ? String(e.message) : ''
    errorMessage.value = /solo lectura/i.test(text)
      ? text
      : 'No se pudo enviar tu comentario. Revisa tu conexión e inténtalo de nuevo.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="520"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>Reportar un error o sugerir una mejora</v-card-title>

      <v-card-text>
        <p class="text-body-2 text-medium-emphasis mb-4">
          Cuéntanos qué falló o qué te gustaría que el sistema hiciera mejor. Tus comentarios
          nos ayudan a mejorarlo.
        </p>
        <v-form @submit.prevent="handleSubmit">
          <v-textarea
            v-model="message"
            label="Tu comentario"
            rows="5"
            auto-grow
            :counter="MAX_MESSAGE_LENGTH"
            :error-messages="messageError ?? []"
          />
          <v-file-input
            v-model="screenshot"
            label="Captura de pantalla (opcional)"
            accept="image/jpeg,image/png,image/webp"
            prepend-icon="mdi-image-outline"
            :error-messages="screenshotError ?? []"
          />
          <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal">
            {{ errorMessage }}
          </v-alert>
        </v-form>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="saving" @click="close">Cancelar</v-btn>
        <v-btn color="primary" :loading="saving" @click="handleSubmit">Enviar</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
