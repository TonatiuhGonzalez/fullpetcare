<script setup lang="ts">
// Lista de clientes con búsqueda y paginación simple (tarea 2.16). La
// paginación es la que trae Vuetify de fábrica en v-data-table (del
// lado del cliente, sobre lo que ya se cargó) — no hace falta construir
// paginación propia: con el volumen de datos de un demo (decenas de
// clientes por tenant), traer todo de una vez y paginar en el navegador
// es simple y suficientemente rápido (CLAUDE.md §11, "simple sobre
// elegante").
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import * as customersService from '@/services/customers'
import type { Customer } from '@/services/customers'
import { useSessionStore } from '@/stores/session'
import CustomerFormDialog from '@/components/CustomerFormDialog.vue'

const session = useSessionStore()
const router = useRouter()

const customers = ref<Customer[]>([])
const loading = ref(false)
const errorMessage = ref<string | null>(null)
const searchTerm = ref('')
const showFormDialog = ref(false)

const headers = [
  { title: 'Nombre', key: 'fullName' },
  { title: 'Teléfono', key: 'phone' },
  { title: 'Correo', key: 'email' },
]

// La tabla necesita "fullName" como columna, pero el servicio devuelve
// first_name/last_name por separado (así vive en la base) — se arma
// aquí, solo para mostrar.
const rows = ref<Array<Customer & { fullName: string }>>([])
watch(customers, (list) => {
  rows.value = list.map((c) => ({ ...c, fullName: `${c.first_name} ${c.last_name}` }))
})

async function load(): Promise<void> {
  if (!session.activeTenantId) return
  loading.value = true
  errorMessage.value = null
  try {
    customers.value =
      searchTerm.value.trim() === ''
        ? await customersService.list(session.activeTenantId)
        : await customersService.search(session.activeTenantId, searchTerm.value)
  } catch {
    errorMessage.value = 'No se pudo cargar la lista de clientes. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

// Sin debounce a propósito: con pocos clientes por tenant, cada tecleo
// dispara una consulta instantánea — un debounce es una optimización
// que no hace falta al tamaño de un demo (se agrega si algún día duele
// de verdad, CLAUDE.md §11).
watch(searchTerm, load)
onMounted(load)

function openNewCustomer(): void {
  showFormDialog.value = true
}

function handleRowClick(_event: Event, { item }: { item: Customer }): void {
  router.push(`/app/clientes/${item.id}`)
}

function handleSaved(): void {
  load()
}
</script>

<template>
  <v-container class="py-6">
    <div class="d-flex align-center mb-4">
      <h1 class="text-h5">Clientes</h1>
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-plus" @click="openNewCustomer">
        Nuevo cliente
      </v-btn>
    </div>

    <v-text-field
      v-model="searchTerm"
      label="Buscar por nombre o apellido"
      prepend-inner-icon="mdi-magnify"
      density="compact"
      variant="outlined"
      clearable
      class="mb-4"
      style="max-width: 420px"
    />

    <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mb-4">
      {{ errorMessage }}
    </v-alert>

    <v-data-table
      :headers="headers"
      :items="rows"
      :loading="loading"
      no-data-text="No hay clientes que coincidan con la búsqueda."
      loading-text="Cargando clientes…"
      @click:row="handleRowClick"
    >
      <!-- Sintaxis de corchetes en vez de "#item.fullName": el "." en un
           nombre de slot corto se interpreta como si fuera un modificador
           de directiva (que v-slot no soporta), así que hay que pasar el
           nombre completo como una expresión dinámica. -->
      <template #[`item.fullName`]="{ item }">
        <span class="font-weight-medium">{{ item.fullName }}</span>
      </template>
    </v-data-table>

    <CustomerFormDialog
      v-model="showFormDialog"
      :tenant-id="session.activeTenantId ?? ''"
      @saved="handleSaved"
    />
  </v-container>
</template>
