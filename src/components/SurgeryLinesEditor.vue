<script setup lang="ts">
// Editor de renglones de una cirugía (fase 32, PLAN.md D30 punto 9): lo usan el catálogo de
// paquetes y la cita (para ajustar un paquete o armar una cirugía desde cero). Cada renglón es
// un honorario, un consumible o un medicamento; los dos últimos pueden ligarse a un producto
// del inventario (y entonces bajan existencia) o quedar sin producto.
import { computed } from 'vue'

import IconButton from '@/components/IconButton.vue'
import { isFractional, priceForUnit } from '@/lib/fractional'
import { formatMXN, pesosToCents } from '@/lib/money'
import {
  SURGERY_KIND_OPTIONS,
  lineTotalCents,
  surgeryTotalCents,
  type SurgeryItemKind,
  type SurgeryLineDraft,
} from '@/lib/surgery'
import type { Product } from '@/services/products'

const props = defineProps<{
  products: Product[]
  /** Muestra el interruptor "Se cobra" (al aplicar a una cita; en el catálogo todo se cobra). */
  showBillable?: boolean
}>()

const lines = defineModel<SurgeryLineDraft[]>({ required: true })

let counter = 0
function newKey(): string {
  counter += 1
  return `line-${Date.now()}-${counter}`
}

const productItems = computed(() =>
  props.products.filter((p) => p.is_active).map((p) => ({ title: p.name, value: p.id })),
)

function productOf(id: string | null): Product | null {
  return id ? (props.products.find((p) => p.id === id) ?? null) : null
}

function addLine(kind: SurgeryItemKind = 'fee'): void {
  lines.value = [
    ...lines.value,
    {
      key: newKey(),
      kind,
      productId: null,
      description: '',
      quantity: 1,
      unitPriceCents: 0,
      taxRateBp: 1600,
      isBillable: true,
      unit: 'package',
    },
  ]
}

function update(key: string, changes: Partial<SurgeryLineDraft>): void {
  lines.value = lines.value.map((l) => (l.key === key ? { ...l, ...changes } : l))
}

function remove(key: string): void {
  lines.value = lines.value.filter((l) => l.key !== key)
}

function onKind(line: SurgeryLineDraft, kind: SurgeryItemKind): void {
  // Un honorario no lleva producto.
  update(line.key, {
    kind,
    ...(kind === 'fee' ? { productId: null, unit: 'package' as const } : {}),
  })
}

/** Al elegir un producto se propone su nombre, su precio y su IVA; todo se puede corregir. */
function onProduct(line: SurgeryLineDraft, productId: string | null): void {
  const product = productOf(productId)
  if (!product) {
    update(line.key, { productId: null })
    return
  }
  update(line.key, {
    productId,
    unit: 'package',
    description: line.description.trim() === '' ? product.name : line.description,
    unitPriceCents: product.price_cents,
    taxRateBp: product.tax_rate_bp,
  })
}

/** Cambia envase/unidad de un producto fraccionado y vuelve a proponer el precio. */
function onUnit(line: SurgeryLineDraft, unit: 'package' | 'unit' | null): void {
  const product = productOf(line.productId)
  if (!product || unit === null) return
  update(line.key, {
    unit,
    unitPriceCents: priceForUnit(unit, product.price_cents, {
      unitsPerPackage: product.units_per_package,
      unitPriceCents: product.unit_price_cents,
    }),
  })
}

function fractional(line: SurgeryLineDraft): boolean {
  const product = productOf(line.productId)
  return !!product && isFractional({ unitsPerPackage: product.units_per_package })
}

function unitLabels(line: SurgeryLineDraft): { package: string; unit: string } {
  const product = productOf(line.productId)
  return {
    package: product?.package_name ?? 'Envase',
    unit: product?.unit_name ?? 'Unidad',
  }
}

const total = computed(() => surgeryTotalCents(lines.value))

defineExpose({ addLine })
</script>

<template>
  <div>
    <p v-if="lines.length === 0" class="text-body-2 text-medium-emphasis mb-3">
      Aún no hay renglones. Agrega honorarios, consumibles o medicamentos.
    </p>

    <v-card
      v-for="(line, index) in lines"
      :key="line.key"
      variant="outlined"
      class="pa-3 mb-3"
    >
      <div class="d-flex align-start ga-2">
        <v-select
          :model-value="line.kind"
          :items="SURGERY_KIND_OPTIONS"
          label="Tipo"
          variant="outlined"
          density="compact"
          hide-details
          style="max-width: 160px"
          @update:model-value="onKind(line, $event)"
        />
        <v-autocomplete
          v-if="line.kind !== 'fee'"
          :model-value="line.productId"
          :items="productItems"
          label="Producto (opcional)"
          variant="outlined"
          density="compact"
          hide-details
          clearable
          no-data-text="Sin productos"
          @update:model-value="onProduct(line, $event)"
        />
        <v-spacer v-else />
        <IconButton
          icon="mdi-delete-outline"
          variant="text"
          color="error"
          size="small"
          :aria-label="`Quitar renglón ${index + 1}`"
          @click="remove(line.key)"
        />
      </div>

      <v-text-field
        :model-value="line.description"
        label="Descripción*"
        variant="outlined"
        density="compact"
        hide-details
        class="mt-2"
        @update:model-value="update(line.key, { description: String($event ?? '') })"
      />

      <div class="d-flex flex-wrap align-center ga-2 mt-2">
        <v-btn-toggle
          v-if="fractional(line)"
          :model-value="line.unit"
          mandatory
          density="compact"
          color="primary"
          variant="outlined"
          divided
          @update:model-value="onUnit(line, $event)"
        >
          <v-btn value="package" size="small">{{ unitLabels(line).package }}</v-btn>
          <v-btn value="unit" size="small">{{ unitLabels(line).unit }}</v-btn>
        </v-btn-toggle>
        <v-text-field
          :model-value="line.quantity"
          label="Cantidad"
          type="number"
          min="1"
          step="1"
          variant="outlined"
          density="compact"
          hide-details
          style="max-width: 110px"
          @update:model-value="update(line.key, { quantity: Number($event) })"
        />
        <v-text-field
          :model-value="line.unitPriceCents / 100"
          label="Precio (MXN, con IVA)"
          type="number"
          min="0"
          step="0.01"
          variant="outlined"
          density="compact"
          hide-details
          style="max-width: 170px"
          @update:model-value="
            update(line.key, {
              unitPriceCents:
                $event === '' || $event === null ? 0 : pesosToCents(Number($event)),
            })
          "
        />
        <v-switch
          v-if="showBillable"
          :model-value="line.isBillable"
          label="Se cobra"
          color="primary"
          density="compact"
          hide-details
          @update:model-value="update(line.key, { isBillable: !!$event })"
        />
        <v-spacer />
        <span class="text-body-2 font-weight-medium">{{
          formatMXN(lineTotalCents(line))
        }}</span>
      </div>
    </v-card>

    <div class="d-flex flex-wrap align-center ga-2">
      <v-btn variant="outlined" prepend-icon="mdi-plus" @click="addLine('fee')"
        >Honorario</v-btn
      >
      <v-btn variant="outlined" prepend-icon="mdi-plus" @click="addLine('consumable')">
        Consumible
      </v-btn>
      <v-btn variant="outlined" prepend-icon="mdi-plus" @click="addLine('medication')">
        Medicamento
      </v-btn>
      <v-spacer />
      <span class="text-subtitle-1 font-weight-bold">Total {{ formatMXN(total) }}</span>
    </div>
  </div>
</template>
