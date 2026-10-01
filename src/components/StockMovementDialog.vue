<script setup lang="ts">
// Entrada de compra o ajuste de existencias de UN producto en la sucursal
// activa (tarea 11.9). Registra un movimiento en la bitácora; nunca edita la
// existencia directo. Las reglas (cantidad entera, motivo obligatorio en
// ajustes, no sacar más de lo que hay) viven en lib/inventory.ts y las aplica
// el store; la base las vuelve a exigir.
import { ref, watch } from 'vue'

import type { ManualMovementType } from '@/lib/inventory'
import { useInventoryStore, type InventoryRow } from '@/stores/inventory'

const props = defineProps<{
  modelValue: boolean
  row: InventoryRow | null
  type: Extract<ManualMovementType, 'purchase' | 'adjustment'>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const inventory = useInventoryStore()

const quantity = ref<number | null>(null)
const direction = ref<'in' | 'out'>('in')
const reason = ref('')
const saving = ref(false)
const errorMessage = ref<string | null>(null)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    quantity.value = null
    direction.value = 'in'
    reason.value = ''
    errorMessage.value = null
  },
)

function close(): void {
  emit('update:modelValue', false)
}

async function handleSubmit(): Promise<void> {
  if (!props.row) return
  saving.value = true
  errorMessage.value = null
  const error = await inventory.registerMovement({
    productId: props.row.product.id,
    type: props.type,
    quantity: quantity.value ?? NaN,
    direction: props.type === 'adjustment' ? direction.value : undefined,
    reason: reason.value,
  })
  saving.value = false

  if (error) {
    errorMessage.value = error
    return
  }
  close()
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="420"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card v-if="row">
      <v-card-title>{{
        type === 'purchase' ? 'Entrada de compra' : 'Ajuste de inventario'
      }}</v-card-title>
      <v-card-subtitle>{{ row.product.name }} · hay {{ row.stock }}</v-card-subtitle>

      <v-card-text class="pt-4">
        <v-form @submit.prevent="handleSubmit">
          <v-btn-toggle
            v-if="type === 'adjustment'"
            v-model="direction"
            mandatory
            density="comfortable"
            color="primary"
            variant="outlined"
            class="mb-4"
          >
            <v-btn value="in">Suma</v-btn>
            <v-btn value="out">Resta</v-btn>
          </v-btn-toggle>

          <v-text-field
            v-model.number="quantity"
            label="Cantidad (piezas)"
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
            autofocus
          />

          <v-text-field
            v-if="type === 'adjustment'"
            v-model="reason"
            label="Motivo"
            hint="Por ejemplo: conteo físico, producto dañado."
            persistent-hint
          />

          <v-alert
            v-if="errorMessage"
            type="error"
            density="compact"
            variant="tonal"
            class="mt-3"
          >
            {{ errorMessage }}
          </v-alert>
        </v-form>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">Cancelar</v-btn>
        <v-btn color="primary" :loading="saving" @click="handleSubmit">Registrar</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
