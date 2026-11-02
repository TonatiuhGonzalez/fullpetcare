<script setup lang="ts">
// Especie, raza y edad de una mascota (fase 27, PLAN.md D30 puntos 1 y 2). Lo comparten los
// tres formularios de mascota (alta de cliente con mascota, nueva mascota y edición), para
// que digan y se comporten igual:
//  - Especie: del catálogo del negocio, agrupada (Perros, Aves, Reptiles…).
//  - Raza: buscador que entiende variantes ("xolo", "teckel") y solo aparece si la especie
//    lleva razas. Una mascota anterior al catálogo con raza escrita a mano la conserva.
//  - Edad: la fecha de nacimiento se captura directa o se PROPONE a partir de "años y
//    meses"; una fecha calculada queda marcada como aproximada.
// Es un componente "tonto": no habla con Supabase, recibe el catálogo ya cargado.
import { computed, ref, watch } from 'vue'

import { ageFromBirthDate, ageProblem, birthDateFromAge, formatAge } from '@/lib/petAge'
import { filterBreeds } from '@/lib/speciesCatalog'
import { required } from '@/lib/validation'
import type { Breed } from '@/services/breeds'
import type { Species, SpeciesGroup } from '@/services/species'
import type { Database } from '@/types/database'

type PetSpecies = Database['public']['Enums']['pet_species']

const props = defineProps<{
  groups: SpeciesGroup[]
  species: Species[]
  breeds: Breed[]
  // Hoy en la zona de la sucursal (`yyyy-MM-dd`): sirve para calcular la edad sin leer el reloj.
  today: string
  // En una mascota nueva la especie es obligatoria; al editar una anterior al catálogo puede
  // quedarse sin especie de catálogo (conserva el valor del enum).
  requireSpecies?: boolean
  disabled?: boolean
}>()

const speciesId = defineModel<string | null>('speciesId', { default: null })
const breedId = defineModel<string | null>('breedId', { default: null })
// La raza escrita (columna `breed`): se mantiene igual a la del catálogo para que la
// búsqueda, la vista pública y el historial sigan mostrando la raza sin cambios.
const breedText = defineModel<string>('breedText', { default: '' })
// Valor del enum `pet_species` que corresponde a la especie elegida (vacunas por especie).
const legacySpecies = defineModel<PetSpecies>('legacySpecies', { default: 'dog' })
const birthDate = defineModel<string>('birthDate', { default: '' })
const birthDateIsEstimated = defineModel<boolean>('birthDateIsEstimated', {
  default: false,
})

const selectedSpecies = computed(
  () => props.species.find((s) => s.id === speciesId.value) ?? null,
)

// Especies agrupadas, con el título del grupo como encabezado dentro de la lista.
const speciesItems = computed(() => {
  const items: Array<Record<string, unknown>> = []
  for (const group of props.groups) {
    const inGroup = props.species.filter((s) => s.group_id === group.id)
    if (inGroup.length === 0) continue
    items.push({ type: 'subheader', title: group.name })
    for (const s of inGroup) items.push({ title: s.name, value: s.id })
  }
  return items
})

// Razas de la especie elegida, filtradas por lo que se escribe en el buscador.
const breedSearch = ref('')
const speciesBreeds = computed(() =>
  props.breeds.filter((b) => b.species_id === speciesId.value),
)
const breedItems = computed(() =>
  filterBreeds(speciesBreeds.value, breedSearch.value).map((b) => ({
    title: b.name,
    value: b.id,
  })),
)

const showBreedPicker = computed(() => !!selectedSpecies.value?.has_breeds)
// Una mascota anterior al catálogo (sin especie de catálogo) conserva su raza escrita.
const showLegacyBreedText = computed(() => !speciesId.value && breedText.value !== '')

function onSpeciesChange(id: string | null): void {
  speciesId.value = id
  const chosen = props.species.find((s) => s.id === id) ?? null
  if (chosen) legacySpecies.value = chosen.legacy_kind
  // La raza era de la especie anterior: no se arrastra.
  breedId.value = null
  breedText.value = ''
  breedSearch.value = ''
}

function onBreedChange(id: string | null): void {
  breedId.value = id
  const chosen = props.breeds.find((b) => b.id === id) ?? null
  breedText.value = chosen?.name ?? ''
}

// ── Edad ────────────────────────────────────────────────────────────────────
const years = ref<number | string>('')
const months = ref<number | string>('')
const showAgeCalculator = ref(false)

const ageFieldProblem = computed(() => {
  if (years.value === '' && months.value === '') return null
  return ageProblem(years.value, months.value)
})

