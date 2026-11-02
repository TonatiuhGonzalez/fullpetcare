<script setup lang="ts">
// Alta y edición de un producto (tarea 11.9). Solo quien tiene
// "inventory:edit" ve el botón que abre esto; la política RLS de `products` es
// quien de verdad lo exige, este componente solo evita mostrar un formulario
// que fallaría. Las reglas de validación viven en lib/inventory.ts.
import { computed, ref, watch } from 'vue'

import { formatMXN, pesosToCents } from '@/lib/money'
import { presentationProblem, unitPriceCents } from '@/lib/fractional'
import type { ProductPresentationInput } from '@/services/products'
import {
  isFormValid,
  isValidSatProductCode,
  isValidSatUnitCode,
  required,
} from '@/lib/validation'
import type { Product } from '@/services/products'
import { useInventoryStore } from '@/stores/inventory'
import { useSuppliersStore } from '@/stores/suppliers'
import type { FormHandle } from '@/lib/validation'

const props = defineProps<{
  modelValue: boolean
  product?: Product | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const inventory = useInventoryStore()
const suppliers = useSuppliersStore()

const name = ref('')
const priceInPesos = ref<number | null>(null)
const costInPesos = ref<number | null>(null)
const minStock = ref<number | null>(0)
// Claves del SAT (CFDI): se sugieren las de la base; el negocio las cambia con
// su contador (mismo criterio que ServiceFormDialog).
const satProductCode = ref('01010101')
const satUnitCode = ref('H87')
const categoryId = ref<string | null>(null)
// Proveedores del producto (fase 29B): puede tener varios.
const supplierIds = ref<string[]>([])
// Presentación fraccionada (fase 29C): el envase trae N unidades que también se venden sueltas.
const isFractional = ref(false)
const packageName = ref('caja')
const unitsPerPackage = ref<number | null>(null)
const unitName = ref('')
const unitPriceInPesos = ref<number | null>(null)
const unitSatCode = ref('H87')

// Categorías para elegir: las activas y, al editar, la actual aunque esté desactivada
// (si no, el selector la mostraría vacía y guardar la dejaría sin categoría sin avisar).
const categoryOptions = computed(() =>
  inventory.categories
    .filter((c) => c.is_active || c.id === categoryId.value)
    .map((c) => ({
      value: c.id,
      title: c.is_active ? c.name : `${c.name} (desactivada)`,
    })),
)

// Proveedores para elegir: los activos y, al editar, los que ya tiene aunque estén
// desactivados (mismo criterio que las categorías).
const supplierOptions = computed(() =>
  suppliers.suppliers
    .filter((s) => s.is_active || supplierIds.value.includes(s.id))
    .map((s) => ({
      value: s.id,
      title: s.is_active ? s.name : `${s.name} (desactivado)`,
    })),
)

// Precio de la unidad suelta calculado del precio del envase (lo que se cobra si no se fija uno).
const calculatedUnitPrice = computed(() => {
  if (!isFractional.value || !unitsPerPackage.value || unitsPerPackage.value < 2)
    return null
  if (priceInPesos.value == null) return null
  return unitPriceCents(pesosToCents(priceInPesos.value), {
    unitsPerPackage: unitsPerPackage.value,
    unitPriceCents: null,
  })
})

const minStockSuffix = computed(() =>
  isFractional.value && unitName.value.trim() !== ''
    ? `${unitName.value.trim()}s o menos`
    : 'piezas o menos',
)

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
    categoryId.value = p?.category_id ?? null
    isFractional.value = (p?.units_per_package ?? 1) > 1
    packageName.value = p?.package_name ?? 'caja'
    unitsPerPackage.value = isFractional.value ? (p?.units_per_package ?? null) : null
    unitName.value = p?.unit_name ?? ''
    unitPriceInPesos.value = p?.unit_price_cents != null ? p.unit_price_cents / 100 : null
    unitSatCode.value = p?.unit_sat_code ?? 'H87'
    errorMessage.value = null
    // Los vínculos se leen al abrir: así el formulario no depende de que la pantalla de
    // Proveedores se haya visitado antes.
    suppliers.load().then(() => {
      supplierIds.value = p ? suppliers.supplierIdsOf(p.id) : []
    })
  },
)

function close(): void {
  emit('update:modelValue', false)
}

const formRef = ref<FormHandle | null>(null)

