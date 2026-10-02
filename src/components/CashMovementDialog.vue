<script setup lang="ts">
// Retiro, gasto o ingreso de efectivo en la caja abierta (tarea 12.11). Las reglas
// (monto mayor a cero, motivo obligatorio) viven en lib/cashRegister.ts y las
// aplica el store; la base las vuelve a exigir.
import { ref, watch } from 'vue'

import { MOVEMENT_LABELS, type CashMovementKind } from '@/lib/cashRegister'
import { useCashRegisterStore } from '@/stores/cashRegister'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: []
}>()

const cashRegister = useCashRegisterStore()

const type = ref<CashMovementKind>('expense')
const amount = ref('')
const reason = ref('')
const saving = ref(false)
const errorMessage = ref<string | null>(null)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    type.value = 'expense'
    amount.value = ''
    reason.value = ''
    errorMessage.value = null
  },
)

async function handleSubmit(): Promise<void> {
  saving.value = true
  errorMessage.value = null
  const error = await cashRegister.addMovement(type.value, amount.value, reason.value)
  saving.value = false
  if (error) {
    errorMessage.value = error
    return
  }
  emit('saved')
  emit('update:modelValue', false)
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="460"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>Registrar movimiento de efectivo</v-card-title>
      <v-card-text>
        <v-alert
          v-if="errorMessage"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-3"
        >
          {{ errorMessage }}
        </v-alert>
        <v-btn-toggle
          v-model="type"
          mandatory
          color="primary"
          variant="outlined"
          divided
          class="mb-2"
        >
          <v-btn v-for="(label, key) in MOVEMENT_LABELS" :key="key" :value="key">{{
            label.title
          }}</v-btn>
        </v-btn-toggle>
        <p class="text-body-2 text-medium-emphasis mb-4">
          {{ MOVEMENT_LABELS[type].help }}
        </p>
        <v-text-field
          v-model="amount"
          label="Monto"
          prefix="$"
          inputmode="decimal"
          autofocus
        />
        <v-text-field
          v-model="reason"
          label="Motivo"
          hint="Por qué entra o sale el dinero"
          persistent-hint
        />
        <p class="text-caption text-medium-emphasis mt-3">
          Un movimiento no se puede editar ni borrar. Si te equivocas, registra otro que
          lo corrija.
        </p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="emit('update:modelValue', false)">Cancelar</v-btn>
        <v-btn color="primary" :loading="saving" @click="handleSubmit">Registrar</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
