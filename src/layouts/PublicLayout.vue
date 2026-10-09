<script setup lang="ts">
// Layout de la vista pública (tarea 7.11): SIN nada de la navegación
// interna (agenda, clientes, catálogo, selector de sucursal, botón de
// salir) — quien abre `/c/:token` no tiene sesión ni la necesita. Móvil
// primero: es un link que se abre desde WhatsApp en un teléfono, no desde
// el navegador de escritorio de un empleado.
//
// El nombre del negocio no se conoce hasta que PublicPetPage.vue termina
// de cargar (viene en la respuesta de la Edge Function, no de una ruta
// interna con sesión) — se recibe por evento en vez de traerlo aparte
// aquí: pedirlo dos veces sería una llamada de más a la función pública
// por la misma información.
//
// Identidad (PLAN.md D20): la barra lleva el nombre del NEGOCIO (con quien tiene
// relación quien abre el link), no el de la plataforma; mientras carga, el logo de
// FullPetCare. El logo de la plataforma queda discreto al pie.
import { computed, ref } from 'vue'

import BrandLogo from '@/components/BrandLogo.vue'
import { initialsOf } from '@/lib/initials'

const businessName = ref('')
const initials = computed(() => initialsOf(businessName.value))
</script>

<template>
  <v-app-bar color="surface" density="comfortable" flat border="b">
    <div class="public-brand">
      <template v-if="businessName">
        <span class="public-brand__tile" aria-hidden="true">{{ initials }}</span>
        <span class="text-subtitle-1 font-weight-bold text-truncate">{{ businessName }}</span>
      </template>
      <BrandLogo v-else :size="26" />
    </div>
  </v-app-bar>

  <v-main>
    <router-view v-slot="{ Component }">
      <component :is="Component" @business-name="businessName = $event" />
    </router-view>

    <footer class="public-footer">
      <BrandLogo :size="16" />
    </footer>
  </v-main>
</template>

<style scoped lang="scss">
.public-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 0 16px;

  &__tile {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 8px;
    font-size: 0.8125rem;
    font-weight: 700;
    background: rgb(var(--v-theme-primary));
    color: rgb(var(--v-theme-on-primary));
  }
}

.public-footer {
  display: flex;
  justify-content: center;
  padding: 24px 16px 32px;
  opacity: 0.6;
}
</style>
