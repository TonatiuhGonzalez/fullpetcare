<script setup lang="ts">
// Muestra UNA sola vez la contraseña temporal que generó la Edge Function
// platform-admin (alta de empresa, restablecer contraseña, agregar
// superadmin). Es la única oportunidad de verla: el servidor no la guarda y
// no hay forma de recuperarla después — por eso el diálogo es "persistent"
// (no se cierra al hacer clic afuera ni con Esc) y solo se cierra con el
// botón explícito.
//
// Componente tonto: recibe la contraseña por props y no la guarda en ningún
// lado. Quien lo abre es responsable de borrarla de su propio estado al
// cerrarse.
import { ref, watch } from 'vue'

const props = defineProps<{
  modelValue: boolean
  title: string
  email: string | null
  password: string
  /** Aviso que no impide continuar (p. ej. las sesiones abiertas no se pudieron cerrar). */
  warning?: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const copied = ref(false)
const copyFailed = ref(false)

// Cada vez que se abre, el estado del botón "Copiar" empieza limpio: si no,
// una segunda contraseña mostraría "¡Copiada!" sin haberse copiado.
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      copied.value = false
      copyFailed.value = false
    }
  },
)

async function copyPassword(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.password)
    copied.value = true
    copyFailed.value = false
  } catch {
    // Sin permiso de portapapeles (o contexto no seguro): se avisa y se
    // deja la contraseña seleccionable para copiarla a mano.
    copied.value = false
    copyFailed.value = true
  }
}
</script>

<template>
  <v-dialog :model-value="modelValue" persistent max-width="480">
    <v-card>
      <v-card-title>{{ title }}</v-card-title>

      <v-card-text>
        <v-alert type="warning" density="compact" variant="tonal" class="mb-4">
          Esta contraseña se muestra <strong>una sola vez</strong>. Cópiala y entrégasela a la
          persona antes de cerrar esta ventana: no se podrá volver a ver.
        </v-alert>

        <v-alert v-if="warning" type="error" density="compact" variant="tonal" class="mb-4">
          {{ warning }}
        </v-alert>

        <div v-if="email" class="mb-3">
          <div class="text-caption text-medium-emphasis">Correo de acceso</div>
          <div class="text-body-1">{{ email }}</div>
        </div>

        <div class="text-caption text-medium-emphasis">Contraseña temporal</div>
        <div class="password-box d-flex align-center">
          <code class="password-text">{{ password }}</code>
          <v-spacer />
          <v-btn
            :prepend-icon="copied ? 'mdi-check' : 'mdi-content-copy'"
            :color="copied ? 'success' : undefined"
            variant="tonal"
            size="small"
            @click="copyPassword"
          >
            {{ copied ? '¡Copiada!' : 'Copiar' }}
          </v-btn>
        </div>
        <div v-if="copyFailed" class="text-caption text-error mt-1">
          No se pudo copiar automáticamente. Selecciónala y cópiala a mano.
        </div>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn color="primary" variant="flat" @click="emit('update:modelValue', false)">
          Ya la copié
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped lang="scss">
.password-box {
  padding: 12px 16px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
}

.password-text {
  font-size: 1.25rem;
  letter-spacing: 0.08em;
  // Un clic selecciona toda la contraseña: útil si el portapapeles falla.
  user-select: all;
}
</style>
