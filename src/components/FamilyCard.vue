<script setup lang="ts">
// La familia de un cliente (fase 31, PLAN.md D30 punto 7): su nombre con las mascotas de sus
// miembros ("Familia Pérez – Nube, Toby"), los miembros con su titular, y los botones para
// crearla, corregirla o disolverla. Se pinta en la página del cliente.
import { computed, onMounted, ref, watch } from 'vue'

import ConfirmDeleteDialog from '@/components/ConfirmDeleteDialog.vue'
import FamilyFormDialog from '@/components/FamilyFormDialog.vue'
import { familyErrorMessage, familyLabel } from '@/lib/family'
import * as familiesService from '@/services/families'
import type { FamilyWithMembers } from '@/services/families'
import * as petsService from '@/services/pets'

const props = defineProps<{
  tenantId: string
  customerId: string
  canEdit: boolean
}>()

const emit = defineEmits<{ changed: [] }>()

const family = ref<FamilyWithMembers | null>(null)
const petNames = ref<string[]>([])
const loading = ref(false)
const errorMessage = ref<string | null>(null)
const showForm = ref(false)
const showDissolve = ref(false)
const dissolving = ref(false)

const label = computed(() =>
  family.value ? familyLabel(family.value.family.name, petNames.value) : '',
)

async function load(): Promise<void> {
  loading.value = true
  errorMessage.value = null
  try {
    family.value = await familiesService.getByCustomer(props.tenantId, props.customerId)
    if (family.value) {
      const lists = await Promise.all(
        family.value.members.map((m) =>
          petsService.listByCustomer(props.tenantId, m.customerId),
        ),
      )
      petNames.value = lists.flat().map((p) => p.name)
    } else {
      petNames.value = []
    }
  } catch {
    errorMessage.value = 'No se pudo cargar la familia. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => props.customerId, load)

async function handleSaved(): Promise<void> {
  await load()
  emit('changed')
}

async function dissolve(): Promise<void> {
  if (!family.value) return
  dissolving.value = true
  try {
    await familiesService.remove(family.value.family.id)
    showDissolve.value = false
    await load()
    emit('changed')
  } catch (error) {
    showDissolve.value = false
    errorMessage.value = familyErrorMessage(
      error,
      'No se pudo disolver la familia. Revisa tu conexión.',
    )
  } finally {
    dissolving.value = false
  }
}
</script>

<template>
  <v-card variant="outlined" class="pa-4 mb-4" data-testid="family-card">
    <div class="d-flex flex-wrap align-center ga-2">
      <v-icon icon="mdi-account-group-outline" color="primary" />
      <div class="flex-grow-1" style="min-width: 0">
        <div class="text-overline text-medium-emphasis">Familia</div>
        <div v-if="family" class="font-weight-medium text-truncate">{{ label }}</div>
        <div v-else-if="!loading" class="text-body-2 text-medium-emphasis">
          Este cliente no pertenece a una familia.
        </div>
      </div>
      <template v-if="canEdit">
        <v-btn
          v-if="family"
          variant="tonal"
          color="primary"
          size="small"
          prepend-icon="mdi-pencil"
          @click="showForm = true"
        >
          Editar
        </v-btn>
        <v-btn v-if="family" variant="text" size="small" @click="showDissolve = true">
          Disolver
        </v-btn>
        <v-btn
          v-else-if="!loading"
          variant="tonal"
          color="primary"
          size="small"
          prepend-icon="mdi-plus"
          @click="showForm = true"
        >
          Crear familia
        </v-btn>
      </template>
    </div>

    <div v-if="family" class="d-flex flex-wrap ga-2 mt-3">
      <v-chip
        v-for="member in family.members"
        :key="member.customerId"
        size="small"
        variant="tonal"
        :prepend-icon="member.isHolder ? 'mdi-star-outline' : 'mdi-account-outline'"
      >
        {{ member.name }}<template v-if="member.isHolder"> · titular</template>
      </v-chip>
    </div>

    <v-alert
      v-if="errorMessage"
      type="error"
      density="compact"
      variant="tonal"
      class="mt-3"
    >
      {{ errorMessage }}
    </v-alert>

    <FamilyFormDialog
      v-model="showForm"
      :tenant-id="tenantId"
      :customer-id="customerId"
      :family="family"
      @saved="handleSaved"
    />
    <ConfirmDeleteDialog
      v-model="showDissolve"
      title="Disolver familia"
      :message="`¿Disolver ${family?.family.name ?? 'la familia'}? Sus miembros quedan libres; los clientes y las mascotas no se eliminan.`"
      :loading="dissolving"
      @confirm="dissolve"
    />
  </v-card>
</template>
