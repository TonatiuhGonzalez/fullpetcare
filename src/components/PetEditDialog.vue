<script setup lang="ts">
// Modal de mascota de la pantalla de Clientes (fase 14, tarea 14.5): va directo a
// la edición, sin vista previa. De arriba abajo: foto centrada (al presionarla se
// cambia), línea Nombre · raza · sexo · ícono de esterilización, especie y dueño,
// nacimiento, peso (el último, solo lectura), preferencia de corte, alertas
// médicas, cartilla de vacunación en tabla, historial de peso y "Compartir con el
// cliente". Debajo se conservan las próximas citas y el historial de visitas.
//
// Solo dueño y recepción editan (pets_update); groomer y vet ven los mismos datos
// con los campos bloqueados. No reemplaza a PetDetailDialog: la agenda lo sigue usando.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { format } from 'date-fns'

import * as customersService from '@/services/customers'
import * as petsService from '@/services/pets'
import type { Pet, PetWeight } from '@/services/pets'
import * as recordsService from '@/services/records'
import type { VaccinationWithName } from '@/services/records'
import * as vaccinesService from '@/services/vaccines'
import type { Vaccine } from '@/services/vaccines'
import * as appointmentsService from '@/services/appointments'
import type { UpcomingAppointment } from '@/services/appointments'
import * as petHistoryService from '@/services/petHistory'
import type { TimelineEntry } from '@/lib/timeline'
import { formatDate, formatTime } from '@/lib/datetime'
import { speciesLabel, sterilizationIndicator } from '@/lib/petLabels'
import { isFrontDesk, visibleTimelineTypes } from '@/lib/roles'
import { buildVaccineTableRows } from '@/lib/vaccination'
import { useSessionStore } from '@/stores/session'
import type { Database } from '@/types/database'
import VaccinationDialog from '@/components/VaccinationDialog.vue'
import WeightChart from '@/components/WeightChart.vue'
import PetTimeline from '@/components/PetTimeline.vue'
import ShareLinkManager from '@/components/ShareLinkManager.vue'

type PetSpecies = Database['public']['Enums']['pet_species']
type PetSex = Database['public']['Enums']['pet_sex']

const props = defineProps<{
  modelValue: boolean
  /** null cuando no hay ninguna mascota seleccionada todavía. */
  petId: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** Se guardó la mascota: el listado debe recargar sus filas. */
  saved: []
}>()

const session = useSessionStore()

const pet = ref<Pet | null>(null)
const ownerName = ref('')
const weights = ref<PetWeight[]>([])
const vaccinations = ref<VaccinationWithName[]>([])
const catalog = ref<Vaccine[]>([])
const timeline = ref<TimelineEntry[]>([])
const upcomingAppointments = ref<UpcomingAppointment[]>([])
const photoUrl = ref<string | null>(null)
const loading = ref(false)
const saving = ref(false)
const errorMessage = ref<string | null>(null)

// Campos del formulario
const name = ref('')
const species = ref<PetSpecies>('dog')
const breed = ref('')
const sex = ref<PetSex | null>(null)
const birthDate = ref('')
const isSterilized = ref(false)
const groomingNotes = ref('')
const medicalAlerts = ref('')
// Foto elegida pero todavía sin guardar: se sube al presionar "Guardar".
const photoFile = ref<File | null>(null)
const photoPreviewUrl = ref<string | null>(null)
const photoInput = ref<HTMLInputElement | null>(null)

const showVaccinationDialog = ref(false)

const canEdit = computed(() => isFrontDesk(session.role))
// vaccinations_insert: solo dueño y veterinario.
const canRegisterVaccine = computed(
  () => session.role === 'owner' || session.role === 'vet',
)

const speciesOptions = (['dog', 'cat', 'other'] as PetSpecies[]).map((value) => ({
  value,
  title: speciesLabel(value),
}))
const sexOptions: Array<{ value: PetSex | null; title: string }> = [
  { value: null, title: 'No especificado' },
  { value: 'male', title: 'Macho' },
  { value: 'female', title: 'Hembra' },
]

const sterilization = computed(() => sterilizationIndicator(isSterilized.value))

const currentWeightKg = computed(() => {
  const latest = weights.value[0]
  return latest ? (latest.weight_grams / 1000).toFixed(1) : null
})

// Fechas con la zona de la sucursal activa (CLAUDE.md §8.3), igual que PetDetailDialog.
const displayTimezone = computed(
  () => session.activeBranch?.timezone ?? 'America/Mexico_City',
)

const vaccineRows = computed(() =>
  buildVaccineTableRows(
    catalog.value,
    vaccinations.value,
    format(new Date(), 'yyyy-MM-dd'),
  ),
)

const visibleTimeline = computed(() =>
  timeline.value.filter((entry) =>
    visibleTimelineTypes(session.role).includes(entry.type),
  ),
)

const displayedPhoto = computed(() => photoPreviewUrl.value ?? photoUrl.value)

