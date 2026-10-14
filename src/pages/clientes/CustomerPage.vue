<script setup lang="ts">
// Página de un cliente (Correcciones 1, C1.16, PLAN.md D26 punto 6). Solo lectura: arriba
// la ficha del cliente; abajo, tres columnas (en móvil, tarjetas una debajo de otra):
// sus mascotas, la información de la elegida (con gráfica de peso y enlace para
// compartir) y su cartilla de vacunación. "Editar" no reescribe nada aquí: abre los
// modales que ya existen (CustomerEditDialog y PetEditDialog).
//
// Solo dueño y recepción entran (meta.requiresFrontDesk en el router). Un id de otro
// negocio no da error: la base lo oculta (RLS) y getById devuelve null.
import { computed, onMounted, ref, watch } from 'vue'
import { format } from 'date-fns'
import { useRoute, useRouter } from 'vue-router'

import ConfirmDeleteDialog from '@/components/ConfirmDeleteDialog.vue'
import CustomerAccountCard from '@/components/CustomerAccountCard.vue'
import CustomerEditDialog from '@/components/CustomerEditDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import FamilyCard from '@/components/FamilyCard.vue'
import PageHeader from '@/components/PageHeader.vue'
import PageSkeleton from '@/components/PageSkeleton.vue'
import PetEditDialog from '@/components/PetEditDialog.vue'
import PetFormDialog from '@/components/PetFormDialog.vue'
import ShareLinkManager from '@/components/ShareLinkManager.vue'
import TransferPetDialog from '@/components/TransferPetDialog.vue'
import VaccinationDialog from '@/components/VaccinationDialog.vue'
import WeightChart from '@/components/WeightChart.vue'
import { useFirstLoad } from '@/composables/useFirstLoad'
import { pickSelectedPetId, speciesIcon } from '@/lib/customerPets'
import { formatDate, formatDateOnly } from '@/lib/datetime'
import { sexLabel, speciesLabel, sterilizationIndicator } from '@/lib/petLabels'
import { isFrontDesk } from '@/lib/roles'
import { buildVaccineTableRows } from '@/lib/vaccination'
import * as customersService from '@/services/customers'
import type { Customer } from '@/services/customers'
import * as petsService from '@/services/pets'
import type { Pet, PetOwnership, PetWeight } from '@/services/pets'
import * as recordsService from '@/services/records'
import type { VaccinationWithName } from '@/services/records'
import * as vaccinesService from '@/services/vaccines'
import type { Vaccine } from '@/services/vaccines'
import { useSessionStore } from '@/stores/session'
import IconButton from '@/components/IconButton.vue'

const session = useSessionStore()
const route = useRoute()
const router = useRouter()

const customerId = computed(() => String(route.params.id ?? ''))

const customer = ref<Customer | null>(null)
const pets = ref<Pet[]>([])
const selectedPetId = ref<string | null>(null)
const loading = ref(false)
const { isFirstLoad, showSkeleton } = useFirstLoad(loading)
const errorMessage = ref<string | null>(null)

// Detalle de la mascota elegida (peso, foto y cartilla).
const weights = ref<PetWeight[]>([])
const vaccinations = ref<VaccinationWithName[]>([])
const catalog = ref<Vaccine[]>([])
const photoUrl = ref<string | null>(null)
// Dueños anteriores y actual de la mascota elegida (fase 31).
const ownerships = ref<PetOwnership[]>([])
const detailLoading = ref(false)
// Número de la última petición de detalle: si el usuario cambia de mascota antes de que
// termine la anterior, la respuesta vieja no debe pisar a la nueva.
let detailRequest = 0

const showCustomerDialog = ref(false)
const showPetEditDialog = ref(false)
const showNewPetDialog = ref(false)
const showVaccinationDialog = ref(false)
const showTransferDialog = ref(false)
const petToDelete = ref<Pet | null>(null)
const showDeleteConfirm = ref(false)
const deleting = ref(false)

const selectedPet = computed(
  () => pets.value.find((pet) => pet.id === selectedPetId.value) ?? null,
)
const customerName = computed(() =>
  customer.value ? `${customer.value.first_name} ${customer.value.last_name}`.trim() : '',
)
const sterilization = computed(() =>
  selectedPet.value ? sterilizationIndicator(selectedPet.value.is_sterilized) : null,
)
const lastWeightKg = computed(() => {
  const latest = weights.value[0]
  return latest ? (latest.weight_grams / 1000).toFixed(1) : null
})
// Misma regla que PetEditDialog (vaccinations_insert): solo dueño y veterinario.
const canRegisterVaccine = computed(
  () => session.role === 'owner' || session.role === 'vet',
)
const canEdit = computed(() => isFrontDesk(session.role))
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
const hasFiscalData = computed(() => {
  const c = customer.value
  return !!c && (c.requires_invoice || !!c.rfc || !!c.legal_name)
})

