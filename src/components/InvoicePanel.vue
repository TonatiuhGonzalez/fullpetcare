<script setup lang="ts">
// Panel de factura de una venta (tarea 11.19). Componente "tonto" (CLAUDE.md
// §4): recibe la factura vigente y los datos precargados, y emite lo que quiere
// hacer quien factura; SaleDetailPage habla con el servicio.
import { computed, ref, watch } from 'vue'

import { CANCEL_MOTIVES, INVOICE_STATUS_LABELS, PAYMENT_FORMS } from '@/lib/invoiceStatus'
import type { InvoiceStatus } from '@/lib/invoiceStatus'
import type { InvoiceReceiver } from '@/services/invoicing'
import type { InvoiceRequest } from '@/services/invoicing'

const props = defineProps<{
  invoice: InvoiceRequest | null
  /** Datos fiscales del cliente (precargados); pueden venir vacíos. */
  receiver: InvoiceReceiver
  /** Forma de pago con la que se cobró; se puede corregir antes de emitir. */
  paymentFormCode: string | null
  canEdit: boolean
  busy: boolean
  error: string | null
}>()

const emit = defineEmits<{
  stamp: [receiver: InvoiceReceiver, paymentFormCode: string | null]
  cancel: [motive: string]
  open: [kind: 'xml' | 'pdf']
  refetch: []
}>()

const form = ref<InvoiceReceiver>({ ...props.receiver })
const paymentForm = ref<string | null>(props.paymentFormCode)
watch(
  () => props.receiver,
  (value) => (form.value = { ...value }),
)
watch(
  () => props.paymentFormCode,
  (value) => (paymentForm.value = value),
)

const showCancel = ref(false)
const motive = ref<string>(CANCEL_MOTIVES[0].code)

const status = computed(() => props.invoice?.status as InvoiceStatus | undefined)
const statusLabel = computed(() =>
  status.value ? INVOICE_STATUS_LABELS[status.value] : null,
)
const canIssue = computed(
  () => !status.value || status.value === 'pending' || status.value === 'cancelled',
)
const hasFiles = computed(() => !!props.invoice?.xml_path && !!props.invoice?.pdf_path)

function handleStamp(): void {
  emit(
    'stamp',
    { ...form.value, rfc: form.value.rfc.trim().toUpperCase() },
    paymentForm.value,
  )
}

function handleCancel(): void {
  showCancel.value = false
  emit('cancel', motive.value)
}
</script>

<template>
  <v-card variant="outlined" class="pa-4 no-print">
    <div class="d-flex align-center mb-3">
      <h2 class="text-h6">Factura</h2>
      <v-chip
        v-if="statusLabel"
        class="ml-3"
        size="small"
        variant="tonal"
        :color="statusLabel.color"
      >
        {{ statusLabel.title }}
      </v-chip>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3">
      {{ error }}
    </v-alert>
    <v-alert
      v-else-if="invoice?.error_message && status === 'pending'"
      type="warning"
      variant="tonal"
      density="compact"
      class="mb-3"
    >
      El último intento falló: {{ invoice.error_message }} Puedes reintentar.
    </v-alert>

    <!-- Ya timbrada: estado, archivos y cancelación. -->
    <template v-if="status === 'stamped' || (status === 'cancelled' && invoice)">
      <p class="text-body-2 mb-1">
        <strong>Folio fiscal (UUID):</strong> {{ invoice?.fiscal_uuid }}
      </p>
      <p class="text-body-2 mb-3">
        <strong>Receptor:</strong> {{ invoice?.legal_name }} ({{ invoice?.rfc }})
      </p>
      <div v-if="hasFiles" class="d-flex ga-2 flex-wrap mb-3">
        <v-btn
          size="small"
          variant="tonal"
          prepend-icon="mdi-file-pdf-box"
          @click="emit('open', 'pdf')"
        >
          Descargar PDF
        </v-btn>
        <v-btn
          size="small"
          variant="tonal"
          prepend-icon="mdi-file-code-outline"
          @click="emit('open', 'xml')"
        >
          Descargar XML
        </v-btn>
      </div>
      <v-alert
        v-else-if="status === 'stamped'"
        type="info"
        variant="tonal"
        density="compact"
        class="mb-3"
      >
        La factura ya se emitió, pero sus archivos no se alcanzaron a guardar.
        <v-btn size="small" variant="text" :loading="busy" @click="emit('refetch')"
          >Volver a descargarlos</v-btn
        >
      </v-alert>
      <v-btn
        v-if="status === 'stamped' && canEdit"
        color="error"
        variant="text"
        :disabled="busy"
        @click="showCancel = true"
      >
        Cancelar factura
      </v-btn>
    </template>

    <v-progress-linear v-if="status === 'stamping'" indeterminate class="mb-3" />
    <p v-if="status === 'stamping'" class="text-body-2">
      Se está emitiendo la factura. Si pasan varios minutos, avisa a soporte.
    </p>

    <!-- Por facturar (o reintento / nueva tras cancelar). -->
    <v-form v-if="canIssue && canEdit" @submit.prevent="handleStamp">
      <p class="text-body-2 text-medium-emphasis mb-3">
        Revisa los datos fiscales del cliente. Los importes son los mismos del ticket.
      </p>
      <v-row dense>
        <v-col cols="12" sm="6">
          <v-text-field v-model="form.rfc" label="RFC" maxlength="13" density="compact" />
        </v-col>
        <v-col cols="12" sm="6">
          <v-text-field
            v-model="form.postalCode"
            label="Código postal fiscal"
            maxlength="5"
            density="compact"
          />
        </v-col>
        <v-col cols="12">
          <v-text-field v-model="form.legalName" label="Razón social" density="compact" />
        </v-col>
        <v-col cols="6" sm="4">
          <v-text-field
            v-model="form.taxRegimeCode"
            label="Régimen fiscal"
            maxlength="3"
            density="compact"
          />
        </v-col>
        <v-col cols="6" sm="4">
          <v-text-field
            v-model="form.cfdiUse"
            label="Uso de CFDI"
            maxlength="3"
            density="compact"
          />
        </v-col>
        <v-col cols="12" sm="4">
          <v-select
            v-model="paymentForm"
            :items="
              PAYMENT_FORMS.map((f) => ({
                value: f.code,
                title: `${f.code} · ${f.title}`,
              }))
            "
            label="Forma de pago"
            density="compact"
          />
        </v-col>
      </v-row>
      <v-btn type="submit" color="primary" :loading="busy">
        {{ status === 'pending' && invoice?.error_message ? 'Reintentar' : 'Facturar' }}
      </v-btn>
    </v-form>
    <p v-else-if="canIssue" class="text-body-2 text-medium-emphasis">
      No tienes permiso para emitir facturas.
    </p>

    <v-dialog v-model="showCancel" max-width="440">
      <v-card>
        <v-card-title>Cancelar factura</v-card-title>
        <v-card-text>
          <p class="mb-3">
            La cancelación se manda al SAT y no se puede deshacer. ¿Por qué se cancela?
          </p>
          <v-radio-group v-model="motive">
            <v-radio
              v-for="m in CANCEL_MOTIVES"
              :key="m.code"
              :value="m.code"
              :label="m.title"
            />
          </v-radio-group>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showCancel = false">Volver</v-btn>
          <v-btn color="error" :loading="busy" @click="handleCancel"
            >Cancelar factura</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>
