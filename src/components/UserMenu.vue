<script setup lang="ts">
// Menú de la persona en la barra superior (PLAN.md D20): avatar con iniciales y, al
// abrirlo, quién es, su rol, configuración, cambio de tema y salir. Reemplaza al chip
// de rol, el nombre suelto y los botones sueltos que había en la barra. Lo comparten
// AppLayout (negocio) y SuperadminLayout (plataforma).
import { computed } from 'vue'

import { initialsOf } from '@/lib/initials'
import type { ThemeMode } from '@/lib/themeMode'
import { useThemeMode } from '@/composables/useThemeMode'

const props = defineProps<{
  name: string
  // Segunda línea del encabezado del menú: el rol ("Dueño", "Superadmin").
  roleLabel: string
  email?: string
  // Si se da, aparece "Configuración" y lleva a esta ruta.
  settingsTo?: string
  // Muestra "Cambiar contraseña" (el superadmin no tiene pantalla de configuración).
  canChangePassword?: boolean
}>()

const emit = defineEmits<{ logout: []; 'change-password': [] }>()

const initials = computed(() => initialsOf(props.name))

const { mode, setMode } = useThemeMode()
const themeOptions: { value: ThemeMode; label: string; icon: string }[] = [
  { value: 'system', label: 'Sistema', icon: 'mdi-laptop' },
  { value: 'light', label: 'Claro', icon: 'mdi-white-balance-sunny' },
  { value: 'dark', label: 'Oscuro', icon: 'mdi-weather-night' },
]

function handleThemeChange(next: unknown): void {
  // v-btn-toggle con `mandatory` nunca manda vacío, pero el tipo lo permite.
  if (next === 'system' || next === 'light' || next === 'dark') setMode(next)
}
</script>

<template>
  <v-menu location="bottom end" :close-on-content-click="false" min-width="280">
    <template #activator="{ props: activatorProps }">
      <v-btn
        v-bind="activatorProps"
        variant="text"
        class="px-1"
        :aria-label="`Menú de ${name}`"
        data-testid="user-menu"
      >
        <v-avatar color="primary" size="32">
          <span class="text-body-2 font-weight-bold">{{ initials }}</span>
        </v-avatar>
        <span class="ml-2 d-none d-md-inline text-body-2">{{ name }}</span>
        <v-icon icon="mdi-chevron-down" size="small" class="ml-1 d-none d-md-inline" />
      </v-btn>
    </template>

    <v-card>
      <div class="d-flex align-center pa-4">
        <v-avatar color="primary" size="40" class="mr-3">
          <span class="font-weight-bold">{{ initials }}</span>
        </v-avatar>
        <div class="user-menu__who">
          <div class="text-body-1 font-weight-bold text-truncate">{{ name }}</div>
          <div class="text-body-2 text-medium-emphasis">{{ roleLabel }}</div>
          <div v-if="email" class="text-caption text-medium-emphasis text-truncate">
            {{ email }}
          </div>
        </div>
      </div>

      <v-divider />

      <v-list density="comfortable">
        <v-list-item
          v-if="settingsTo"
          :to="settingsTo"
          prepend-icon="mdi-cog-outline"
          title="Configuración"
        />
        <v-list-item
          v-if="canChangePassword"
          prepend-icon="mdi-lock-reset"
          title="Cambiar contraseña"
          @click="emit('change-password')"
        />
      </v-list>

      <div class="px-4 pb-3">
        <div class="text-caption text-medium-emphasis mb-1">Apariencia</div>
        <v-btn-toggle
          :model-value="mode"
          mandatory
          divided
          density="comfortable"
          variant="outlined"
          color="primary"
          class="w-100"
          @update:model-value="handleThemeChange"
        >
          <v-btn
            v-for="option in themeOptions"
            :key="option.value"
            :value="option.value"
            :prepend-icon="option.icon"
            size="small"
            class="flex-grow-1"
          >
            {{ option.label }}
          </v-btn>
        </v-btn-toggle>
      </div>

      <v-divider />

      <v-list density="comfortable">
        <v-list-item prepend-icon="mdi-logout" title="Salir" @click="emit('logout')" />
      </v-list>
    </v-card>
  </v-menu>
</template>

<style scoped lang="scss">
.user-menu__who {
  min-width: 0;
}
</style>