async function loadPetDetail(): Promise<void> {
  const pet = selectedPet.value
  const request = ++detailRequest
  if (!pet) {
    weights.value = []
    vaccinations.value = []
    catalog.value = []
    photoUrl.value = null
    ownerships.value = []
    detailLoading.value = false
    return
  }
  detailLoading.value = true
  try {
    const [weightHistory, applied, vaccineCatalog, photo, owners] = await Promise.all([
      petsService.listWeights(pet.tenant_id, pet.id),
      recordsService.listVaccinationsByPet(pet.tenant_id, pet.id),
      vaccinesService.listForSpecies(pet.tenant_id, pet.species),
      pet.photo_path ? petsService.getPhotoUrl(pet.photo_path) : Promise.resolve(null),
      petsService.listOwnerships(pet.tenant_id, pet.id),
    ])
    if (request !== detailRequest) return
    ownerships.value = owners
    weights.value = weightHistory
    vaccinations.value = applied
    catalog.value = vaccineCatalog
    photoUrl.value = photo
  } catch {
    if (request !== detailRequest) return
    errorMessage.value = 'No se pudo cargar la mascota. Revisa tu conexión.'
  } finally {
    if (request === detailRequest) detailLoading.value = false
  }
}

async function load(): Promise<void> {
  if (!session.activeTenantId) return
  const tenantId = session.activeTenantId
  loading.value = true
  errorMessage.value = null
  try {
    const found = await customersService.getById(tenantId, customerId.value)
    customer.value = found
    if (!found) {
      pets.value = []
      selectedPetId.value = null
      return
    }
    pets.value = await petsService.listByCustomer(tenantId, found.id)
    selectedPetId.value = pickSelectedPetId(pets.value, selectedPetId.value)
  } catch {
    errorMessage.value = 'No se pudo cargar el cliente. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
  // Recarga el detalle también cuando la mascota elegida sigue siendo la misma (se
  // pudo editar su especie, su foto o su cartilla desde un modal).
  await loadPetDetail()
}

onMounted(load)
// Pasar de un cliente a otro con la misma pantalla montada (enlace o botón de atrás).
watch(customerId, () => {
  selectedPetId.value = null
  customer.value = null
  load()
})

function selectPet(id: string): void {
  if (id === selectedPetId.value) return
  selectedPetId.value = id
  loadPetDetail()
}

function goBack(): void {
  router.push({ name: 'clientes' })
}

function askDelete(pet: Pet): void {
  petToDelete.value = pet
  showDeleteConfirm.value = true
}

async function confirmDelete(): Promise<void> {
  if (!petToDelete.value) return
  deleting.value = true
  errorMessage.value = null
  try {
    await petsService.softDelete(petToDelete.value.id)
    showDeleteConfirm.value = false
    await load()
  } catch {
    showDeleteConfirm.value = false
    errorMessage.value = 'No se pudo eliminar la mascota. Revisa tu conexión.'
  } finally {
    deleting.value = false
  }
}

async function handleVaccinationSaved(): Promise<void> {
  await loadPetDetail()
}
</script>

<template>
  <v-container class="py-6">
    <PageSkeleton v-if="isFirstLoad && showSkeleton" :blocks="3" />

    <template v-else-if="!isFirstLoad">
      <!-- Cliente inexistente, de otro negocio o error de carga. -->
      <template v-if="!customer">
        <v-alert
          v-if="errorMessage"
          type="error"
          density="compact"
          variant="tonal"
          class="mb-4"
        >
          {{ errorMessage }}
        </v-alert>
        <EmptyState
          illustration="customers"
          title="Cliente no encontrado"
          message="El cliente no existe o ya no está disponible."
        >
          <v-btn color="primary" prepend-icon="mdi-arrow-left" @click="goBack">
            Volver a clientes
          </v-btn>
        </EmptyState>
      </template>

      <template v-else>
        <PageHeader :title="customerName">
          <template #actions>
            <v-btn variant="text" prepend-icon="mdi-arrow-left" @click="goBack">
              Volver a clientes
            </v-btn>
          </template>
        </PageHeader>

        <v-alert
          v-if="errorMessage"
          type="error"
          density="compact"
          variant="tonal"
          class="mb-4"
        >
          {{ errorMessage }}
        </v-alert>

        <!-- Fila 1: el cliente. -->
        <v-card variant="outlined" class="pa-4 mb-4">
          <div class="d-flex flex-wrap align-start ga-4">
            <div class="customer-info flex-grow-1">
              <p v-if="customer.phone" class="mb-1">
                <v-icon icon="mdi-phone" size="16" class="mr-1" />{{ customer.phone }}
              </p>
              <p v-if="customer.email" class="mb-1 text-break">
                <v-icon icon="mdi-email" size="16" class="mr-1" />{{ customer.email }}
              </p>
              <p v-if="!customer.phone && !customer.email" class="text-medium-emphasis">
                Sin teléfono ni correo registrados.
              </p>
              <p v-if="customer.notes" class="text-body-2 text-medium-emphasis mt-2">
                {{ customer.notes }}
              </p>
              <div v-if="hasFiscalData" class="text-body-2 mt-3">
                <div class="font-weight-bold mb-1">Datos fiscales</div>
                <div v-if="customer.legal_name">
                  Razón social: {{ customer.legal_name }}
                </div>
                <div v-if="customer.rfc">RFC: {{ customer.rfc }}</div>
                <div v-if="customer.tax_regime_code">
                  Régimen fiscal: {{ customer.tax_regime_code }}
                </div>
                <div v-if="customer.cfdi_use">Uso de CFDI: {{ customer.cfdi_use }}</div>
                <div v-if="customer.postal_code">
                  Código postal: {{ customer.postal_code }}
                </div>
                <v-chip
                  v-if="customer.requires_invoice"
                  size="small"
                  variant="tonal"
                  class="mt-2"
                >
                  Requiere factura
                </v-chip>
              </div>
            </div>
            <v-btn
              v-if="canEdit"
              color="primary"
              variant="tonal"
              prepend-icon="mdi-pencil"
              @click="showCustomerDialog = true"
            >
              Editar
            </v-btn>
          </div>
        </v-card>

        <!-- Cuenta del dueño vinculada (fase 16B). -->
        <CustomerAccountCard
          v-if="session.activeTenantId"
          :tenant-id="session.activeTenantId"
          :customer-id="customer.id"
          :can-edit="canEdit"
        />

        <!-- Familia del cliente (fase 31): mascotas de todos sus miembros y el titular. -->
        <FamilyCard
          v-if="session.activeTenantId"
          :tenant-id="session.activeTenantId"
          :customer-id="customer.id"
          :can-edit="canEdit"
          @changed="load"
        />

        <!-- Fila 2: mascotas | información de la elegida | cartilla. -->
        <v-row>
          <!-- Columna 1: tarjetas de mascotas. -->
          <v-col cols="12" md="4" lg="3">
            <div class="d-flex align-center flex-wrap ga-2 mb-2">
              <h2 class="text-subtitle-1 font-weight-bold">Mascotas</h2>
              <v-spacer />
              <v-btn
                v-if="canEdit && pets.length > 0"
                color="primary"
                variant="tonal"
                size="small"
                prepend-icon="mdi-plus"
                @click="showNewPetDialog = true"
              >
                Agregar mascota
              </v-btn>
            </div>

            <EmptyState
              v-if="pets.length === 0"
              compact
              illustration="customers"
              title="Sin mascotas"
              message="Este cliente todavía no tiene mascotas registradas."
            >
              <v-btn
                v-if="canEdit"
                color="primary"
                prepend-icon="mdi-plus"
                @click="showNewPetDialog = true"
              >
                Agregar mascota
              </v-btn>
            </EmptyState>

            <div v-else class="d-flex flex-column ga-2">
              <v-card
                v-for="pet in pets"
                :key="pet.id"
                variant="outlined"
                :color="pet.id === selectedPetId ? 'primary' : undefined"
                :class="[
                  'pet-card pa-3',
                  { 'pet-card--selected': pet.id === selectedPetId },
                ]"
                role="button"
                tabindex="0"
                :aria-pressed="pet.id === selectedPetId"
                @click="selectPet(pet.id)"
                @keydown.enter.prevent="selectPet(pet.id)"
                @keydown.space.prevent="selectPet(pet.id)"
              >
                <div class="d-flex align-center">
                  <v-icon :icon="speciesIcon(pet.species)" class="mr-3" />
                  <div class="flex-grow-1 text-truncate">
                    <div class="font-weight-medium text-truncate">{{ pet.name }}</div>
                    <div class="text-caption text-medium-emphasis text-truncate">
                      {{ speciesLabel(pet.species)
                      }}<template v-if="pet.breed"> · {{ pet.breed }}</template>
                    </div>
                  </div>
                  <IconButton
                    v-if="canEdit"
                    icon="mdi-delete"
                    color="error"
                    variant="text"
                    size="small"
                    aria-label="Eliminar mascota"
                    @click.stop="askDelete(pet)"
                    @keydown.enter.stop
                    @keydown.space.stop
                  />
                </div>
              </v-card>
            </div>
          </v-col>

          <!-- Columna 2: información de la mascota elegida. -->
          <v-col cols="12" md="4" lg="4">
            <h2 class="text-subtitle-1 font-weight-bold mb-2">
              Información de la mascota
            </h2>
            <v-card variant="outlined" class="pa-4">
              <p v-if="!selectedPet" class="text-medium-emphasis">
                Elige una mascota para ver su información.
              </p>
              <template v-else>
                <v-progress-linear
                  v-if="detailLoading"
                  indeterminate
                  height="2"
                  class="mb-2"
                  aria-label="Cargando mascota"
                />
                <div class="d-flex align-center mb-4">
                  <v-avatar size="72" color="primary" class="mr-4">
                    <v-img
                      v-if="photoUrl"
                      :src="photoUrl"
                      :alt="selectedPet.name"
                      cover
                    />
                    <v-icon v-else :icon="speciesIcon(selectedPet.species)" size="36" />
                  </v-avatar>
                  <div class="flex-grow-1" style="min-width: 0">
                    <div class="text-h6 text-truncate">{{ selectedPet.name }}</div>
                    <div class="text-body-2 text-medium-emphasis">
                      {{ selectedPet.breed || 'Sin raza' }} ·
                      {{ sexLabel(selectedPet.sex) }}
                    </div>
                  </div>
                  <IconButton
                    v-if="canEdit"
                    icon="mdi-pencil"
                    color="primary"
                    variant="text"
                    aria-label="Editar mascota"
                    @click="showPetEditDialog = true"
                  />
                  <IconButton
                    v-if="canEdit"
                    icon="mdi-account-switch-outline"
                    variant="text"
                    aria-label="Transferir mascota"
                    @click="showTransferDialog = true"
                  />
                </div>

                <dl class="pet-facts">
                  <dt>Esterilización</dt>
                  <dd>
                    <v-icon
                      v-if="sterilization"
                      :icon="sterilization.icon"
                      :color="sterilization.color"
                      size="18"
                      class="mr-1"
                    />{{ sterilization?.label }}
                  </dd>
                  <dt>Especie</dt>
                  <dd>{{ speciesLabel(selectedPet.species) }}</dd>
                  <dt>Nacimiento</dt>
                  <dd>
                    {{
                      selectedPet.birth_date
                        ? formatDateOnly(selectedPet.birth_date)
                        : 'No registrado'
                    }}
                  </dd>
                  <dt>Último peso</dt>
                  <dd>
                    {{ lastWeightKg ? `${lastWeightKg} kg` : 'Sin registros todavía' }}
                  </dd>
                  <dt>Preferencia de corte</dt>
                  <dd>{{ selectedPet.grooming_notes || '—' }}</dd>
                  <dt>Alertas médicas</dt>
                  <dd>{{ selectedPet.medical_alerts || '—' }}</dd>
                </dl>

                <WeightChart :weights="weights" class="mt-4" />

                <!-- Dueños: el actual y los anteriores, con sus periodos (fase 31). -->
                <div v-if="ownerships.length > 1" class="mt-4">
                  <p class="text-subtitle-2 mb-1">Dueños</p>
                  <ul class="text-body-2 pl-4">
                    <li v-for="owner in ownerships" :key="owner.id">
                      {{ owner.customerName }} ·
                      {{ formatDate(owner.startedAt, displayTimezone) }} –
                      {{ owner.endedAt ? formatDate(owner.endedAt, displayTimezone) : 'actual' }}
                    </li>
                  </ul>
                </div>

                <ShareLinkManager
                  v-if="session.activeTenantId && canEdit"
                  class="mt-4"
                  :tenant-id="session.activeTenantId"
                  :pet-id="selectedPet.id"
                />
              </template>
            </v-card>
          </v-col>

          <!-- Columna 3: cartilla de vacunación. -->
          <v-col cols="12" md="4" lg="5">
            <div class="d-flex align-center flex-wrap ga-2 mb-2">
              <h2 class="text-subtitle-1 font-weight-bold">Cartilla de vacunación</h2>
              <v-spacer />
              <v-btn
                v-if="selectedPet && canRegisterVaccine"
                color="primary"
                variant="tonal"
                size="small"
                prepend-icon="mdi-plus"
                @click="showVaccinationDialog = true"
              >
                Registrar vacuna
              </v-btn>
            </div>
            <v-card variant="outlined">
              <p v-if="!selectedPet" class="pa-4 text-medium-emphasis">
                Elige una mascota para ver su cartilla.
              </p>
              <v-table v-else density="compact" class="vaccine-table">
                <thead>
                  <tr>
                    <th class="font-weight-bold">Vacuna</th>
                    <th class="font-weight-bold">Aplicación</th>
                    <th class="font-weight-bold">Próxima dosis</th>
                    <th class="font-weight-bold">Lote</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in vaccineRows" :key="row.vaccineId">
                    <td>{{ row.vaccineName }}</td>
                    <td>
                      {{
                        row.appliedAt ? formatDate(row.appliedAt, displayTimezone) : '—'
                      }}
                    </td>
                    <td>{{ row.nextDueDate ? formatDateOnly(row.nextDueDate) : '—' }}</td>
                    <td>{{ row.batchNumber ?? '—' }}</td>
                  </tr>
                  <tr v-if="vaccineRows.length === 0">
                    <td colspan="4" class="text-medium-emphasis">
                      No hay vacunas en el catálogo.
                    </td>
                  </tr>
                </tbody>
              </v-table>
            </v-card>
          </v-col>
        </v-row>
      </template>
    </template>

    <CustomerEditDialog
      v-model="showCustomerDialog"
      :tenant-id="session.activeTenantId ?? ''"
      :customer-id="customer?.id ?? null"
      @saved="load"
      @changed="load"
    />
    <PetEditDialog v-model="showPetEditDialog" :pet-id="selectedPetId" @saved="load" />
    <PetFormDialog
      v-if="customer"
      v-model="showNewPetDialog"
      :tenant-id="session.activeTenantId ?? ''"
      :customer-id="customer.id"
      @saved="load"
    />
    <VaccinationDialog
      v-if="selectedPet && session.user"
      v-model="showVaccinationDialog"
      :tenant-id="selectedPet.tenant_id"
      :pet-id="selectedPet.id"
      :pet-species="selectedPet.species"
      :applied-by-user-id="session.user.id"
      :branch-timezone="displayTimezone"
      @saved="handleVaccinationSaved"
    />
    <TransferPetDialog
      v-model="showTransferDialog"
      :tenant-id="session.activeTenantId ?? ''"
      :pet="selectedPet"
      @transferred="load"
    />
    <ConfirmDeleteDialog
      v-model="showDeleteConfirm"
      title="Eliminar mascota"
      :message="`¿Seguro que quieres eliminar a ${petToDelete?.name ?? ''}? También se eliminarán sus citas programadas. Su expediente y su historial de atenciones se conservan.`"
      :loading="deleting"
      @confirm="confirmDelete"
    />
  </v-container>
