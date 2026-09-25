<script setup lang="ts">
// Confirmación para que el DUEÑO dé de baja su propio negocio. Es una acción
// grave: tras confirmar, nadie del negocio podrá volver a ver su información
// hasta que el equipo de la plataforma lo reactive. Por eso hay que escribir el
// nombre del negocio (mismo patrón que borrar un repositorio en GitHub).
// Componente tonto: entrega el comentario opcional por `confirm`.
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  modelValue: boolean
  tenantName: string
  saving: boolean
  errorMessage: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [comment: string]
}>()

const typedName = ref('')
const comment = ref('')

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      typedName.value = ''
      comment.value = ''
    }
  },
)

const canConfirm = computed(() => typedName.value.trim() === props.tenantName.trim())
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="480"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>Cancelar mi cuenta</v-card-title>

      <v-card-text>
        <v-alert type="warning" variant="tonal" density="compact" class="mb-4">
          Al cancelar, <strong>{{ tenantName }}</strong> dejará de ser accesible para todo
          tu equipo, incluido tú. Tu información no se borra, pero solo el equipo de
          FullPetCare puede reactivar la cuenta.
        </v-alert>

        <v-text-field
          v-model="typedName"
          :label="`Escribe «${tenantName}» para confirmar`"
          autocomplete="off"
        />
        <v-textarea
          v-model="comment"
          label="¿Quieres contarnos por qué? (opcional)"
          rows="2"
          auto-grow
        />

        <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal">
          {{ errorMessage }}
        </v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="saving"
          @click="emit('update:modelValue', false)"
        >
          Volver
        </v-btn>
        <v-btn
          color="error"
          :loading="saving"
          :disabled="!canConfirm"
          @click="emit('confirm', comment.trim())"
        >
          Cancelar cuenta
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
