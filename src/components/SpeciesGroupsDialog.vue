<script setup lang="ts">
// Grandes grupos de especies (fase 27, tarea 27.9): agregar, renombrar y ocultar. Un grupo
// que todavía tiene especies no se oculta (quedarían sin lugar en el formulario).
import { ref, watch } from 'vue'

import IconButton from '@/components/IconButton.vue'
import { isDuplicateName } from '@/lib/speciesCatalog'
import * as speciesService from '@/services/species'
import type { Species, SpeciesGroup } from '@/services/species'

const props = defineProps<{
  modelValue: boolean
  tenantId: string
  groups: SpeciesGroup[]
  species: Species[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  changed: []
}>()

const name = ref('')
const editing = ref<SpeciesGroup | null>(null)
const saving = ref(false)
const errorMessage = ref<string | null>(null)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    name.value = ''
    editing.value = null
    errorMessage.value = null
  },
)

function speciesCount(groupId: string): number {
  return props.species.filter((s) => s.group_id === groupId).length
}

function startEdit(group: SpeciesGroup): void {
  editing.value = group
  name.value = group.name
  errorMessage.value = null
}

function cancelEdit(): void {
  editing.value = null
  name.value = ''
}

async function save(): Promise<void> {
  const value = name.value.trim()
  if (value === '') {
    errorMessage.value = 'Escribe el nombre del grupo.'
    return
  }
  if (isDuplicateName(props.groups, value, editing.value?.id)) {
    errorMessage.value = 'Ya hay un grupo con este nombre.'
    return
  }
  saving.value = true
  errorMessage.value = null
  try {
    if (editing.value) await speciesService.updateGroup(editing.value.id, value)
    else {
      const next = Math.max(0, ...props.groups.map((g) => g.sort_order)) + 1
      await speciesService.createGroup(props.tenantId, value, next)
    }
    cancelEdit()
    emit('changed')
  } catch {
    errorMessage.value = 'No se pudo guardar el grupo. Revisa tu conexión.'
  } finally {
    saving.value = false
  }
}

async function hide(group: SpeciesGroup): Promise<void> {
  errorMessage.value = null
  try {
    await speciesService.hideGroup(group.id)
    emit('changed')
  } catch {
    errorMessage.value = 'No se pudo ocultar el grupo. Revisa tu conexión.'
  }
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="480"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>Grupos de especies</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="name"
          :label="editing ? 'Nombre del grupo' : 'Nuevo grupo'"
          @keyup.enter="save"
        />
        <div class="d-flex justify-end ga-2 mb-3">
          <v-btn v-if="editing" variant="text" @click="cancelEdit"
            >Cancelar edición</v-btn
          >
          <v-btn color="primary" :loading="saving" @click="save">
            {{ editing ? 'Guardar cambios' : 'Agregar grupo' }}
          </v-btn>
        </div>

        <v-alert
          v-if="errorMessage"
          type="error"
          density="compact"
          variant="tonal"
          class="mb-3"
        >
          {{ errorMessage }}
        </v-alert>

        <v-list density="compact">
          <v-list-item
            v-for="group in groups"
            :key="group.id"
            :title="group.name"
            :subtitle="`${speciesCount(group.id)} especies`"
          >
            <template #append>
              <IconButton
                icon="mdi-pencil"
                color="primary"
                variant="text"
                size="small"
                :aria-label="`Renombrar ${group.name}`"
                @click="startEdit(group)"
              />
              <IconButton
                icon="mdi-eye-off-outline"
                variant="text"
                size="small"
                :disabled="speciesCount(group.id) > 0"
                :aria-label="
                  speciesCount(group.id) > 0
                    ? `${group.name} tiene especies: ocúltalas o muévelas primero`
                    : `Ocultar ${group.name}`
                "
                @click="hide(group)"
              />
            </template>
          </v-list-item>
        </v-list>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="emit('update:modelValue', false)">Cerrar</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
