<script setup lang="ts">
// Cabecera del menú lateral (PLAN.md D20): en qué negocio y en qué sucursal se está
// trabajando. Si el negocio tiene más de una sucursal accesible, al presionarla se
// elige otra; con una sola es solo informativa. En el menú "riel" (angosto) solo
// queda la ficha con las iniciales del negocio.
import { computed, ref, watch } from 'vue'

import { initialsOf } from '@/lib/initials'

interface BranchOption {
  id: string
  name: string
}

const props = defineProps<{
  tenantName: string
  // URL firmada de la imagen de la empresa (fase 26); sin ella se muestran las iniciales.
  logoUrl?: string | null
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
// Si la imagen no carga (URL caducada, archivo borrado) se vuelve a las iniciales.
const logoFailed = ref(false)
watch(
  () => props.logoUrl,
  () => {
    logoFailed.value = false
  },
)
const showLogo = computed(() => !!props.logoUrl && !logoFailed.value)
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
        <span :class="['workspace__tile', { 'workspace__tile--image': showLogo }]">
          <img v-if="showLogo" :src="logoUrl ?? ''" alt="" @error="logoFailed = true" />
          <template v-else>{{ initials }}</template>
        </span>
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

  // Con imagen, el fondo de marca y el texto sobran: la imagen llena la ficha y el borde fino
  // la separa del menú aunque el logotipo tenga fondo blanco.
  &__tile--image {
    overflow: hidden;
    background: rgb(var(--v-theme-surface));
    border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
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
