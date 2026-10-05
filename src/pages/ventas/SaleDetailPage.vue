<script setup lang="ts">
// Detalle de una venta cobrada (tarea 11.19): el ticket y su factura. Aquí se
// factura "cuando el cliente la pide", aunque haya pasado tiempo desde el cobro.
import { computed, onMounted, ref } from 'vue'

import InvoicePanel from '@/components/InvoicePanel.vue'
import TicketView from '@/components/TicketView.vue'
import { pickPaymentForm } from '@/lib/cfdi'
import * as checkoutService from '@/services/checkout'
import type { Ticket } from '@/services/checkout'
import * as customersService from '@/services/customers'
import * as invoicingService from '@/services/invoicing'
import type { InvoiceReceiver, InvoiceRequest } from '@/services/invoicing'
import { useSessionStore } from '@/stores/session'

const props = defineProps<{ id: string }>()

const session = useSessionStore()
const ticket = ref<Ticket | null>(null)
const invoice = ref<InvoiceRequest | null>(null)
const receiver = ref<InvoiceReceiver>({
  rfc: '',
  legalName: '',
  taxRegimeCode: '',
  postalCode: '',
  cfdiUse: 'G03',
})
const loading = ref(false)
const loadError = ref<string | null>(null)
const cancelledByName = ref<string | null>(null)
const busy = ref(false)
const actionError = ref<string | null>(null)
const snackbar = ref({ show: false, text: '' })

const canEdit = computed(() => session.canEdit('invoicing'))
const paymentFormCode = computed(() =>
  pickPaymentForm(
    (ticket.value?.payments ?? []).map((p) => ({
      amountCents: p.amount_cents,
      paymentFormCode: p.payment_form_code,
    })),
  ),
)

async function load(): Promise<void> {
  if (!session.activeTenantId) return
  loading.value = true
  loadError.value = null
  try {
    ticket.value = await checkoutService.getTicket(props.id)
    invoice.value = await invoicingService.getCurrentBySale(props.id)
    await loadCancelledBy()
    // Si ya hay una solicitud (p. ej. la que se pidió al cobrar) se precarga con
    // sus datos; si no, con los del cliente.
    if (invoice.value) {
      receiver.value = {
        rfc: invoice.value.rfc,
        legalName: invoice.value.legal_name,
        taxRegimeCode: invoice.value.tax_regime_code,
        postalCode: invoice.value.postal_code,
        cfdiUse: invoice.value.cfdi_use,
      }
    } else {
      const customer = await customersService.getById(
        session.activeTenantId,
        ticket.value.sale.customer_id,
      )
      receiver.value = {
        rfc: customer?.rfc ?? '',
        legalName: customer?.legal_name ?? '',
        taxRegimeCode: customer?.tax_regime_code ?? '',
        postalCode: customer?.postal_code ?? '',
        cfdiUse: customer?.cfdi_use ?? 'G03',
      }
    }
  } catch {
    loadError.value = 'No se pudo cargar la venta. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

// Quién canceló la factura vigente (si está cancelada). Un fallo aquí no debe
// romper la pantalla: solo se muestra sin el nombre.
async function loadCancelledBy(): Promise<void> {
  const userId = invoice.value?.status === 'cancelled' ? invoice.value.cancelled_by : null
  cancelledByName.value = userId
    ? await invoicingService.getCancelledByName(userId).catch(() => null)
    : null
}

// Cada acción recarga la factura para mostrar el estado real que dejó la función.
async function run(action: () => Promise<void>, success: string): Promise<void> {
  busy.value = true
  actionError.value = null
  try {
    await action()
    snackbar.value = { show: true, text: success }
  } catch (e) {
    actionError.value =
      e instanceof Error ? e.message : 'No se pudo completar la operación.'
  } finally {
    invoice.value = await invoicingService
      .getCurrentBySale(props.id)
      .catch(() => invoice.value)
    await loadCancelledBy()
    busy.value = false
  }
}

function handleStamp(data: InvoiceReceiver, paymentForm: string | null): Promise<void> {
  return run(
    () => invoicingService.stamp(session.activeTenantId!, props.id, data, paymentForm),
    'Factura emitida.',
  )
}

function handleCancel(motive: string): Promise<void> {
  return run(
    () => invoicingService.cancel(session.activeTenantId!, invoice.value!.id, motive),
    'Factura cancelada.',
  )
}

function handleRefetch(): Promise<void> {
  return run(
    () => invoicingService.refetchFiles(session.activeTenantId!, invoice.value!.id),
    'Archivos guardados.',
  )
}

async function handleOpen(kind: 'xml' | 'pdf'): Promise<void> {
  const path = kind === 'xml' ? invoice.value?.xml_path : invoice.value?.pdf_path
  if (!path) return
  try {
    window.open(await invoicingService.getFileUrl(path), '_blank', 'noopener')
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : 'No se pudo abrir el archivo.'
  }
}
</script>

<template>
  <v-container class="py-4">
    <v-btn
      variant="text"
      prepend-icon="mdi-arrow-left"
      class="mb-2 no-print"
      to="/app/agenda"
    >
      Volver a la agenda
    </v-btn>

    <v-alert v-if="loadError" type="error" density="compact" variant="tonal" class="mb-4">
      {{ loadError }}
    </v-alert>
    <v-progress-circular v-if="loading" indeterminate color="primary" />

    <template v-else-if="ticket">
      <v-card class="pa-4 mb-4">
        <TicketView :ticket="ticket" />
      </v-card>
      <v-alert
        v-if="ticket.sale.status !== 'paid'"
        type="info"
        density="compact"
        variant="tonal"
      >
        Solo se pueden facturar ventas pagadas.
      </v-alert>
      <InvoicePanel
        v-else
        :invoice="invoice"
        :receiver="receiver"
        :payment-form-code="paymentFormCode"
        :can-edit="canEdit"
        :cancelled-by-name="cancelledByName"
        :busy="busy"
        :error="actionError"
        @stamp="handleStamp"
        @cancel="handleCancel"
        @open="handleOpen"
        @refetch="handleRefetch"
      />
    </template>

    <v-snackbar v-model="snackbar.show" color="success" timeout="4000">{{
      snackbar.text
    }}</v-snackbar>
  </v-container>
</template>
