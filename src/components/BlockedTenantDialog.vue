<script setup lang="ts">
// Aviso que ve la persona al iniciar sesión cuando algún negocio suyo está en
// solo lectura o dado de baja. Componente tonto: recibe los avisos y avisa por
// eventos; no llama a ningún servicio.
//
// El botón de pago es un MOCK (v1 no tiene pasarela real, CLAUDE.md §1): solo
// emite `pay`, y el padre decide qué mostrar. Cuando exista el cobro real, se
// conecta ahí sin tocar este diálogo.
import { computed } from 'vue'

import type { TenantNotice } from '@/services/tenantAccess'

const props = defineProps<{
  modelValue: boolean
  notices: TenantNotice[]
  /** true si puede entrar a algún negocio: el botón de cierre dice "Continuar" en vez de "Salir". */
  canContinue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  pay: [notice: TenantNotice]
  close: []
}>()

const items = computed(() =>
  props.notices.map((n) => ({
    notice: n,
    headline:
      n.notice === 'blocked'
        ? 'Este negocio fue dado de baja y ya no se puede acceder a su información.'
        : 'Este negocio está en modo solo lectura: puedes consultar tu información, pero no hacer cambios.',
    // Solo el dueño puede regularizar el pago; una baja no se paga, se reactiva con soporte.
    canPay: n.role === 'owner' && n.notice === 'read_only',
  })),
)
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="480"
    persistent
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon icon="mdi-lock-alert" color="warning" class="mr-2" />
        Acceso limitado
      </v-card-title>

      <v-card-text>
        <div v-for="item in items" :key="item.notice.tenantId" class="mb-4">
          <p class="text-subtitle-1 font-weight-medium">{{ item.notice.tenantName }}</p>
          <p>{{ item.headline }}</p>
          <p v-if="item.notice.publicReason" class="mt-1">
            <strong>Motivo:</strong> {{ item.notice.publicReason }}
          </p>

          <div v-if="item.canPay" class="mt-3">
            <v-btn
              color="primary"
              prepend-icon="mdi-credit-card"
              @click="emit('pay', item.notice)"
            >
              Pagar ahora
            </v-btn>
          </div>
          <p
            v-else-if="item.notice.role !== 'owner' && item.notice.notice === 'read_only'"
            class="text-body-2 text-medium-emphasis mt-2"
          >
            Pide al dueño del negocio que regularice la cuenta.
          </p>
          <p
            v-else-if="item.notice.notice === 'blocked'"
            class="text-body-2 text-medium-emphasis mt-2"
          >
            Comunícate con el equipo de FullPetCare para reactivarlo.
          </p>
        </div>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn @click="emit('close')">{{ canContinue ? 'Continuar' : 'Salir' }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
