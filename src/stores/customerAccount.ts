// Estado de la cuenta del dueño de la mascota (fase 16B). Los mensajes de error van en español
// y sin jerga (CLAUDE.md §5.4).
import { defineStore } from 'pinia'
import { ref } from 'vue'

import * as account from '@/services/customerAccount'
import type { AccountBusiness, AccountPetDetail } from '@/services/customerAccount'

export const useCustomerAccountStore = defineStore('customerAccount', () => {
  const isSignedIn = ref(false)
  const businesses = ref<AccountBusiness[]>([])
  const detail = ref<AccountPetDetail | null>(null)
  const loading = ref(false)
  const errorMessage = ref<string | null>(null)

  async function restore(): Promise<void> {
    isSignedIn.value = await account.hasSession()
  }

  async function sendCode(email: string, token?: string | null): Promise<boolean> {
    errorMessage.value = null
    try {
      await account.requestCode(email.trim().toLowerCase(), token)
      return true
    } catch {
      errorMessage.value = 'No se pudo enviar el código. Revisa tu conexión.'
      return false
    }
  }

  async function signIn(
    email: string,
    code: string,
    token?: string | null,
  ): Promise<boolean> {
    errorMessage.value = null
    try {
      await account.verifyCode(email.trim().toLowerCase(), code.trim())
    } catch {
      errorMessage.value = 'El código no es correcto o ya venció.'
      return false
    }
    isSignedIn.value = true
    if (token) {
      try {
        await account.claimLink(token)
      } catch {
        errorMessage.value = 'Este link no es válido o ya venció.'
      }
    }
    return true
  }

  async function loadBusinesses(): Promise<void> {
    loading.value = true
    errorMessage.value = null
    try {
      businesses.value = await account.loadOverview()
    } catch {
      errorMessage.value = 'No se pudieron cargar tus mascotas. Intenta de nuevo.'
    } finally {
      loading.value = false
    }
  }

  async function loadPetDetail(petId: string): Promise<void> {
    loading.value = true
    errorMessage.value = null
    detail.value = null
    try {
      detail.value = await account.loadPet(petId)
    } catch {
      errorMessage.value = 'No encontramos esa mascota.'
    } finally {
      loading.value = false
    }
  }

  async function signOut(): Promise<void> {
    await account.signOut()
    isSignedIn.value = false
    businesses.value = []
    detail.value = null
  }

  async function deleteMyAccount(): Promise<boolean> {
    try {
      await account.deleteAccount()
    } catch {
      errorMessage.value = 'No se pudo eliminar la cuenta. Intenta de nuevo.'
      return false
    }
    isSignedIn.value = false
    businesses.value = []
    detail.value = null
    return true
  }

  return {
    isSignedIn,
    businesses,
    detail,
    loading,
    errorMessage,
    restore,
    sendCode,
    signIn,
    loadBusinesses,
    loadPetDetail,
    signOut,
    deleteMyAccount,
  }
})
