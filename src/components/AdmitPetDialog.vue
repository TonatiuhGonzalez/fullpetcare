<script setup lang="ts">
// Ingresar una mascota a hospitalización (fase 33, PLAN.md D30 punto 10): mascota, espacio y
// cómo se cobra (por día o por estancia, con la tarifa sugerida del espacio o del negocio).
import { computed, ref, watch } from 'vue'

import { RATE_MODE_OPTIONS, suggestedRate, type RateMode } from '@/lib/hospitalization'
import { formatMXN, pesosToCents } from '@/lib/money'
import * as hospitalService from '@/services/hospitalization'
import type { HospitalSettings, HospitalSpace } from '@/services/hospitalization'
import * as petsService from '@/services/pets'
import type { Pet } from '@/services/pets'

const props = defineProps<{
  modelValue: boolean
  tenantId: string
  branchId: string
  spaces: HospitalSpace[]
  settings: HospitalSettings | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  admitted: [stayId: string]
}>()

const pets = ref<Pet[]>([])
const petId = ref<string | null>(null)
const spaceId = ref<string | null>(null)
const rateMode = ref<RateMode>('per_day')
const rateInPesos = ref<number | null>(null)
const reason = ref('')
const saving = ref(false)
const errorMessage = ref<string | null>(null)

const activeSpaces = computed(() => props.spaces.filter((s) => s.is_active))
const petItems = computed(() => pets.value.map((p) => ({ title: p.name, value: p.id })))
const spaceItems = computed(() =>
  activeSpaces.value.map((s) => ({
    title: s.space_type ? `${s.name} · ${s.space_type}` : s.name,
    value: s.id,
  })),
)
const selectedSpace = computed(
  () => props.spaces.find((s) => s.id === spaceId.value) ?? null,
)

function applySuggestedRate(): void {
  const cents = suggestedRate(rateMode.value, selectedSpace.value, props.settings)
  rateInPesos.value = cents === null ? null : cents / 100
}

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return
    petId.value = null
    spaceId.value = activeSpaces.value[0]?.id ?? null
    rateMode.value = 'per_day'
    reason.value = ''
    errorMessage.value = null
    applySuggestedRate()
    try {
      pets.value = await petsService.list(props.tenantId)
    } catch {
      errorMessage.value = 'No se pudo cargar la lista de mascotas. Revisa tu conexión.'
    }
  },
)

watch([spaceId, rateMode], applySuggestedRate)

function close(): void {
  emit('update:modelValue', false)
}

async function handleSubmit(): Promise<void> {
  if (!petId.value) {
    errorMessage.value = 'Elige la mascota.'
    return
  }
  if (!spaceId.value) {
    errorMessage.value = 'Elige el espacio.'
    return
  }
  if (rateInPesos.value === null || rateInPesos.value < 0) {
    errorMessage.value = 'Captura la tarifa (0 si no se cobra).'
    return
  }
  saving.value = true
  errorMessage.value = null
  try {
    const stayId = await hospitalService.admit({
      petId: petId.value,
      spaceId: spaceId.value,
      rateMode: rateMode.value,
      rateCents: pesosToCents(rateInPesos.value),
      reason: reason.value.trim() || null,
    })
    emit('admitted', stayId)
    close()
  } catch (error) {
    errorMessage.value = hospitalService.errorMessage(error)
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
      <v-card-title>Ingresar mascota</v-card-title>
      <v-card-text>
        <v-autocomplete
          v-model="petId"
          :items="petItems"
          label="Mascota*"
          variant="outlined"
          density="comfortable"
          no-data-text="No hay mascotas registradas"
          class="mb-2"
        />
        <v-select
          v-model="spaceId"
          :items="spaceItems"
          label="Espacio*"
          variant="outlined"
          density="comfortable"
          no-data-text="No hay espacios. Créalos en Configuración → Hospitalización."
          class="mb-2"
        />
        <v-select
          v-model="rateMode"
          :items="RATE_MODE_OPTIONS"
          label="Tarifa*"
          variant="outlined"
          density="comfortable"
          class="mb-2"
        />
        <v-text-field
          v-model.number="rateInPesos"
          :label="
            rateMode === 'per_day'
              ? 'Tarifa por día (MXN, con IVA)*'
              : 'Monto de la estancia (MXN, con IVA)*'
          "
          type="number"
          min="0"
          step="0.01"
          variant="outlined"
          density="comfortable"
          :hint="
            rateInPesos !== null
              ? `Se cobrará ${rateMode === 'per_day' ? 'por cada día' : 'una sola vez'}: ${formatMXN(pesosToCents(rateInPesos))}`
              : undefined
          "
          persistent-hint
          class="mb-2"
        />
        <v-textarea
          v-model="reason"
          label="Motivo del ingreso"
          rows="2"
          auto-grow
          variant="outlined"
          density="comfortable"
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
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">Cancelar</v-btn>
        <v-btn color="primary" :loading="saving" @click="handleSubmit">Ingresar</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
