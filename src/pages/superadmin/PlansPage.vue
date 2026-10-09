<script setup lang="ts">
// Catálogo de planes (tarea #1906). Mismo molde que ReasonsPage.vue: alta,
// renombrar y activar/desactivar. Un plan ya asignado no se borra: se
// desactiva y deja de ofrecerse para asignaciones nuevas, pero las empresas
// que ya lo tienen lo conservan (tenant_platform_info.plan_name_snapshot).
import { onMounted, ref } from 'vue'

import * as platformService from '@/services/platform'
import type { Plan } from '@/services/platform'
import PageHeader from '@/components/PageHeader.vue'

const plans = ref<Plan[]>([])
const loading = ref(false)
const errorMessage = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  errorMessage.value = null
  try {
    plans.value = await platformService.listPlans()
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'No se pudieron cargar los planes.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

// --- Alta -------------------------------------------------------------------
const newName = ref('')
const saving = ref(false)

async function addPlan(): Promise<void> {
  if (newName.value.trim() === '') return
  saving.value = true
  errorMessage.value = null
  try {
    await platformService.createPlan(newName.value)
    newName.value = ''
    await load()
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'No se pudo guardar el plan.'
  } finally {
    saving.value = false
  }
}

// --- Edición ----------------------------------------------------------------
const editing = ref<Plan | null>(null)
const editName = ref('')

function startEdit(plan: Plan): void {
  editing.value = plan
  editName.value = plan.name
}

async function saveEdit(): Promise<void> {
  if (!editing.value) return
  await update(editing.value, editName.value, editing.value.isActive)
  editing.value = null
}

async function toggleActive(plan: Plan): Promise<void> {
  await update(plan, plan.name, !plan.isActive)
}

async function update(plan: Plan, name: string, isActive: boolean): Promise<void> {
  errorMessage.value = null
  try {
    await platformService.updatePlan(plan.id, name, isActive)
    await load()
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'No se pudo guardar el plan.'
  }
}
</script>

<template>
  <v-container>
    <PageHeader title="Planes" subtitle="Son los planes que puedes asignar a una empresa. Es solo informativo: el plan por sí solo no limita nada — lo que controla el acceso es el estado y, si la vigencia vence, el modo solo lectura. Un plan ya asignado no se borra: se desactiva y deja de ofrecerse para asignaciones nuevas." />

    <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mb-4">
      {{ errorMessage }}
    </v-alert>

    <v-form class="d-flex ga-2 mb-4" @submit.prevent="addPlan">
      <v-text-field
        v-model="newName"
        label="Nuevo plan"
        density="compact"
        hide-details
        placeholder="Ej. Pro"
      />
      <v-btn type="submit" color="primary" :loading="saving" :disabled="newName.trim() === ''">
        Agregar
      </v-btn>
    </v-form>

    <v-progress-linear v-if="loading" indeterminate class="mb-2" />

    <v-table density="comfortable">
      <thead>
        <tr>
          <th>Plan</th>
          <th>Activo</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="plan in plans" :key="plan.id">
          <td :class="{ 'text-medium-emphasis': !plan.isActive }">{{ plan.name }}</td>
          <td>
            <v-switch
              :model-value="plan.isActive"
              density="compact"
              hide-details
              color="primary"
              @update:model-value="toggleActive(plan)"
            />
          </td>
          <td class="text-right">
            <v-btn
              icon="mdi-pencil"
              variant="text"
              size="small"
              title="Renombrar"
              @click="startEdit(plan)"
            />
          </td>
        </tr>
      </tbody>
    </v-table>

    <v-dialog
      :model-value="editing !== null"
      max-width="420"
      @update:model-value="editing = null"
    >
      <v-card>
        <v-card-title>Renombrar plan</v-card-title>
        <v-card-text>
          <v-text-field v-model="editName" label="Nombre del plan" />
          <p class="text-caption text-medium-emphasis">
            Las empresas que ya tienen este plan conservan el nombre con el que se les
            asignó.
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="editing = null">Cancelar</v-btn>
          <v-btn color="primary" :disabled="editName.trim() === ''" @click="saveEdit">
            Guardar
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>