function fillForm(p: Pet): void {
  name.value = p.name
  species.value = p.species
  breed.value = p.breed ?? ''
  sex.value = p.sex
  birthDate.value = p.birth_date ?? ''
  isSterilized.value = p.is_sterilized
  groomingNotes.value = p.grooming_notes ?? ''
  medicalAlerts.value = p.medical_alerts ?? ''
}

function clearPhotoSelection(): void {
  if (photoPreviewUrl.value) URL.revokeObjectURL(photoPreviewUrl.value)
  photoPreviewUrl.value = null
  photoFile.value = null
}
onBeforeUnmount(clearPhotoSelection)

async function loadVaccines(p: Pet): Promise<void> {
  const [applied, vaccineCatalog] = await Promise.all([
    recordsService.listVaccinationsByPet(p.tenant_id, p.id),
    vaccinesService.listForSpecies(p.tenant_id, p.species),
  ])
  vaccinations.value = applied
  catalog.value = vaccineCatalog
}

async function load(id: string): Promise<void> {
  if (!session.activeTenantId) return
  const tenantId = session.activeTenantId
  loading.value = true
  errorMessage.value = null
  try {
    const foundPet = await petsService.getById(tenantId, id)
    if (!foundPet) {
      errorMessage.value = 'No se encontró la mascota.'
      return
    }
    const [owner, weightHistory, historyTimeline, upcoming] = await Promise.all([
      customersService.getById(tenantId, foundPet.customer_id),
      petsService.listWeights(tenantId, id),
      petHistoryService.getTimeline(tenantId, id),
      appointmentsService.listUpcomingByPet(tenantId, id),
      loadVaccines(foundPet),
    ])
    pet.value = foundPet
    ownerName.value = owner ? `${owner.first_name} ${owner.last_name}` : ''
    weights.value = weightHistory
    timeline.value = historyTimeline
    upcomingAppointments.value = upcoming
    photoUrl.value = foundPet.photo_path
      ? await petsService.getPhotoUrl(foundPet.photo_path)
      : null
    fillForm(foundPet)
  } catch {
    errorMessage.value = 'No se pudo cargar la mascota. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

// Se recarga cada vez que el diálogo se abre (o cambia de mascota).
watch(
  () => [props.modelValue, props.petId] as const,
  ([open, id]) => {
    if (!open || !id) return
    pet.value = null
    clearPhotoSelection()
    load(id)
  },
  { immediate: true },
)

function pickPhoto(): void {
  if (canEdit.value) photoInput.value?.click()
}

function handlePhotoChosen(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  clearPhotoSelection()
  photoFile.value = file
  photoPreviewUrl.value = URL.createObjectURL(file)
}

function close(): void {
  emit('update:modelValue', false)
}

async function handleSubmit(): Promise<void> {
  if (!pet.value || !canEdit.value) return
  if (!name.value.trim()) {
    errorMessage.value = 'Falta el nombre de la mascota.'
    return
  }
  saving.value = true
  errorMessage.value = null
  try {
    let saved = await petsService.update(pet.value.id, {
      name: name.value,
      species: species.value,
      breed: breed.value || null,
      sex: sex.value,
      birth_date: birthDate.value || null,
      is_sterilized: isSterilized.value,
      grooming_notes: groomingNotes.value || null,
      medical_alerts: medicalAlerts.value || null,
    })
    if (photoFile.value) {
      const photoPath = await petsService.uploadPhoto(
        saved.tenant_id,
        saved.id,
        photoFile.value,
      )
      saved = await petsService.update(saved.id, { photo_path: photoPath })
    }
    emit('saved')
    close()
  } catch {
    errorMessage.value = 'No se pudo guardar la mascota. Revisa tu conexión.'
  } finally {
    saving.value = false
  }
}

async function handleVaccinationSaved(): Promise<void> {
  if (pet.value) await loadVaccines(pet.value)
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="720"
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <span>{{ pet?.name ?? 'Mascota' }}</span>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" aria-label="Cerrar" @click="close" />
      </v-card-title>

      <v-card-text>
        <v-progress-circular v-if="loading && !pet" indeterminate color="primary" />

        <template v-else-if="pet">
          <!-- Foto centrada; presionarla abre el selector de archivos. -->
          <div class="d-flex justify-center mb-4">
            <v-avatar
              size="120"
              color="primary"
              :class="{ 'pet-photo--editable': canEdit }"
              :role="canEdit ? 'button' : undefined"
              :aria-label="canEdit ? 'Cambiar foto' : undefined"
              @click="pickPhoto"
            >
              <v-img v-if="displayedPhoto" :src="displayedPhoto" :alt="pet.name" cover />
              <v-icon
                v-else
                :icon="pet.species === 'cat' ? 'mdi-cat' : 'mdi-dog'"
                size="56"
              />
            </v-avatar>
            <input
              ref="photoInput"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              data-testid="pet-photo-input"
              @change="handlePhotoChosen"
            />
          </div>

          <v-form :disabled="!canEdit" @submit.prevent="handleSubmit">
            <!-- Nombre · raza · sexo · ícono de esterilización (provisional). -->
            <v-row dense align="center">
              <v-col cols="12" sm="4">
                <v-text-field v-model="name" label="Nombre" />
              </v-col>
              <v-col cols="12" sm="3">
                <v-text-field v-model="breed" label="Raza" />
              </v-col>
              <v-col cols="9" sm="4">
                <v-select v-model="sex" :items="sexOptions" label="Sexo" />
              </v-col>
              <v-col cols="3" sm="1" class="d-flex justify-center pb-5">
                <v-btn
                  :icon="sterilization.icon"
                  :color="sterilization.color"
                  :title="sterilization.label"
                  :aria-label="sterilization.label"
                  :disabled="!canEdit"
                  variant="text"
                  @click="isSterilized = !isSterilized"
                />
              </v-col>
            </v-row>

            <v-row dense>
              <v-col cols="12" sm="6">
                <v-select v-model="species" :items="speciesOptions" label="Especie" />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field :model-value="ownerName" label="Dueño" readonly />
              </v-col>
            </v-row>

            <v-row dense>
              <v-col cols="12" sm="6">
                <v-text-field v-model="birthDate" label="Nacimiento" type="date" />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  :model-value="
                    currentWeightKg ? `${currentWeightKg} kg` : 'Sin registros todavía'
                  "
                  label="Peso"
                  readonly
                />
              </v-col>
            </v-row>

            <v-textarea
              v-model="groomingNotes"
              label="Preferencia de corte"
              rows="2"
              auto-grow
            />
            <v-textarea
              v-model="medicalAlerts"
              label="Alertas médicas"
              rows="2"
              auto-grow
            />
          </v-form>

          <!-- Cartilla: una fila por vacuna del catálogo de su especie. -->
          <div class="d-flex align-center mt-4 mb-2">
            <h2 class="text-subtitle-1">Cartilla de vacunación</h2>
            <v-spacer />
            <v-btn
              v-if="canRegisterVaccine"
              color="primary"
              variant="tonal"
              prepend-icon="mdi-plus"
              @click="showVaccinationDialog = true"
            >
              Registrar vacuna
            </v-btn>
          </div>
          <v-table density="compact" class="mb-4">
            <thead>
              <tr>
                <th class="font-weight-bold">Vacuna</th>
                <th class="font-weight-bold">Fecha de aplicación</th>
                <th class="font-weight-bold">Próxima dosis</th>
                <th class="font-weight-bold">Lote</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in vaccineRows" :key="row.vaccineId">
                <td>{{ row.vaccineName }}</td>
                <td>
                  {{ row.appliedAt ? formatDate(row.appliedAt, displayTimezone) : '—' }}
                </td>
                <td>{{ row.nextDueDate ?? '—' }}</td>
                <td>{{ row.batchNumber ?? '—' }}</td>
              </tr>
              <tr v-if="vaccineRows.length === 0">
                <td colspan="4" class="text-medium-emphasis">
                  No hay vacunas en el catálogo.
                </td>
              </tr>
            </tbody>
          </v-table>

          <!-- Groomer solo recibe la pesada más reciente (RLS): una gráfica de un
               punto no dice nada, así que se oculta para él. -->
          <WeightChart
            v-if="session.role !== 'groomer'"
            :weights="weights"
            class="mb-4"
          />

          <ShareLinkManager
            v-if="session.activeTenantId && isFrontDesk(session.role)"
            class="mb-4"
            :tenant-id="session.activeTenantId"
            :pet-id="pet.id"
          />

          <v-card v-if="upcomingAppointments.length > 0" class="pa-4 mb-4">
            <p class="text-subtitle-1 mb-2">Próximas citas</p>
            <v-list density="compact">
              <v-list-item
                v-for="appointment in upcomingAppointments"
                :key="appointment.id"
                :to="`/app/citas/${appointment.id}`"
              >
                <template #title>
                  {{ formatDate(appointment.starts_at, appointment.branchTimezone) }} ·
                  {{ formatTime(appointment.starts_at, appointment.branchTimezone) }}
                </template>
                <template #subtitle>
                  {{ appointment.kind === 'grooming' ? 'Estética' : 'Veterinaria' }} ·
                  {{ appointment.branchName }}
                </template>
              </v-list-item>
            </v-list>
          </v-card>

          <v-card class="pa-4">
            <p class="text-subtitle-1 mb-2">Historial</p>
            <PetTimeline :entries="visibleTimeline" :branch-timezone="displayTimezone" />
          </v-card>
        </template>

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
        <v-btn variant="text" @click="close">{{ canEdit ? 'Cancelar' : 'Cerrar' }}</v-btn>
        <v-btn
          v-if="canEdit"
          color="primary"
          :loading="saving"
          :disabled="!pet"
          @click="handleSubmit"
        >
          Guardar
        </v-btn>
      </v-card-actions>
    </v-card>

    <VaccinationDialog
      v-if="pet && session.user"
      v-model="showVaccinationDialog"
      :tenant-id="pet.tenant_id"
      :pet-id="pet.id"
      :pet-species="pet.species"
      :applied-by-user-id="session.user.id"
      :branch-timezone="displayTimezone"
      @saved="handleVaccinationSaved"
    />
  </v-dialog>
</template>

<style scoped lang="scss">
.pet-photo--editable {
  cursor: pointer;
}
</style>
