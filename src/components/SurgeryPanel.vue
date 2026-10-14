<script setup lang="ts">
// Cirugía de la consulta (fase 32, PLAN.md D30 punto 9): se aplica un paquete del catálogo (o
// se arma una desde cero) a la cita, y se ajusta renglón por renglón. Los renglones con
// producto bajan la existencia (y aparecen en "Productos y medicamentos usados"); los demás
// se cobran directo. Las reglas (rol, cita no cobrada, existencia) las impone la base.
import { computed, onMounted, ref } from 'vue'

import IconButton from '@/components/IconButton.vue'
import SurgeryLinesEditor from '@/components/SurgeryLinesEditor.vue'
import { formatMXN } from '@/lib/money'
import {
  surgeryKindLabel,
  surgeryLinesProblem,
  type SurgeryLineDraft,
} from '@/lib/surgery'
import * as productsService from '@/services/products'
import type { Product } from '@/services/products'
import * as surgeriesService from '@/services/surgeries'
import type { AppliedSurgeryLine, SurgeryPackageWithItems } from '@/services/surgeries'

const props = defineProps<{
  tenantId: string
  appointmentId: string
}>()

// Avisa que cambió la existencia o los productos usados (para refrescar esa lista).
const emit = defineEmits<{ changed: [] }>()

const applied = ref<AppliedSurgeryLine[]>([])
const packages = ref<SurgeryPackageWithItems[]>([])
const products = ref<Product[]>([])
const loading = ref(false)
const saving = ref(false)
const errorMessage = ref<string | null>(null)

const showDialog = ref(false)
const packageId = ref<string | null>(null)
const lines = ref<SurgeryLineDraft[]>([])

const activePackages = computed(() =>
  packages.value.filter((p) => p.is_active).map((p) => ({ title: p.name, value: p.id })),
)
const appliedTotal = computed(() =>
  applied.value
    .filter((l) => l.is_billable)
    .reduce((sum, l) => sum + l.unit_price_cents * l.quantity, 0),
)

async function load(): Promise<void> {
  loading.value = true
  errorMessage.value = null
  try {
    ;[applied.value, packages.value, products.value] = await Promise.all([
      surgeriesService.listApplied(props.tenantId, props.appointmentId),
      surgeriesService.listPackages(props.tenantId),
      productsService.list(props.tenantId),
    ])
  } catch {
    errorMessage.value = 'No se pudo cargar la cirugía. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function openDialog(): void {
  packageId.value = null
  lines.value = []
  errorMessage.value = null
  showDialog.value = true
}

// Al elegir un paquete se cargan sus renglones como borrador, para ajustarlos antes de aplicar.
function choosePackage(id: string | null): void {
  packageId.value = id
  const pkg = packages.value.find((p) => p.id === id)
  lines.value = (pkg?.items ?? []).map((item) => ({
    key: `${item.id}-${Date.now()}`,
    kind: item.kind,
    productId: item.product_id,
    description: item.description,
    quantity: item.quantity,
    unitPriceCents: item.unit_price_cents,
    taxRateBp: item.tax_rate_bp,
    isBillable: true,
    unit: item.unit === 'unit' ? 'unit' : 'package',
  }))
}

async function apply(): Promise<void> {
  const problem = surgeryLinesProblem(lines.value)
  if (problem) {
    errorMessage.value = problem
    return
  }
  saving.value = true
  errorMessage.value = null
  try {
    await surgeriesService.applyLines(props.appointmentId, packageId.value, lines.value)
    showDialog.value = false
    await load()
    emit('changed')
  } catch (error) {
    errorMessage.value = surgeriesService.errorMessage(error)
  } finally {
    saving.value = false
  }
}

async function remove(line: AppliedSurgeryLine): Promise<void> {
  saving.value = true
  errorMessage.value = null
  try {
    await surgeriesService.removeLine(line.id)
    await load()
    emit('changed')
  } catch (error) {
    errorMessage.value = surgeriesService.errorMessage(error)
  } finally {
    saving.value = false
  }
}

defineExpose({ reload: load })
</script>

<template>
  <section aria-label="Cirugía">
    <div class="d-flex align-center justify-space-between mb-2">
      <p class="text-subtitle-2">Cirugía</p>
      <v-btn
        size="small"
        variant="tonal"
        prepend-icon="mdi-medical-bag"
        @click="openDialog"
      >
        Agregar cirugía
      </v-btn>
    </div>

    <v-alert
      v-if="errorMessage && !showDialog"
      type="error"
      density="compact"
      variant="tonal"
      class="mb-2"
    >
      {{ errorMessage }}
    </v-alert>

    <v-list v-if="applied.length" density="compact" class="mb-2">
      <v-list-item v-for="line in applied" :key="line.id">
        <template #title>{{ line.description }} × {{ line.quantity }}</template>
        <template #subtitle>
          {{ surgeryKindLabel(line.kind) }} ·
          {{ formatMXN(line.unit_price_cents * line.quantity)
          }}{{ line.is_billable ? '' : ' · uso interno' }}
        </template>
        <template #append>
          <IconButton
            icon="mdi-close"
            size="x-small"
            variant="text"
            :disabled="saving"
            aria-label="Quitar renglón de cirugía"
            @click="remove(line)"
          />
        </template>
      </v-list-item>
    </v-list>
    <p v-else-if="!loading" class="text-body-2 text-medium-emphasis mb-2">
      No se ha aplicado ninguna cirugía en esta consulta.
    </p>
    <p v-if="applied.length" class="text-body-2 font-weight-medium text-right">
      Total de cirugía: {{ formatMXN(appliedTotal) }}
    </p>

    <v-dialog v-model="showDialog" max-width="760" scrollable>
      <v-card>
        <v-card-title>Agregar cirugía</v-card-title>
        <v-card-text>
          <v-autocomplete
            :model-value="packageId"
            :items="activePackages"
            label="Cirugía del catálogo"
            variant="outlined"
            density="comfortable"
            clearable
            hint="Elige un paquete y ajusta sus renglones, o déjalo vacío para armarla desde cero."
            persistent-hint
            no-data-text="No hay cirugías en el catálogo"
            class="mb-4"
            @update:model-value="choosePackage"
          />
          <SurgeryLinesEditor v-model="lines" :products="products" show-billable />
          <v-alert
            v-if="errorMessage"
            type="error"
            density="compact"
            variant="tonal"
            class="mt-4"
          >
            {{ errorMessage }}
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showDialog = false">Cancelar</v-btn>
          <v-btn
            color="primary"
            :loading="saving"
            :disabled="lines.length === 0"
            @click="apply"
          >
            Aplicar a la cita
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>
