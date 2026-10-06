<script setup lang="ts">
// Alta y edición de un producto (tarea 11.9). Solo quien tiene
// "inventory:edit" ve el botón que abre esto; la política RLS de `products` es
// quien de verdad lo exige, este componente solo evita mostrar un formulario
// que fallaría. Las reglas de validación viven en lib/inventory.ts.
import { ref, watch } from 'vue'

import { pesosToCents } from '@/lib/money'
import { isValidSatProductCode, isValidSatUnitCode } from '@/lib/validation'
import type { Product } from '@/services/products'
import { useInventoryStore } from '@/stores/inventory'

const props = defineProps<{
  modelValue: boolean
  product?: Product | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const inventory = useInventoryStore()

const name = ref('')
const priceInPesos = ref<number | null>(null)
const costInPesos = ref<number | null>(null)
const minStock = ref<number | null>(0)
// Claves del SAT (CFDI): se sugieren las de la base; el negocio las cambia con
// su contador (mismo criterio que ServiceFormDialog).
const satProductCode = ref('01010101')
const satUnitCode = ref('H87')

const satProductRules = [
  (v: string) => isValidSatProductCode(v) || 'Deben ser 8 dígitos, por ejemplo 01010101.',
]
const satUnitRules = [
  (v: string) => isValidSatUnitCode(v) || 'Deben ser 2 o 3 caracteres, por ejemplo H87.',
]

const saving = ref(false)
const errorMessage = ref<string | null>(null)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    const p = props.product
    name.value = p?.name ?? ''
    priceInPesos.value = p ? p.price_cents / 100 : null
    costInPesos.value = p?.cost_cents != null ? p.cost_cents / 100 : null
    minStock.value = p?.min_stock ?? 0
    satProductCode.value = p?.sat_product_code ?? '01010101'
    satUnitCode.value = p?.sat_unit_code ?? 'H87'
    errorMessage.value = null
  },
)

function close(): void {
  emit('update:modelValue', false)
}

async function handleSubmit(): Promise<void> {
  saving.value = true
  errorMessage.value = null
  // Un campo vacío de v-text-field type=number llega como '' o null: se trata
  // como "sin dato" y lib/inventory.ts decide si eso es válido.
  const error = await inventory.saveProduct(
    {
      name: name.value,
      priceCents: priceInPesos.value == null ? NaN : pesosToCents(priceInPesos.value),
      costCents: costInPesos.value == null ? null : pesosToCents(costInPesos.value),
      minStock: minStock.value ?? NaN,
      satProductCode: satProductCode.value,
      satUnitCode: satUnitCode.value,
    },
    props.product?.id,
  )
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
    max-width="480"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>{{ product ? 'Editar producto' : 'Nuevo producto' }}</v-card-title>

      <v-card-text>
        <v-form @submit.prevent="handleSubmit">
          <v-text-field v-model="name" label="Nombre" required />

          <v-row dense>
            <v-col cols="6">
              <v-text-field
                v-model.number="priceInPesos"
                label="Precio (MXN, con IVA)"
                type="number"
                min="0"
                step="0.01"
                inputmode="decimal"
                required
              />
            </v-col>
            <v-col cols="6">
              <v-text-field
                v-model.number="costInPesos"
                label="Costo (MXN, opcional)"
                type="number"
                min="0"
                step="0.01"
                inputmode="decimal"
              />
            </v-col>
          </v-row>

          <v-text-field
            v-model.number="minStock"
            label="Avisar cuando queden"
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            suffix="piezas o menos"
            hint="Con 0 solo se avisa al quedarse sin inventario."
            persistent-hint
            class="mb-2"
          />

          <v-row dense>
            <v-col cols="6">
              <v-text-field
                v-model="satProductCode"
                label="Clave de producto (SAT)"
                :rules="satProductRules"
                maxlength="8"
                inputmode="numeric"
                hint="Para facturar. Confírmala con tu contador."
                persistent-hint
              />
            </v-col>
            <v-col cols="6">
              <v-text-field
                v-model="satUnitCode"
                label="Clave de unidad (SAT)"
                :rules="satUnitRules"
                maxlength="3"
                hint="H87 = pieza."
                persistent-hint
              />
            </v-col>
          </v-row>

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
        <v-btn color="primary" :loading="saving" @click="handleSubmit">Guardar</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
