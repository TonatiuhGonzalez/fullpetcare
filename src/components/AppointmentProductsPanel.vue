<script setup lang="ts">
// "Productos y medicamentos usados" (tarea 11.13): el veterinario anota qué usó en
// la consulta. Cada línea baja la existencia al registrarse y la regresa si se
// quita; "Cobrar al cliente" decide si pasará al ticket (tarea 11.14) o es de uso
// interno. Las reglas las impone la base (RPC); aquí solo se captura y se muestra.
import { onMounted, ref } from 'vue'

import * as appointmentProductsService from '@/services/appointmentProducts'
import type { AppointmentProduct, AvailableProduct } from '@/services/appointmentProducts'

const props = defineProps<{
  tenantId: string
  appointmentId: string
  branchId: string
}>()

// Avisa al padre que cambió la existencia o las líneas (p. ej. para refrescar listas).
const emit = defineEmits<{ changed: [] }>()

const lines = ref<AppointmentProduct[]>([])
const available = ref<AvailableProduct[]>([])
const productToAdd = ref<AvailableProduct | null>(null)
const quantity = ref(1)
const isBillable = ref(true)

const loading = ref(false)
const saving = ref(false)
const errorMessage = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  errorMessage.value = null
  try {
    ;[lines.value, available.value] = await Promise.all([
      appointmentProductsService.listByAppointment(props.tenantId, props.appointmentId),
      appointmentProductsService.listAvailable(props.tenantId, props.branchId),
    ])
  } catch {
    errorMessage.value = 'No se pudieron cargar los productos usados. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function handleAdd(): Promise<void> {
  if (!productToAdd.value) return
  if (!Number.isInteger(quantity.value) || quantity.value <= 0) {
    errorMessage.value = 'La cantidad debe ser un número entero mayor a cero.'
    return
  }
  if (quantity.value > productToAdd.value.stock) {
    errorMessage.value = `Solo hay ${productToAdd.value.stock} pieza(s) de "${productToAdd.value.name}".`
    return
  }

  saving.value = true
  errorMessage.value = null
  try {
    await appointmentProductsService.add({
      appointmentId: props.appointmentId,
      productId: productToAdd.value.id,
      quantity: quantity.value,
      isBillable: isBillable.value,
    })
    productToAdd.value = null
    quantity.value = 1
    isBillable.value = true
    await load()
    emit('changed')
  } catch (err) {
    errorMessage.value = appointmentProductsService.errorMessage(err)
    // La existencia pudo cambiar mientras se capturaba: se vuelve a leer.
    await load()
  } finally {
    saving.value = false
  }
}

async function handleRemove(line: AppointmentProduct): Promise<void> {
  saving.value = true
  errorMessage.value = null
  try {
    await appointmentProductsService.remove(line.id)
    await load()
    emit('changed')
  } catch (err) {
    errorMessage.value = appointmentProductsService.errorMessage(err)
  } finally {
    saving.value = false
  }
}

defineExpose({ reload: load })
</script>

<template>
  <section aria-label="Productos y medicamentos usados">
    <p class="text-subtitle-2 mb-2">Productos y medicamentos usados</p>

    <v-list v-if="lines.length" density="compact" class="mb-2">
      <v-list-item v-for="line in lines" :key="line.id">
        <template #title>{{ line.name_snapshot }} × {{ line.quantity }}</template>
        <template #subtitle>{{
          line.is_billable ? 'Se cobra al cliente' : 'Uso interno'
        }}</template>
        <template #append>
          <v-btn
            icon="mdi-close"
            size="x-small"
            variant="text"
            :disabled="saving"
            aria-label="Quitar producto"
            @click="handleRemove(line)"
          />
        </template>
      </v-list-item>
    </v-list>
    <p v-else-if="!loading" class="text-body-2 text-medium-emphasis mb-2">
      Aún no se registra ningún producto en esta consulta.
    </p>

    <div class="d-flex align-end ga-2">
      <v-autocomplete
        v-model="productToAdd"
        :items="available"
        item-title="name"
        return-object
        label="Producto"
        density="compact"
        hide-details
        :loading="loading"
        no-data-text="No hay productos con existencia"
      >
        <template #item="{ props: itemProps, item }">
          <v-list-item v-bind="itemProps" :subtitle="`Hay ${item.raw.stock}`" />
        </template>
      </v-autocomplete>
      <v-text-field
        v-model.number="quantity"
        label="Cant."
        type="number"
        min="1"
        step="1"
        density="compact"
        hide-details
        style="max-width: 90px"
      />
      <v-btn
        icon="mdi-plus"
        color="primary"
        variant="tonal"
        :disabled="!productToAdd"
        :loading="saving"
        aria-label="Agregar producto"
        @click="handleAdd"
      />
    </div>
    <v-switch
      v-model="isBillable"
      label="Cobrar al cliente"
      density="compact"
      hide-details
      color="primary"
    />

    <v-alert
      v-if="errorMessage"
      type="error"
      density="compact"
      variant="tonal"
      class="mt-2"
    >
      {{ errorMessage }}
    </v-alert>
  </section>
</template>
