<script setup lang="ts">
// Receta de la consulta (fase 28, PLAN.md D30 punto 3): el veterinario captura los
// medicamentos con dosis, frecuencia y duración, y la imprime. El medicamento se elige del
// catálogo de productos o se escribe a mano; los escritos a mano le llegan al dueño del
// negocio como aviso para que los registre. La regla de quién puede emitirla (dueño o el
// veterinario de la cita, con cédula) la impone la base; aquí solo se captura.
import { onMounted, ref } from 'vue'

import IconButton from '@/components/IconButton.vue'
import {
  MAX_PRESCRIPTION_ITEMS,
  prescriptionFolioLabel,
  prescriptionProblem,
  toRpcItems,
  type PrescriptionDraftItem,
} from '@/lib/prescription'
import * as prescriptionsService from '@/services/prescriptions'
import type { PrescriptionWithItems } from '@/services/prescriptions'
import * as productsService from '@/services/products'
import type { Product } from '@/services/products'

const props = defineProps<{
  tenantId: string
  appointmentId: string
}>()

const emit = defineEmits<{ saved: [] }>()

interface ComboItem {
  title: string
  value: string
}

const loading = ref(false)
const saving = ref(false)
const errorMessage = ref<string | null>(null)
const savedNotice = ref(false)

const prescription = ref<PrescriptionWithItems | null>(null)
const items = ref<PrescriptionDraftItem[]>([])
const products = ref<Product[]>([])
const catalog = ref<ComboItem[]>([])

let nextKey = 0
function newItem(partial: Partial<PrescriptionDraftItem> = {}): PrescriptionDraftItem {
  nextKey += 1
  return {
    key: `item-${nextKey}`,
    productId: null,
    medicationName: '',
    dose: '',
    frequency: '',
    duration: '',
    ...partial,
  }
}

async function load(): Promise<void> {
  loading.value = true
  errorMessage.value = null
  try {
    const [existing, list] = await Promise.all([
      prescriptionsService.getByAppointment(props.tenantId, props.appointmentId),
      productsService.list(props.tenantId),
    ])
    prescription.value = existing
    products.value = list
    catalog.value = list
      .filter((p) => p.is_active)
      .map((p) => ({ title: p.name, value: p.id }))
    items.value = existing
      ? existing.items.map((row) =>
          newItem({
            productId: row.product_id,
            medicationName: row.medication_name,
            dose: row.dose ?? '',
            frequency: row.frequency ?? '',
            duration: row.duration ?? '',
          }),
        )
      : []
  } catch {
    errorMessage.value = 'No se pudo cargar la receta. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function addItem(): void {
  if (items.value.length >= MAX_PRESCRIPTION_ITEMS) return
  items.value.push(newItem())
}

function removeItem(key: string): void {
  items.value = items.value.filter((item) => item.key !== key)
}

// El combobox entrega el elemento del catálogo (con su id) o el texto escrito a mano.
function onMedicationChange(
  item: PrescriptionDraftItem,
  value: ComboItem | string | null,
): void {
  if (value === null || value === '') {
    item.productId = null
    item.medicationName = ''
  } else if (typeof value === 'string') {
    item.productId = null
    item.medicationName = value
  } else {
    item.productId = value.value
    item.medicationName = value.title
  }
}

function comboValue(item: PrescriptionDraftItem): ComboItem | string | null {
  if (item.medicationName === '') return null
  return item.productId
    ? { title: item.medicationName, value: item.productId }
    : item.medicationName
}

async function save(): Promise<void> {
  const problem = prescriptionProblem(items.value)
  if (problem) {
    errorMessage.value = problem
    return
  }
  saving.value = true
  errorMessage.value = null
  savedNotice.value = false
  try {
    await prescriptionsService.save(props.appointmentId, toRpcItems(items.value))
    await load()
    savedNotice.value = true
    emit('saved')
  } catch (error) {
    errorMessage.value = prescriptionsService.saveErrorMessage(error)
  } finally {
    saving.value = false
  }
}

defineExpose({ reload: load })
</script>

<template>
  <div>
    <div class="d-flex align-center justify-space-between mb-2">
      <div>
        <p class="text-subtitle-2">Receta</p>
        <p v-if="prescription" class="text-caption text-medium-emphasis">
          {{ prescriptionFolioLabel(prescription.folio) }} · emitida por
          {{ prescription.issuer_name_snapshot }} (cédula
          {{ prescription.issuer_license_snapshot }})
        </p>
      </div>
      <v-btn
        v-if="prescription"
        size="small"
        variant="tonal"
        prepend-icon="mdi-printer"
        :to="`/app/citas/${appointmentId}/receta`"
      >
        Imprimir
      </v-btn>
    </div>

    <v-alert
      v-if="errorMessage"
      type="error"
      density="compact"
      variant="tonal"
      class="mb-3"
    >
      {{ errorMessage }}
    </v-alert>
    <v-alert
      v-if="savedNotice"
      type="success"
      density="compact"
      variant="tonal"
      class="mb-3"
    >
      Receta guardada.
    </v-alert>

    <p
      v-if="!loading && items.length === 0"
      class="text-body-2 text-medium-emphasis mb-3"
    >
      Aún no hay medicamentos en la receta.
    </p>

    <v-card
      v-for="(item, index) in items"
      :key="item.key"
      variant="outlined"
      class="pa-3 mb-3"
      :data-testid="`prescription-item-${index}`"
    >
      <div class="d-flex align-start ga-2">
        <v-combobox
          :model-value="comboValue(item)"
          :items="catalog"
          item-title="title"
          item-value="value"
          :label="`Medicamento ${index + 1}*`"
          hint="Elige del catálogo o escribe uno nuevo."
          persistent-hint
          variant="outlined"
          density="comfortable"
          class="flex-grow-1"
          @update:model-value="
            (value) => onMedicationChange(item, value as ComboItem | string | null)
          "
        />
        <IconButton
          icon="mdi-delete-outline"
          variant="text"
          color="error"
          size="small"
          :aria-label="`Quitar medicamento ${index + 1}`"
          class="mt-2"
          @click="removeItem(item.key)"
        />
      </div>
      <v-row dense class="mt-1">
        <v-col cols="12" sm="4">
          <v-text-field
            v-model="item.dose"
            label="Dosis"
            density="comfortable"
            hide-details
          />
        </v-col>
        <v-col cols="12" sm="4">
          <v-text-field
            v-model="item.frequency"
            label="Frecuencia"
            density="comfortable"
            hide-details
          />
        </v-col>
        <v-col cols="12" sm="4">
          <v-text-field
            v-model="item.duration"
            label="Duración"
            density="comfortable"
            hide-details
          />
        </v-col>
      </v-row>
    </v-card>

    <div class="d-flex align-center ga-2">
      <v-btn
        variant="outlined"
        prepend-icon="mdi-plus"
        :disabled="items.length >= MAX_PRESCRIPTION_ITEMS"
        @click="addItem"
      >
        Agregar medicamento
      </v-btn>
      <v-btn color="primary" :loading="saving" :disabled="loading" @click="save">
        {{ prescription ? 'Guardar cambios' : 'Emitir receta' }}
      </v-btn>
    </div>
  </div>
</template>
