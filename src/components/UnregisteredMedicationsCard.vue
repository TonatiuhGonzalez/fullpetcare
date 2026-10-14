<script setup lang="ts">
// Aviso al dueño del negocio (fase 28, PLAN.md D30 punto 3): los medicamentos que el
// veterinario escribió a mano en una receta y que no están en el catálogo. El dueño puede
// ligarlos a un producto que ya tenga registrado o descartar el aviso. Para registrar uno
// nuevo se va a Inventario y luego se elige aquí. Si no hay nada pendiente no se pinta.
import { computed, onMounted, ref } from 'vue'

import * as prescriptionsService from '@/services/prescriptions'
import type { UnregisteredMedication } from '@/services/prescriptions'
import * as productsService from '@/services/products'
import type { Product } from '@/services/products'

const props = defineProps<{ tenantId: string }>()

const pending = ref<UnregisteredMedication[]>([])
const products = ref<Product[]>([])
const errorMessage = ref<string | null>(null)
const busyName = ref<string | null>(null)

// Medicamento al que se le está eligiendo producto.
const linking = ref<UnregisteredMedication | null>(null)
const chosenProductId = ref<string | null>(null)

const productItems = computed(() =>
  products.value.filter((p) => p.is_active).map((p) => ({ title: p.name, value: p.id })),
)

async function load(): Promise<void> {
  errorMessage.value = null
  try {
    const [list, catalog] = await Promise.all([
      prescriptionsService.listUnregistered(),
      productsService.list(props.tenantId),
    ])
    pending.value = list
    products.value = catalog
  } catch {
    // Es un aviso extra de Inicio: si falla no estorba al resto de la pantalla.
    pending.value = []
    errorMessage.value = 'No se pudieron revisar los medicamentos sin registrar.'
  }
}

onMounted(load)

function startLinking(medication: UnregisteredMedication): void {
  linking.value = medication
  chosenProductId.value = null
}

async function resolve(
  medication: UnregisteredMedication,
  productId: string | null,
): Promise<void> {
  busyName.value = medication.medicationName
  errorMessage.value = null
  try {
    await prescriptionsService.resolveUnregistered(
      props.tenantId,
      medication.medicationName,
      productId,
    )
    linking.value = null
    await load()
  } catch {
    errorMessage.value = 'No se pudo actualizar el medicamento. Revisa tu conexión.'
  } finally {
    busyName.value = null
  }
}
</script>

<template>
  <v-card
    v-if="pending.length > 0 || errorMessage"
    class="mb-4"
    data-testid="unregistered-medications"
  >
    <v-card-text>
      <h2 class="text-subtitle-1 font-weight-bold mb-1">Medicamentos por registrar</h2>
      <p class="text-body-2 text-medium-emphasis mb-3">
        Los veterinarios los escribieron a mano en una receta y no están en tu catálogo.
        Regístralos en <router-link to="/app/inventario">Inventario</router-link> y
        ligalos aquí, o descártalos.
      </p>

      <v-alert
        v-if="errorMessage"
        type="warning"
        density="compact"
        variant="tonal"
        class="mb-3"
      >
        {{ errorMessage }}
      </v-alert>

      <v-list density="compact" class="pa-0">
        <v-list-item
          v-for="medication in pending"
          :key="medication.medicationName"
          :title="medication.medicationName"
          :subtitle="`Recetado ${medication.timesPrescribed} ${medication.timesPrescribed === 1 ? 'vez' : 'veces'}`"
        >
          <template #append>
            <v-btn
              size="small"
              variant="tonal"
              :disabled="busyName === medication.medicationName"
              @click="startLinking(medication)"
            >
              Ligar a producto
            </v-btn>
            <v-btn
              size="small"
              variant="text"
              :loading="busyName === medication.medicationName"
              @click="resolve(medication, null)"
            >
              Descartar
            </v-btn>
          </template>
        </v-list-item>
      </v-list>
    </v-card-text>

    <v-dialog
      :model-value="linking !== null"
      max-width="420"
      @update:model-value="linking = $event ? linking : null"
    >
      <v-card v-if="linking">
        <v-card-title>Ligar «{{ linking.medicationName }}»</v-card-title>
        <v-card-text>
          <v-autocomplete
            v-model="chosenProductId"
            :items="productItems"
            label="Producto del catálogo"
            variant="outlined"
            no-data-text="No hay productos. Regístralo primero en Inventario."
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="linking = null">Cancelar</v-btn>
          <v-btn
            color="primary"
            :disabled="!chosenProductId"
            :loading="busyName === linking.medicationName"
            @click="resolve(linking, chosenProductId)"
          >
            Ligar
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>
