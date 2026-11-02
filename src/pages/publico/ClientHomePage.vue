<script setup lang="ts">
// Inicio de la app instalada (fase 16A, PLAN.md D21). El manifiesto abre la app en `/c`,
// sin token: si este teléfono ya abrió un link de mascota, lo lleva ahí; si no, explica que
// hay que abrir el link que mandó el negocio. No pide ni muestra datos por sí misma: la
// información sigue viniendo de la vista pública con token (§7.4).
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { readLastPetLink } from '@/lib/lastPetLink'

const router = useRouter()
const checked = ref(false)

onMounted(() => {
  const token = readLastPetLink()
  if (token) {
    router.replace({ name: 'mascota-publica', params: { token } })
    return
  }
  checked.value = true
})
</script>

<template>
  <v-container max-width="480" class="py-6">
    <v-card v-if="checked" class="pa-6 text-center">
      <v-icon icon="mdi-link-variant" size="48" color="primary" class="mb-3" />
      <h1 class="text-h6 font-weight-bold mb-2">Abre el link de tu mascota</h1>
      <p class="text-body-2 text-medium-emphasis">
        Para ver la cartilla y el historial de tu mascota, abre el link que te envió la
        clínica por mensaje. Después de abrirlo una vez, esta app te llevará directo a
        ella.
      </p>
    </v-card>
  </v-container>
</template>
