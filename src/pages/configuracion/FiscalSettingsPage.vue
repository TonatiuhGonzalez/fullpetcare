<script setup lang="ts">
// Sección "Facturación" de la configuración (tarea 11.15 / #2044). Solo el
// dueño llega aquí (router + RLS). Tres pasos: capturar los datos fiscales,
// subir el certificado digital (va directo al proveedor de facturas, no se
// guarda) y ver si el negocio quedó listo para facturar.
import { computed, onMounted, ref } from 'vue'

import { TAX_REGIMES, fiscalProblems, isReadyToInvoice } from '@/lib/fiscalSetup'
import type { FiscalData, InvoicingStatus } from '@/lib/fiscalSetup'
import * as invoicing from '@/services/invoicingSettings'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const tenantId = computed(() => session.activeTenantId ?? '')

const form = ref<FiscalData>({
  rfc: '',
  legal_name: '',
  tax_regime_code: null,
  postal_code: '',
})
const status = ref<InvoicingStatus>({ csdValidUntil: null })
// Lo ya guardado: la lista de pendientes se calcula sobre esto, no sobre lo que
// se está tecleando (si no, "listo" aparecería antes de guardar).
const saved = ref<FiscalData>({
  rfc: null,
  legal_name: null,
  tax_regime_code: null,
  postal_code: null,
})

const cerFile = ref<File | null>(null)
const keyFile = ref<File | null>(null)
const password = ref('')

const loading = ref(false)
const saving = ref(false)
const uploading = ref(false)
const errorMessage = ref<string | null>(null)
const snackbar = ref({ show: false, text: '', color: 'success' })

