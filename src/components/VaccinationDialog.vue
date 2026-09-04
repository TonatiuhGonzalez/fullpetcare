<script setup lang="ts">
// Aplicar una vacuna (tarea 4.15). Mismo patrón que ServiceFormDialog:
// un v-dialog que se abre/cierra con v-model y llama directo al service
// al guardar. La política RLS de vaccinations (owner o vet) es quien de
// verdad decide si se vale.
import { computed, ref, watch } from 'vue'
import { format } from 'date-fns'

import * as recordsService from '@/services/records'
import type { Vaccination } from '@/services/records'
import * as vaccinesService from '@/services/vaccines'
import type { Vaccine } from '@/services/vaccines'
import { computeNextDueDate } from '@/lib/vaccination'
import { toBranchTime } from '@/lib/datetime'
import type { Database } from '@/types/database'

type PetSpecies = Database['public']['Enums']['pet_species']

const props = defineProps<{
  modelValue: boolean
  tenantId: string
  petId: string
  petSpecies: PetSpecies
  appliedByUserId: string
  branchTimezone: string
  appointmentId?: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [vaccination: Vaccination]
}>()

const vaccines = ref<Vaccine[]>([])
const selectedVaccineId = ref<string | null>(null)
const appliedAtDate = ref('')
const batchNumber = ref('')
const notes = ref('')

const loading = ref(false)
const saving = ref(false)
const errorMessage = ref<string | null>(null)

const selectedVaccine = computed(
  () => vaccines.value.find((v) => v.id === selectedVaccineId.value) ?? null,
)

// Se calcula solo, en vivo, según el intervalo de refuerzo de la vacuna
// elegida — el mismo cálculo que hace la cartilla al mostrar el estado
// de una vacuna (lib/vaccination.ts, tareas 4.6-4.7).
const nextDueDate = computed(() =>
  selectedVaccine.value
    ? computeNextDueDate(appliedAtDate.value, selectedVaccine.value.default_interval_days)
    : null,
)

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return
    selectedVaccineId.value = null
    batchNumber.value = ''
    notes.value = ''
    errorMessage.value = null
    // "Hoy" en la zona de la sucursal, no la del navegador (CLAUDE.md §8.3)
    // — mismo criterio que agenda.ts al elegir el día activo por default.
    appliedAtDate.value = format(toBranchTime(new Date(), props.branchTimezone), 'yyyy-MM-dd')

    loading.value = true
    try {
      vaccines.value = await vaccinesService.listForSpecies(props.tenantId, props.petSpecies)
    } catch {
      errorMessage.value = 'No se pudo cargar el catálogo de vacunas.'
    } finally {
      loading.value = false
    }
  },
)

function close(): void {
  emit('update:modelValue', false)
}

async function handleSubmit(): Promise<void> {
  if (!selectedVaccineId.value) return

  saving.value = true
  errorMessage.value = null
  try {
    const vaccination = await recordsService.addVaccination({
      tenantId: props.tenantId,
      petId: props.petId,
      vaccineId: selectedVaccineId.value,
      appliedByUserId: props.appliedByUserId,
      appliedAt: new Date(`${appliedAtDate.value}T12:00:00`).toISOString(),
      batchNumber: batchNumber.value || null,
      nextDueDate: nextDueDate.value,
      appointmentId: props.appointmentId ?? null,
      notes: notes.value || null,
    })
    emit('saved', vaccination)
    close()
  } catch {
    errorMessage.value = 'No se pudo registrar la vacuna. Revisa tu conexión.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="420"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>Aplicar vacuna</v-card-title>

      <v-card-text>
        <v-form @submit.prevent="handleSubmit">
          <v-select
            v-model="selectedVaccineId"
            :items="vaccines"
            item-title="name"
            item-value="id"
            label="Vacuna"
            :loading="loading"
            required
          />

          <v-text-field v-model="appliedAtDate" label="Fecha de aplicación" type="date" density="compact" />
          <v-text-field v-model="batchNumber" label="Número de lote" density="compact" />
          <v-textarea v-model="notes" label="Notas" rows="2" auto-grow density="compact" />

          <p v-if="nextDueDate" class="text-body-2 text-medium-emphasis">
            Próxima dosis sugerida: {{ nextDueDate }}
          </p>
          <p v-else-if="selectedVaccine" class="text-body-2 text-medium-emphasis">
            Esta vacuna no tiene un esquema de refuerzo fijo.
          </p>

          <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mb-2">
            {{ errorMessage }}
          </v-alert>
        </v-form>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">Cancelar</v-btn>
        <v-btn color="primary" :loading="saving" :disabled="!selectedVaccineId" @click="handleSubmit">
          Registrar
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
