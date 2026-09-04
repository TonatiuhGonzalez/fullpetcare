<script setup lang="ts">
// Ficha del cliente: sus datos y sus mascotas (tarea 2.18).
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import * as customersService from '@/services/customers'
import type { Customer } from '@/services/customers'
import * as petsService from '@/services/pets'
import type { Pet } from '@/services/pets'
import { speciesLabel } from '@/lib/petLabels'
import { useSessionStore } from '@/stores/session'
import CustomerFormDialog from '@/components/CustomerFormDialog.vue'
import PetFormDialog from '@/components/PetFormDialog.vue'

const props = defineProps<{ id: string }>()

const session = useSessionStore()
const router = useRouter()

const customer = ref<Customer | null>(null)
const pets = ref<Pet[]>([])
const loading = ref(false)
const errorMessage = ref<string | null>(null)

const showEditCustomer = ref(false)
const showNewPet = ref(false)

async function load(): Promise<void> {
  if (!session.activeTenantId) return
  loading.value = true
  errorMessage.value = null
  try {
    const [foundCustomer, foundPets] = await Promise.all([
      customersService.getById(session.activeTenantId, props.id),
      petsService.listByCustomer(session.activeTenantId, props.id),
    ])
    customer.value = foundCustomer
    pets.value = foundPets
  } catch {
    errorMessage.value = 'No se pudo cargar el cliente. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function goToPet(petId: string): void {
  router.push(`/app/mascotas/${petId}`)
}

function handleCustomerSaved(saved: Customer): void {
  customer.value = saved
}

function handlePetSaved(): void {
  load()
}
</script>

<template>
  <v-container class="py-6">
    <v-btn variant="text" prepend-icon="mdi-arrow-left" class="mb-2" to="/app/clientes">
      Volver a clientes
    </v-btn>

    <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mb-4">
      {{ errorMessage }}
    </v-alert>

    <v-progress-circular v-if="loading && !customer" indeterminate color="primary" />

    <template v-else-if="customer">
      <v-card class="pa-4 mb-6">
        <div class="d-flex align-center mb-2">
          <h1 class="text-h5">{{ customer.first_name }} {{ customer.last_name }}</h1>
          <v-spacer />
          <v-btn variant="text" prepend-icon="mdi-pencil" @click="showEditCustomer = true">
            Editar
          </v-btn>
        </div>
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
      </v-card>

      <div class="d-flex align-center mb-4">
        <h2 class="text-h6">Mascotas</h2>
        <v-spacer />
        <v-btn color="primary" prepend-icon="mdi-plus" @click="showNewPet = true">
          Nueva mascota
        </v-btn>
      </div>

      <v-row v-if="pets.length > 0">
        <v-col v-for="pet in pets" :key="pet.id" cols="12" sm="6" md="4">
          <v-card class="pa-4" link @click="goToPet(pet.id)">
            <div class="d-flex align-center">
              <v-avatar color="primary" class="mr-3">
                <v-icon :icon="pet.species === 'cat' ? 'mdi-cat' : 'mdi-dog'" />
              </v-avatar>
              <div>
                <div class="font-weight-medium">{{ pet.name }}</div>
                <div class="text-caption text-medium-emphasis">
                  {{ speciesLabel(pet.species) }}<span v-if="pet.breed"> · {{ pet.breed }}</span>
                </div>
              </div>
            </div>
          </v-card>
        </v-col>
      </v-row>
      <p v-else class="text-medium-emphasis">Este cliente todavía no tiene mascotas registradas.</p>
    </template>

    <CustomerFormDialog
      v-model="showEditCustomer"
      :tenant-id="session.activeTenantId ?? ''"
      :customer="customer"
      @saved="handleCustomerSaved"
    />
    <PetFormDialog
      v-model="showNewPet"
      :tenant-id="session.activeTenantId ?? ''"
      :customer-id="props.id"
      @saved="handlePetSaved"
    />
  </v-container>
</template>
