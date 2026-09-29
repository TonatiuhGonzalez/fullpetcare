<script setup lang="ts">
// Ficha del cliente en diálogo (tarea #1968): sus datos y sus mascotas.
// Reemplaza la antigua página CustomerDetailPage: desde el listado de
// clientes se abre encima, sin cambiar de ruta. Al presionar una mascota
// se apila encima el diálogo de la mascota (PetDetailDialog); al cerrarlo
// se regresa a esta ficha.
import { ref, watch } from 'vue'

import * as customersService from '@/services/customers'
import type { Customer } from '@/services/customers'
import * as petsService from '@/services/pets'
import type { Pet } from '@/services/pets'
import { speciesLabel } from '@/lib/petLabels'
import { useSessionStore } from '@/stores/session'
import CustomerFormDialog from '@/components/CustomerFormDialog.vue'
import PetFormDialog from '@/components/PetFormDialog.vue'
import PetDetailDialog from '@/components/PetDetailDialog.vue'

const props = defineProps<{
  modelValue: boolean
  /** null cuando no hay ningún cliente seleccionado todavía. */
  customerId: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** Se editó el cliente: el listado debe recargar sus filas. */
  changed: []
}>()

const session = useSessionStore()

const customer = ref<Customer | null>(null)
const pets = ref<Pet[]>([])
const loading = ref(false)
const errorMessage = ref<string | null>(null)

const showEditCustomer = ref(false)
const showNewPet = ref(false)
const showPetDialog = ref(false)
const selectedPetId = ref<string | null>(null)

async function load(id: string): Promise<void> {
  if (!session.activeTenantId) return
  loading.value = true
  errorMessage.value = null
  try {
    const [foundCustomer, foundPets] = await Promise.all([
      customersService.getById(session.activeTenantId, id),
      petsService.listByCustomer(session.activeTenantId, id),
    ])
    customer.value = foundCustomer
    pets.value = foundPets
  } catch {
    errorMessage.value = 'No se pudo cargar el cliente. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

// Se recarga cada vez que el diálogo se abre (o cambia de cliente), y se
// limpia el cliente anterior para no mostrar sus datos un instante.
watch(
  () => [props.modelValue, props.customerId] as const,
  ([open, id]) => {
    if (!open || !id) return
    customer.value = null
    pets.value = []
    load(id)
  },
  { immediate: true },
)

function openPet(petId: string): void {
  selectedPetId.value = petId
  showPetDialog.value = true
}

function handleCustomerSaved(saved: Customer): void {
  customer.value = saved
  emit('changed')
}

function handlePetSaved(): void {
  if (props.customerId) load(props.customerId)
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="640"
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <span>{{ customer ? `${customer.first_name} ${customer.last_name}` : 'Cliente' }}</span>
        <v-spacer />
        <v-btn
          v-if="customer"
          variant="text"
          prepend-icon="mdi-pencil"
          @click="showEditCustomer = true"
        >
          Editar
        </v-btn>
        <v-btn
          icon="mdi-close"
          variant="text"
          aria-label="Cerrar"
          @click="emit('update:modelValue', false)"
        />
      </v-card-title>

      <v-card-text>
        <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mb-4">
          {{ errorMessage }}
        </v-alert>

        <v-progress-circular v-if="loading && !customer" indeterminate color="primary" />

        <template v-else-if="customer">
          <p v-if="customer.phone" class="mb-1">
            <v-icon icon="mdi-phone" size="16" class="mr-1" />{{ customer.phone }}
          </p>
          <p v-if="customer.email" class="mb-1">
            <v-icon icon="mdi-email" size="16" class="mr-1" />{{ customer.email }}
          </p>
          <p v-if="customer.notes" class="text-body-2 text-medium-emphasis mt-2">
            {{ customer.notes }}
          </p>
          <v-chip v-if="customer.requires_invoice" size="small" class="mt-2" variant="tonal">
            Factura con RFC {{ customer.rfc }}
          </v-chip>

          <div class="d-flex align-center mt-6 mb-4">
            <h2 class="text-h6">Mascotas</h2>
            <v-spacer />
            <v-btn color="primary" prepend-icon="mdi-plus" @click="showNewPet = true">
              Nueva mascota
            </v-btn>
          </div>

          <v-row v-if="pets.length > 0">
            <v-col v-for="pet in pets" :key="pet.id" cols="12" sm="6">
              <v-card class="pa-4" variant="outlined" link @click="openPet(pet.id)">
                <div class="d-flex align-center">
                  <v-avatar color="primary" class="mr-3">
                    <v-icon :icon="pet.species === 'cat' ? 'mdi-cat' : 'mdi-dog'" />
                  </v-avatar>
                  <div>
                    <div class="font-weight-medium">{{ pet.name }}</div>
                    <div class="text-caption text-medium-emphasis">
                      {{ speciesLabel(pet.species)
                      }}<span v-if="pet.breed"> · {{ pet.breed }}</span>
                    </div>
                  </div>
                </div>
              </v-card>
            </v-col>
          </v-row>
          <p v-else class="text-medium-emphasis">
            Este cliente todavía no tiene mascotas registradas.
          </p>
        </template>
      </v-card-text>
    </v-card>

    <CustomerFormDialog
      v-model="showEditCustomer"
      :tenant-id="session.activeTenantId ?? ''"
      :customer="customer"
      @saved="handleCustomerSaved"
    />
    <PetFormDialog
      v-if="customerId"
      v-model="showNewPet"
      :tenant-id="session.activeTenantId ?? ''"
      :customer-id="customerId"
      @saved="handlePetSaved"
    />
    <PetDetailDialog v-model="showPetDialog" :pet-id="selectedPetId" />
  </v-dialog>
</template>