async function handleSubmit(): Promise<void> {
  if (!(await isFormValid(formRef.value))) return
  saving.value = true
  errorMessage.value = null
  // Un campo vacío de v-text-field type=number llega como '' o null: se trata
  // como "sin dato" y lib/inventory.ts decide si eso es válido.
  // Presentación: si se activó, se manda completa; si el producto ya estaba fraccionado y se
  // apagó, se manda 1 unidad por envase (la base reescala la existencia de vuelta).
  let presentation: ProductPresentationInput | undefined
  if (isFractional.value) {
    const input = {
      unitsPerPackage: unitsPerPackage.value ?? NaN,
      unitName: unitName.value,
      unitPriceCents:
        unitPriceInPesos.value == null ? null : pesosToCents(unitPriceInPesos.value),
      unitSatCode: unitSatCode.value,
    }
    const problem = presentationProblem(input)
    if (problem) {
      errorMessage.value = problem
      saving.value = false
      return
    }
    presentation = {
      unitsPerPackage: input.unitsPerPackage,
      packageName: packageName.value.trim() || null,
      unitName: input.unitName.trim(),
      unitPriceCents: input.unitPriceCents,
      unitSatCode: input.unitSatCode.trim() || null,
    }
  } else if ((props.product?.units_per_package ?? 1) > 1) {
    presentation = {
      unitsPerPackage: 1,
      packageName: null,
      unitName: null,
      unitPriceCents: null,
      unitSatCode: null,
    }
  }

  const error = await inventory.saveProduct(
    {
      name: name.value,
      priceCents: priceInPesos.value == null ? NaN : pesosToCents(priceInPesos.value),
      costCents: costInPesos.value == null ? null : pesosToCents(costInPesos.value),
      minStock: minStock.value ?? NaN,
      satProductCode: satProductCode.value,
      satUnitCode: satUnitCode.value,
      categoryId: categoryId.value,
    },
    props.product?.id,
    supplierIds.value,
    presentation,
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
        <v-form ref="formRef" @submit.prevent="handleSubmit">
          <v-text-field v-model="name" label="Nombre*" :rules="[required]" />

          <v-select
            v-model="categoryId"
            :items="categoryOptions"
            label="Categoría"
            clearable
            hint="Agrupa el producto en el punto de venta. Sin categoría, aparece en «Sin categoría»."
            persistent-hint
            class="mb-2"
          />

          <v-autocomplete
            v-model="supplierIds"
            :items="supplierOptions"
            label="Proveedores"
            multiple
            chips
            closable-chips
            clearable
            variant="outlined"
            density="comfortable"
            hint="Quién surte este producto. Puede tener varios."
            persistent-hint
            no-data-text="Aún no hay proveedores. Agrégalos en Proveedores."
            class="mb-2"
          />

          <v-row dense>
            <v-col cols="6">
              <v-text-field
                v-model.number="priceInPesos"
                label="Precio (MXN, con IVA)*"
                type="number"
                min="0"
                step="0.01"
                inputmode="decimal"
                :rules="[required]"
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
            label="Avisar cuando queden*"
            :rules="[required]"
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            :suffix="minStockSuffix"
            hint="Con 0 solo se avisa al quedarse sin inventario."
            persistent-hint
            class="mb-2"
          />

          <!-- Medicamentos fraccionados (fase 29C): se compra la caja y se vende por tableta. -->
          <v-switch
            v-model="isFractional"
            color="primary"
            density="compact"
            label="También se vende por unidad suelta"
            hint="Para blísters recortados, frascos por mililitro, etc. El inventario se lleva en unidades."
            persistent-hint
            class="mb-2"
          />
          <template v-if="isFractional">
            <v-row dense>
              <v-col cols="6">
                <v-text-field
                  v-model="packageName"
                  label="Envase"
                  hint="Ej. caja, frasco"
                  persistent-hint
                />
              </v-col>
              <v-col cols="6">
                <v-text-field
                  v-model.number="unitsPerPackage"
                  label="Unidades por envase*"
                  type="number"
                  min="2"
                  step="1"
                  inputmode="numeric"
                />
              </v-col>
            </v-row>
            <v-row dense>
              <v-col cols="6">
                <v-text-field
                  v-model="unitName"
                  label="Unidad*"
                  hint="Ej. tableta, ml"
                  persistent-hint
                />
              </v-col>
              <v-col cols="6">
                <v-text-field
                  v-model.number="unitPriceInPesos"
                  label="Precio por unidad (MXN)"
                  type="number"
                  min="0"
                  step="0.01"
                  inputmode="decimal"
                  :hint="
                    calculatedUnitPrice !== null
                      ? `Vacío = se calcula: ${formatMXN(calculatedUnitPrice)}`
                      : 'Vacío = se calcula del precio del envase'
                  "
                  persistent-hint
                />
              </v-col>
            </v-row>
            <v-text-field
              v-model="unitSatCode"
              label="Clave de unidad (SAT) de la unidad suelta"
              maxlength="3"
              hint="Ej. H87 = pieza, MLT = mililitro."
              persistent-hint
              class="mb-2"
            />
            <v-alert
              v-if="product && !((product.units_per_package ?? 1) > 1)"
              type="info"
              density="compact"
              variant="tonal"
              class="mb-3"
            >
              La existencia que ya hay (contada en envases) se convertirá a unidades.
            </v-alert>
          </template>

          <v-row dense>
            <v-col cols="6">
              <v-text-field
                v-model="satProductCode"
                label="Clave de producto (SAT)*"
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
                label="Clave de unidad (SAT)*"
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