</template>

<style scoped lang="scss">
.customer-info {
  min-width: 0;
}

// La cartilla comparte la fila con otras dos columnas: menos relleno por celda y el encabezado
// puede partirse en dos líneas, para que "Próxima dosis" y "Lote" no queden fuera de la tarjeta.
// El selector repite la ruta completa de Vuetify (`.v-table__wrapper > table > ...`) porque la
// regla de la librería es más específica que `th`/`td` a secas y ganaría.
.vaccine-table :deep(.v-table__wrapper > table > thead > tr > th),
.vaccine-table :deep(.v-table__wrapper > table > tbody > tr > td) {
  padding-inline: 8px;
  font-size: 0.8125rem;
}

.vaccine-table :deep(.v-table__wrapper > table > thead > tr > th) {
  white-space: normal;
  line-height: 1.2;
}

.pet-card {
  cursor: pointer;

  // El color nunca va solo: la elegida también lleva borde más grueso y fondo tonal.
  &--selected {
    border-width: 2px;
    background: rgba(var(--v-theme-primary), 0.08);
  }
}

// Etiqueta arriba y valor debajo: la columna de información es de un tercio del ancho y en dos
// columnas partía palabras ("esterilizad o(a)").
.pet-facts {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0;

  dt {
    color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
    font-size: 0.8125rem;
    margin-top: 12px;

    &:first-of-type {
      margin-top: 0;
    }
  }

  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
}
</style>