const problems = computed(() => fiscalProblems(saved.value, status.value))
const isReady = computed(() => isReadyToInvoice(saved.value, status.value))
const csdDate = computed(() =>
  status.value.csdValidUntil
    ? new Date(status.value.csdValidUntil).toLocaleDateString('es-MX', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null,
)
const regimeItems = TAX_REGIMES.map((r) => ({
  value: r.code,
  title: `${r.code} · ${r.title}`,
}))
const canUpload = computed(
  () =>
    !!cerFile.value && !!keyFile.value && password.value.length > 0 && !uploading.value,
)

function notify(text: string, color = 'success'): void {
  snackbar.value = { show: true, text, color }
}

async function load(): Promise<void> {
  if (!tenantId.value) return
  loading.value = true
  errorMessage.value = null
  try {
    const setup = await invoicing.getSetup(tenantId.value)
    saved.value = { ...setup.data }
    form.value = {
      rfc: setup.data.rfc ?? '',
      legal_name: setup.data.legal_name ?? '',
      tax_regime_code: setup.data.tax_regime_code,
      postal_code: setup.data.postal_code ?? '',
    }
    status.value = setup.status
  } catch {
    errorMessage.value = 'No se pudo cargar la configuración. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function saveData(): Promise<void> {
  saving.value = true
  try {
    await invoicing.saveFiscalData(tenantId.value, {
      ...form.value,
      rfc: (form.value.rfc ?? '').trim().toUpperCase(),
    })
    // Si el RFC cambió, la base borra la vigencia del certificado anterior;
    // se recarga para reflejarlo.
    await load()
    notify('Datos fiscales guardados.')
  } catch (e) {
    notify(e instanceof Error ? e.message : 'No se pudieron guardar los datos.', 'error')
  } finally {
    saving.value = false
  }
}

async function uploadCertificate(): Promise<void> {
  if (!cerFile.value || !keyFile.value) return
  uploading.value = true
  try {
    status.value = await invoicing.syncWithPac(tenantId.value, {
      cer: cerFile.value,
      key: keyFile.value,
      password: password.value,
    })
    // El certificado ya está en el proveedor: no se conserva nada aquí.
    cerFile.value = null
    keyFile.value = null
    password.value = ''
    notify('Certificado cargado.')
  } catch (e) {
    notify(e instanceof Error ? e.message : 'No se pudo cargar el certificado.', 'error')
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <div>
    <h1 class="text-h5 mb-4">Facturación</h1>

    <v-alert
      v-if="errorMessage"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-4"
    >
      {{ errorMessage }}
    </v-alert>

    <v-alert
      v-if="!loading && isReady"
      type="success"
      variant="tonal"
      density="compact"
      class="mb-4"
      title="Listo para facturar"
    >
      Tus datos fiscales están completos y tu certificado vence el {{ csdDate }}.
    </v-alert>
    <v-alert
      v-else-if="!loading"
      type="warning"
      variant="tonal"
      density="compact"
      class="mb-4"
      title="Aún no puedes facturar"
    >
      <ul class="pl-4">
        <li v-for="problem in problems" :key="problem.field">{{ problem.message }}</li>
      </ul>
    </v-alert>

    <v-card class="mb-6" variant="outlined">
      <v-card-title class="text-subtitle-1">1. Datos fiscales</v-card-title>
      <v-card-text>
        <p class="text-body-2 text-medium-emphasis mb-4">
          Cópialos tal como aparecen en tu constancia de situación fiscal del SAT.
        </p>
        <v-form @submit.prevent="saveData">
          <v-row dense>
            <v-col cols="12" sm="6">
              <v-text-field
                v-model="form.rfc"
                label="RFC"
                maxlength="13"
                :disabled="loading"
              />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field
                v-model="form.postal_code"
                label="Código postal del domicilio fiscal"
                maxlength="5"
                :disabled="loading"
              />
            </v-col>
            <v-col cols="12">
              <v-text-field
                v-model="form.legal_name"
                label="Razón social"
                :disabled="loading"
              />
            </v-col>
            <v-col cols="12">
              <v-select
                v-model="form.tax_regime_code"
                :items="regimeItems"
                label="Régimen fiscal"
                :disabled="loading"
              />
            </v-col>
          </v-row>
          <v-btn type="submit" color="primary" :loading="saving" :disabled="loading"
            >Guardar</v-btn
          >
        </v-form>
      </v-card-text>
    </v-card>

    <v-card variant="outlined">
      <v-card-title class="text-subtitle-1">2. Certificado digital</v-card-title>
      <v-card-text>
        <p class="text-body-2 text-medium-emphasis mb-2">
          Es la firma electrónica con la que se sellan tus facturas: dos archivos (.cer y
          .key) y su contraseña, que te entrega el SAT. Se envían directo al proveedor de
          facturas; nosotros no los guardamos.
        </p>
        <p v-if="csdDate" class="text-body-2 mb-2">
          Certificado cargado, vigente hasta el {{ csdDate }}. Puedes subir uno nuevo para
          reemplazarlo.
        </p>
        <v-alert
          v-if="problems.some((p) => p.field !== 'csd')"
          type="info"
          variant="tonal"
          density="compact"
          class="mb-4"
        >
          Primero completa y guarda tus datos fiscales.
        </v-alert>
        <v-file-input
          v-model="cerFile"
          label="Archivo .cer"
          accept=".cer"
          prepend-icon=""
          prepend-inner-icon="mdi-paperclip"
        />
        <v-file-input
          v-model="keyFile"
          label="Archivo .key"
          accept=".key"
          prepend-icon=""
          prepend-inner-icon="mdi-paperclip"
        />
        <v-text-field
          v-model="password"
          label="Contraseña de la llave privada"
          type="password"
          autocomplete="off"
        />
        <v-btn
          color="primary"
          :loading="uploading"
          :disabled="!canUpload || problems.some((p) => p.field !== 'csd')"
          @click="uploadCertificate"
        >
          Subir certificado
        </v-btn>
      </v-card-text>
    </v-card>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="5000">
      {{ snackbar.text }}
    </v-snackbar>
  </div>
</template>
