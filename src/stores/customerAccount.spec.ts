import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as account from '@/services/customerAccount'
import { useCustomerAccountStore } from './customerAccount'

// Se simula el servicio completo: aquí solo se prueba qué hace la store con sus respuestas
// (si el acceso o el vínculo fallan, qué mensaje ve la persona), no la red.
// Con fábrica explícita: un `vi.mock` sin ella importa el módulo real para copiar su forma, y eso
// crearía el cliente de Supabase, que en CI no tiene VITE_SUPABASE_URL y truena al importar.
vi.mock('@/services/customerAccount', () => ({
  requestCode: vi.fn(),
  verifyCode: vi.fn(),
  hasSession: vi.fn(),
  signOut: vi.fn(),
  claimLink: vi.fn(),
  loadOverview: vi.fn(),
  loadPet: vi.fn(),
  deleteAccount: vi.fn(),
}))

describe('useCustomerAccountStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
  })

  // Si un código equivocado dejara "entrar", la pantalla mostraría una cuenta sin sesión real.
  it('no abre sesión con un código incorrecto', async () => {
    vi.mocked(account.verifyCode).mockRejectedValue(new Error('bad'))
    const store = useCustomerAccountStore()

    expect(await store.signIn('a@b.mx', '000000')).toBe(false)
    expect(store.isSignedIn).toBe(false)
    expect(store.errorMessage).toBe('El código no es correcto o ya venció.')
  })

  // Entrar con el link de la mascota debe dejar la cuenta vinculada en el mismo paso; si no,
  // la persona entraría y vería "no tienes mascotas" justo después de escanear su link.
  it('vincula el link al iniciar sesión', async () => {
    vi.mocked(account.verifyCode).mockResolvedValue()
    vi.mocked(account.claimLink).mockResolvedValue()
    const store = useCustomerAccountStore()

    expect(await store.signIn(' A@B.mx ', '123456', 'tok')).toBe(true)
    expect(account.verifyCode).toHaveBeenCalledWith('a@b.mx', '123456')
    expect(account.claimLink).toHaveBeenCalledWith('tok')
    expect(store.isSignedIn).toBe(true)
  })

  // Un link vencido no debe tirar la sesión: la persona sigue dentro y ve el aviso.
  it('conserva la sesión aunque el link no sirva', async () => {
    vi.mocked(account.verifyCode).mockResolvedValue()
    vi.mocked(account.claimLink).mockRejectedValue(new Error('x'))
    const store = useCustomerAccountStore()

    await store.signIn('a@b.mx', '123456', 'tok')
    expect(store.isSignedIn).toBe(true)
    expect(store.errorMessage).toBe('Este link no es válido o ya venció.')
  })

  // Al salir no debe quedar nada de la cuenta anterior en memoria (equipo compartido).
  it('limpia todo al cerrar sesión', async () => {
    vi.mocked(account.verifyCode).mockResolvedValue()
    vi.mocked(account.loadOverview).mockResolvedValue([
      { business_name: 'X' } as account.AccountBusiness,
    ])
    vi.mocked(account.signOut).mockResolvedValue()
    const store = useCustomerAccountStore()
    await store.signIn('a@b.mx', '123456')
    await store.loadBusinesses()
    expect(store.businesses).toHaveLength(1)

    await store.signOut()
    expect(store.isSignedIn).toBe(false)
    expect(store.businesses).toEqual([])
  })
})
