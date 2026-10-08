<script setup lang="ts">
// Diálogo de confirmación para eliminar (borrado suave). Solo pregunta: quien
// lo usa decide qué se elimina y muestra el error si falla.
defineProps<{
  modelValue: boolean
  title: string
  message: string
  loading?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: []
}>()
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="420"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>{{ title }}</v-card-title>
      <v-card-text>{{ message }}</v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="loading"
          @click="emit('update:modelValue', false)"
        >
          Cancelar
        </v-btn>
        <v-btn color="error" :loading="loading" @click="emit('confirm')">Confirmar</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
