<script setup lang="ts">
// Administración de categorías de producto (fase 13, extensión 13G): crear, renombrar, elegir
// ícono y desactivar. Solo quien tiene "inventory:edit" ve el botón que abre esto; la política
// RLS de `product_categories` es quien de verdad lo exige. Desactivar no toca los productos:
// pasan a "Sin categoría" en el punto de venta.
import { computed, ref, watch } from 'vue'

import { CATEGORY_ICONS, DEFAULT_CATEGORY_ICON } from '@/lib/productCategories'
import type { ProductCategory } from '@/services/productCategories'
import { useInventoryStore } from '@/stores/inventory'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const inventory = useInventoryStore()

const editingId = ref<string | null>(null)
const name = ref('')
const icon = ref(DEFAULT_CATEGORY_ICON)
const saving = ref(false)
const errorMessage = ref<string | null>(null)
const togglingIds = ref<Set<string>>(new Set())

/** Cuántos productos tiene cada categoría (activos e inactivos), para avisar antes de desactivar. */
const productCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const row of inventory.rows) {
    const id = row.product.category_id
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
})

function resetForm(): void {
  editingId.value = null
  name.value = ''
  icon.value = DEFAULT_CATEGORY_ICON
  errorMessage.value = null
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) resetForm()
  },
)

function startEdit(category: ProductCategory): void {
  editingId.value = category.id
  name.value = category.name
  icon.value = category.icon
  errorMessage.value = null
}

async function handleSubmit(): Promise<void> {
  saving.value = true
  errorMessage.value = null
  const error = await inventory.saveCategory(
    { name: name.value, icon: icon.value },
    editingId.value ?? undefined,
  )
  saving.value = false
  if (error) {
    errorMessage.value = error
    return
  }
  resetForm()
}

async function handleToggle(category: ProductCategory): Promise<void> {
  togglingIds.value.add(category.id)
  errorMessage.value = null
  const error = await inventory.setCategoryActive(category.id, !category.is_active)
  if (error) errorMessage.value = error
  togglingIds.value.delete(category.id)
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="560"
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>Categorías de producto</v-card-title>

      <v-card-text>
        <p class="text-body-2 text-medium-emphasis mb-4">
          Agrupan los productos en el punto de venta. Si desactivas una categoría, sus
          productos pasan a «Sin categoría»; no se borran.
        </p>

        <v-form class="mb-4" @submit.prevent="handleSubmit">
          <v-text-field
            v-model="name"
            :label="editingId ? 'Nombre de la categoría' : 'Nueva categoría'"
            maxlength="40"
            density="compact"
            hide-details
            class="mb-3"
          />

          <div class="text-caption text-medium-emphasis mb-1">Ícono</div>
          <v-btn-toggle
            v-model="icon"
            mandatory
            density="compact"
            variant="outlined"
            divided
            class="icon-picker mb-3"
          >
            <v-btn
              v-for="option in CATEGORY_ICONS"
              :key="option.icon"
              :value="option.icon"
              :icon="option.icon"
              :aria-label="option.label"
              :title="option.label"
              size="small"
            />
          </v-btn-toggle>

          <div class="d-flex ga-2">
            <v-btn type="submit" color="primary" :loading="saving">
              {{ editingId ? 'Guardar cambios' : 'Agregar categoría' }}
            </v-btn>
            <v-btn v-if="editingId" variant="text" @click="resetForm"
              >Cancelar edición</v-btn
            >
          </div>
        </v-form>

        <v-alert
          v-if="errorMessage"
          type="error"
          density="compact"
          variant="tonal"
          class="mb-3"
        >
          {{ errorMessage }}
        </v-alert>

        <v-list v-if="inventory.categories.length > 0" density="compact" lines="two">
          <v-list-item v-for="category in inventory.categories" :key="category.id">
            <template #prepend>
              <v-icon
                :icon="category.icon"
                :class="{ 'text-medium-emphasis': !category.is_active }"
              />
            </template>
            <template #title>
              <span :class="{ 'text-medium-emphasis': !category.is_active }">
                {{ category.name }}
              </span>
              <v-chip
                v-if="!category.is_active"
                size="x-small"
                class="ml-2"
                variant="tonal"
              >
                desactivada
              </v-chip>
            </template>
            <template #subtitle>
              {{ productCounts.get(category.id) ?? 0 }}
              {{ (productCounts.get(category.id) ?? 0) === 1 ? 'producto' : 'productos' }}
            </template>
            <template #append>
              <v-btn
                icon="mdi-pencil"
                variant="text"
                size="small"
                :aria-label="`Editar ${category.name}`"
                @click="startEdit(category)"
              />
              <v-btn
                :icon="category.is_active ? 'mdi-eye-off-outline' : 'mdi-eye-outline'"
                variant="text"
                size="small"
                :aria-label="`${category.is_active ? 'Desactivar' : 'Activar'} ${category.name}`"
                :disabled="togglingIds.has(category.id)"
                @click="handleToggle(category)"
              />
            </template>
          </v-list-item>
        </v-list>
        <p v-else class="text-body-2 text-medium-emphasis mb-0">
          Todavía no hay categorías. Agrega la primera arriba.
        </p>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn @click="emit('update:modelValue', false)">Cerrar</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped lang="scss">
// Los 24 íconos caben en varias filas en vez de una sola larguísima.
.icon-picker {
  flex-wrap: wrap;
  height: auto;
}
</style>
