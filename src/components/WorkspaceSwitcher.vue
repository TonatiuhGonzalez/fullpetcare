<script setup lang="ts">
// Cabecera del menú lateral (PLAN.md D20): en qué negocio y en qué sucursal se está
// trabajando. Si el negocio tiene más de una sucursal accesible, al presionarla se
// elige otra; con una sola es solo informativa. En el menú "riel" (angosto) solo
// queda la ficha con las iniciales del negocio.
import { computed } from 'vue'

import { initialsOf } from '@/lib/initials'

interface BranchOption {
  id: string
  name: string
}

const props = defineProps<{
  tenantName: string
  branches: BranchOption[]
  activeBranchId: string | null
  // true cuando el menú está colapsado a íconos.
  rail?: boolean
}>()

const emit = defineEmits<{ 'select-branch': [branchId: string] }>()

const activeBranchName = computed(
  () => props.branches.find((b) => b.id === props.activeBranchId)?.name ?? '',
)
const canSwitch = computed(() => props.branches.length > 1)
const initials = computed(() => initialsOf(props.tenantName))
const tooltip = computed(() =>
  [props.tenantName, activeBranchName.value].filter(Boolean).join(' · '),
)
</script>

<template>
  <v-menu :disabled="!canSwitch" location="bottom start" min-width="240">
    <template #activator="{ props: activatorProps }">
      <v-btn
        v-bind="activatorProps"
        variant="text"
        block
        :ripple="canSwitch"
        :class="[
          'workspace',
          { 'workspace--static': !canSwitch, 'workspace--rail': rail },
        ]"
        :title="tooltip"
        :aria-label="`Negocio y sucursal: ${tooltip}`"
      >
        <span class="workspace__tile">{{ initials }}</span>
        <span v-if="!rail" class="workspace__text">
          <span class="workspace__tenant">{{ tenantName }}</span>
          <span class="workspace__branch">{{ activeBranchName }}</span>
        </span>
        <v-icon
          v-if="!rail && canSwitch"
          icon="mdi-unfold-more-horizontal"
          size="small"
        />
      </v-btn>
    </template>

    <v-list density="comfortable" select-strategy="single-leaf">
      <v-list-subheader>Sucursal</v-list-subheader>
      <v-list-item
        v-for="branch in branches"
        :key="branch.id"
        :title="branch.name"
        :active="branch.id === activeBranchId"
        color="primary"
        @click="emit('select-branch', branch.id)"
      >
        <template v-if="branch.id === activeBranchId" #append>
          <v-icon icon="mdi-check" size="small" />
        </template>
      </v-list-item>
    </v-list>
  </v-menu>
</template>

<style scoped lang="scss">
.workspace {
  height: auto !important;
  min-height: 52px;
  justify-content: flex-start;
  padding: 8px;
  text-align: left;
  text-transform: none;
  letter-spacing: 0;

  &--rail {
    justify-content: center;
  }

  // Con una sola sucursal no hay nada que elegir: se ve como etiqueta, no como botón.
  &--static {
    cursor: default;
    pointer-events: none;
  }

  &__tile {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    margin-right: 10px;
    border-radius: 8px;
    font-size: 0.8125rem;
    font-weight: 700;
    background: rgb(var(--v-theme-primary));
    color: rgb(var(--v-theme-on-primary));
  }

  &--rail &__tile {
    margin-right: 0;
  }

  &__text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    line-height: 1.25;
  }

  &__tenant,
  &__branch {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__tenant {
    font-size: 0.875rem;
    font-weight: 700;
  }

  &__branch {
    font-size: 0.75rem;
    font-weight: 400;
    opacity: 0.7;
  }
}
</style>
