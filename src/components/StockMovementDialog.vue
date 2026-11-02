<script setup lang="ts">
// Entrada de compra o ajuste de existencias de UN producto en la sucursal
// activa (tarea 11.9). Registra un movimiento en la bitácora; nunca edita la
// existencia directo. Las reglas (cantidad entera, motivo obligatorio en
// ajustes, no sacar más de lo que hay) viven en lib/inventory.ts y las aplica
// el store; la base las vuelve a exigir.
import { computed, ref, watch } from 'vue'

import {
  baseUnits,
  formatStock,
  isFractional,
  presentationOf,
  type SaleUnit,
} from '@/lib/fractional'
import type { ManualMovementType } from '@/lib/inventory'
import { useInventoryStore, type InventoryRow } from '@/stores/inventory'
import { isFormValid, required } from '@/lib/validation'
import type { FormHandle } from '@/lib/validation'

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
// Producto fraccionado (fase 29C): la cantidad puede ser de envases o de unidades sueltas.
// Una compra llega en envases; un ajuste suele ser de unidades.
const unit = ref<SaleUnit>('package')
const presentation = computed(() =>
  props.row ? presentationOf(props.row.product) : null,
)
const fractional = computed(() =>
  presentation.value ? isFractional(presentation.value) : false,
)
const quantityLabel = computed(() => {
  if (!fractional.value || !presentation.value) return 'Cantidad (piezas)*'
  const p = presentation.value
  return unit.value === 'package'
    ? `Cantidad (${p.packageName ?? 'envases'})*`
    : `Cantidad (${p.unitName ?? 'unidades'})*`
})
const saving = ref(false)
const errorMessage = ref<string | null>(null)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    quantity.value = null
    direction.value = 'in'
    reason.value = ''
    unit.value = props.type === 'purchase' ? 'package' : 'unit'
    errorMessage.value = null
  },
)

function close(): void {
  emit('update:modelValue', false)
}

const formRef = ref<FormHandle | null>(null)

async function handleSubmit(): Promise<void> {
  if (!(await isFormValid(formRef.value))) return
  if (!props.row) return
  saving.value = true
  errorMessage.value = null
  const error = await inventory.registerMovement({
    productId: props.row.product.id,
    type: props.type,
    // La existencia siempre está en unidades base: un envase son N de ellas.
    quantity:
      quantity.value === null || !presentation.value
        ? NaN
        : baseUnits(
            quantity.value,
            fractional.value ? unit.value : 'package',
            presentation.value,
          ),
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
      <v-card-subtitle>
        {{ row.product.name }} · hay
        {{ presentation ? formatStock(row.stock, presentation) : row.stock }}
      </v-card-subtitle>

      <v-card-text class="pt-4">
        <v-form ref="formRef" @submit.prevent="handleSubmit">
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

          <v-btn-toggle
            v-if="fractional && presentation"
            v-model="unit"
            mandatory
            density="comfortable"
            color="primary"
            variant="outlined"
            class="mb-4"
          >
            <v-btn value="package">{{ presentation.packageName ?? 'Envases' }}</v-btn>
            <v-btn value="unit">{{ presentation.unitName ?? 'Unidades' }}</v-btn>
          </v-btn-toggle>

          <v-text-field
            v-model.number="quantity"
            :label="quantityLabel"
            :rules="[required]"
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
            autofocus
          />

          <v-text-field
            v-if="type === 'adjustment'"
            v-model="reason"
            label="Motivo*"
            :rules="[required]"
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
