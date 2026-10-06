<script setup lang="ts">
// Menú lateral de navegación, compartido por AppLayout (negocio) y
// SuperadminLayout (plataforma). Es "tonto": recibe las opciones ya
// filtradas por rol/permiso desde el layout y solo las pinta.
//
// Dos modos según el ancho de pantalla:
//  - Escritorio: fijo a la izquierda; el botón de abajo lo alterna entre
//    expandido y "riel" (columna angosta solo con íconos). Siempre arranca
//    expandido (el estado no se guarda).
//  - Móvil: oculto; el botón de hamburguesa del layout lo abre como cajón
//    sobre el contenido (v-model "open").
import { ref } from 'vue'
import { useDisplay } from 'vuetify'

export interface SideMenuItem {
  title: string
  icon: string
  to: string
}

defineProps<{ items: SideMenuItem[] }>()

const open = defineModel<boolean>('open', { default: false })

// smAndDown (< 960 px) coincide con la clase "d-md-none" de la hamburguesa en los
// layouts; el "mobile" por defecto de Vuetify corta en 1280 px y no cuadraría.
const { smAndDown: mobile } = useDisplay()
const rail = ref(false)
// En escritorio el cajón siempre se muestra: se le pasa true en vez de "open".
// Vuetify no activa un cajón "permanent" si arranca con model-value false.
</script>

<template>
  <v-navigation-drawer
    :model-value="mobile ? open : true"
    :permanent="!mobile"
    :temporary="mobile"
    :rail="!mobile && rail"
    @update:model-value="open = $event"
  >
    <v-list nav density="comfortable">
      <!-- "title" también va en el tooltip nativo: en modo riel solo se ve el
           ícono y sin esto no se sabría a qué vista lleva. -->
      <v-list-item
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        :prepend-icon="item.icon"
        :title="item.title"
        :aria-label="item.title"
        color="primary"
        @click="open = false"
      />
    </v-list>

    <template v-if="!mobile" #append>
      <v-list nav density="comfortable">
        <v-list-item
          :prepend-icon="rail ? 'mdi-chevron-right' : 'mdi-chevron-left'"
          :title="rail ? 'Expandir menú' : 'Colapsar menú'"
          @click="rail = !rail"
        />
      </v-list>
    </template>
  </v-navigation-drawer>
</template>