const canCalculate = computed(
  () => (years.value !== '' || months.value !== '') && ageFieldProblem.value === null,
)

function applyAge(): void {
  if (!canCalculate.value) return
  const y = years.value === '' ? 0 : Number(years.value)
  const m = months.value === '' ? 0 : Number(months.value)
  birthDate.value = birthDateFromAge(props.today, y, m)
  birthDateIsEstimated.value = true
  showAgeCalculator.value = false
}

// Escribir o cambiar la fecha a mano la vuelve un dato capturado, no una propuesta.
function onBirthDateInput(value: string): void {
  birthDate.value = value
  birthDateIsEstimated.value = false
}

const currentAge = computed(() => {
  if (!birthDate.value) return null
  const age = ageFromBirthDate(birthDate.value, props.today)
  return age ? formatAge(age) : null
})

const birthDateFuture = computed(
  () => birthDate.value !== '' && ageFromBirthDate(birthDate.value, props.today) === null,
)

// Al cerrar y abrir otro formulario con el mismo componente, la calculadora vuelve a vacío.
watch(birthDate, (value) => {
  if (value === '') {
    years.value = ''
    months.value = ''
  }
})
</script>

<template>
  <div>
    <v-row dense>
      <v-col cols="12" sm="6">
        <v-select
          :model-value="speciesId"
          :items="speciesItems"
          label="Especie*"
          :rules="requireSpecies ? [required] : []"
          :disabled="disabled"
          :placeholder="
            !speciesId && legacySpecies === 'other' ? 'Otra (sin especie)' : undefined
          "
          @update:model-value="onSpeciesChange"
        />
      </v-col>
      <v-col cols="12" sm="6">
        <v-autocomplete
          v-if="showBreedPicker"
          :model-value="breedId"
          v-model:search="breedSearch"
          :items="breedItems"
          label="Raza"
          variant="outlined"
          density="comfortable"
          no-filter
          clearable
          :disabled="disabled"
          no-data-text="Sin coincidencias. Agrégala en Configuración → Especies y razas."
          @update:model-value="onBreedChange"
        />
        <v-text-field
          v-else-if="showLegacyBreedText"
          v-model="breedText"
          label="Raza"
          :disabled="disabled"
        />
      </v-col>
    </v-row>

    <v-row dense>
      <v-col cols="12" sm="6">
        <v-text-field
          :model-value="birthDate"
          label="Fecha de nacimiento"
          type="date"
          :max="today"
          :disabled="disabled"
          :error-messages="birthDateFuture ? 'La fecha no puede ser futura.' : undefined"
          :hint="
            birthDateIsEstimated
              ? 'Fecha aproximada, calculada por la edad.'
              : currentAge
                ? `Edad: ${currentAge}`
                : undefined
          "
          persistent-hint
          @update:model-value="onBirthDateInput"
        />
      </v-col>
      <v-col cols="12" sm="6" class="d-flex align-center">
        <v-btn
          variant="text"
          color="primary"
          prepend-icon="mdi-calendar-question"
          :disabled="disabled"
          @click="showAgeCalculator = !showAgeCalculator"
        >
          No sé la fecha: calcular por edad
        </v-btn>
      </v-col>
    </v-row>

    <v-expand-transition>
      <div v-if="showAgeCalculator" class="mb-2">
        <v-row dense align="start">
          <v-col cols="5" sm="3">
            <v-text-field
              v-model="years"
              label="Años"
              type="number"
              min="0"
              :error="!!ageFieldProblem"
            />
          </v-col>
          <v-col cols="5" sm="3">
            <v-text-field
              v-model="months"
              label="Meses"
              type="number"
              min="0"
              max="11"
              :error="!!ageFieldProblem"
            />
          </v-col>
          <v-col cols="12" sm="6" class="d-flex align-center">
            <v-btn
              color="primary"
              variant="tonal"
              :disabled="!canCalculate"
              @click="applyAge"
            >
              Usar fecha propuesta
            </v-btn>
          </v-col>
        </v-row>
        <div v-if="ageFieldProblem" class="text-caption text-error">
          {{ ageFieldProblem }}
        </div>
        <div v-else-if="canCalculate" class="text-caption text-medium-emphasis">
          Fecha propuesta:
          {{
            birthDateFromAge(
              today,
              years === '' ? 0 : Number(years),
              months === '' ? 0 : Number(months),
            )
          }}. Podrás ajustarla.
        </div>
      </div>
    </v-expand-transition>
  </div>
</template>
