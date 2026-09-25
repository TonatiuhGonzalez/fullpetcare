// Tests de lib/platform.ts: la lógica pura del panel de superadmin. Cada
// caso explica qué se rompería en la pantalla si fallara (CLAUDE.md §9).
import { describe, expect, it } from 'vitest'

import {
  describeAuditEntry,
  filterTenants,
  formatPlanExpiry,
  formatPlatformDateTime,
  tenantStatusColor,
  tenantStatusLabel,
} from './platform'

describe('tenantStatusLabel / tenantStatusColor', () => {
  it('tiene etiqueta y color para los tres estados, y son distintos entre sí', () => {
    // Si un estado nuevo se agregara al enum de la base y faltara aquí, el
    // chip saldría vacío. Que los colores sean distintos es lo que permite
    // distinguir de un vistazo una empresa suspendida de una dada de baja.
    const statuses = ['active', 'suspended', 'closed'] as const
    expect(statuses.map(tenantStatusLabel)).toEqual(['Activa', 'Suspendida', 'De baja'])
    expect(new Set(statuses.map(tenantStatusColor)).size).toBe(3)
  })
})

describe('formatPlanExpiry', () => {
  it('null se muestra como "Indefinida" (todas las empresas hoy)', () => {
    // Es el caso de TODAS las filas hoy. Si null se formateara como fecha
    // saldría "Invalid Date" en cada renglón de la tabla.
    expect(formatPlanExpiry(null)).toBe('Indefinida')
  })

  it('una fecha se muestra en español, en hora de México Centro', () => {
    // 2026-07-16T03:00Z es el 15 de julio a las 21:00 en México Centro
    // (UTC−6): la fecha debe salir "15", no "16" (CLAUDE.md §8.3, la
    // conversión de zona es solo al mostrar).
    expect(formatPlanExpiry('2026-07-16T03:00:00Z')).toBe('15 de julio de 2026')
  })
})

describe('formatPlatformDateTime', () => {
  it('muestra fecha y hora locales de México Centro', () => {
    // La bitácora la lee un humano: una hora en UTC lo confundiría con
    // "¿cuándo fue esto de verdad?".
    expect(formatPlatformDateTime('2026-07-16T03:30:00Z')).toBe('15 de julio de 2026, 21:30')
  })
})

describe('filterTenants', () => {
  const tenants = [
    { name: 'Patitas Felices', ownerName: 'Fernanda Ruiz', status: 'active' as const },
    { name: 'Estética Canina Luna', ownerName: 'José Pérez', status: 'suspended' as const },
    { name: 'Huellitas Spa', ownerName: null, status: 'closed' as const },
  ]

  it('sin texto ni estado devuelve todas', () => {
    // El estado inicial de la pantalla: si filtrara algo, faltarían
    // empresas sin que el superadmin haya buscado nada.
    expect(filterTenants(tenants, '', null)).toHaveLength(3)
  })

  it('busca sin distinguir mayúsculas ni acentos', () => {
    // Quien escribe "estetica" (sin acento, como se teclea de prisa) debe
    // encontrar "Estética". Sin normalizar, esa búsqueda daría cero.
    expect(filterTenants(tenants, 'ESTETICA', null).map((t) => t.name)).toEqual([
      'Estética Canina Luna',
    ])
    expect(filterTenants(tenants, 'jose', null).map((t) => t.name)).toEqual(['Estética Canina Luna'])
  })

  it('busca también por el nombre del dueño', () => {
    // Quien llama por teléfono suele dar su nombre, no el de la empresa.
    expect(filterTenants(tenants, 'fernanda', null).map((t) => t.name)).toEqual(['Patitas Felices'])
  })

  it('una empresa sin dueño no truena al buscar y solo aparece por su nombre', () => {
    // ownerName puede ser null (alta a medias). Llamar `.includes` sobre
    // null rompería la pantalla entera al teclear la primera letra.
    expect(filterTenants(tenants, 'huellitas', null)).toHaveLength(1)
    expect(filterTenants(tenants, 'zzz', null)).toEqual([])
  })

  it('filtra por estado, y combina estado + texto', () => {
    expect(filterTenants(tenants, '', 'closed').map((t) => t.name)).toEqual(['Huellitas Spa'])
    // El texto coincide con una empresa, pero de OTRO estado: no debe salir.
    expect(filterTenants(tenants, 'patitas', 'suspended')).toEqual([])
  })

  it('ignora espacios sobrantes alrededor del texto buscado', () => {
    // Un espacio al final (típico al pegar) no debe dar cero resultados.
    expect(filterTenants(tenants, '  luna  ', null)).toHaveLength(1)
  })
})

describe('describeAuditEntry', () => {
  const base = { event: null, oldData: null, newData: null }

  it('un evento de restablecer contraseña se describe sin mencionar ninguna contraseña', () => {
    // La bitácora es lo más consultado en una disputa ("¿quién le cambió la
    // contraseña al dueño?"): debe decirlo claro. Nunca hay una contraseña
    // en estos datos, y la frase tampoco la sugiere.
    const result = describeAuditEntry({
      ...base,
      action: 'UPDATE',
      tableName: 'auth.users',
      event: 'password_reset',
    })
    expect(result).toEqual(['Restableció la contraseña del dueño.'])
  })

  it('un intento fallido de restablecer se distingue del exitoso', () => {
    // Si ambos dijeran lo mismo, el superadmin creería que la contraseña
    // cambió cuando en realidad no.
    const result = describeAuditEntry({
      ...base,
      action: 'UPDATE',
      tableName: 'auth.users',
      event: 'password_reset_failed',
    })
    expect(result[0]).toMatch(/no se pudo/)
  })

  it('el alta de la empresa se describe como tal', () => {
    expect(
      describeAuditEntry({ ...base, action: 'INSERT', tableName: 'tenant_platform_info' }),
    ).toEqual(['Dio de alta la empresa.'])
  })

  it('suspender muestra el estado nuevo, el anterior y el motivo', () => {
    const result = describeAuditEntry({
      ...base,
      action: 'UPDATE',
      tableName: 'tenant_platform_info',
      oldData: { status: 'active', status_reason: null },
      newData: { status: 'suspended', status_reason: 'Falta de pago' },
    })
    expect(result).toEqual(['Cambió el estado a Suspendida (antes: Activa). Motivo: Falta de pago.'])
  })

  it('reactivar no muestra motivo', () => {
    const result = describeAuditEntry({
      ...base,
      action: 'UPDATE',
      tableName: 'tenant_platform_info',
      oldData: { status: 'closed', status_reason: 'Cierre' },
      newData: { status: 'active', status_reason: null },
    })
    expect(result).toEqual(['Cambió el estado a Activa (antes: De baja).'])
  })

  it('mismo estado pero otro motivo se reporta como cambio de motivo', () => {
    // Sin este caso, corregir el motivo de una suspensión no dejaría
    // ninguna frase útil en la bitácora.
    const result = describeAuditEntry({
      ...base,
      action: 'UPDATE',
      tableName: 'tenant_platform_info',
      oldData: { status: 'suspended', status_reason: 'Falta de pago' },
      newData: { status: 'suspended', status_reason: 'Solicitud del dueño' },
    })
    expect(result).toEqual(['Cambió el motivo: Solicitud del dueño.'])
  })

  it('un cambio de notas NO copia el texto de la nota a la frase', () => {
    // Las notas pueden ser largas o delicadas; la frase solo avisa que
    // cambiaron. El texto completo ya está en la pestaña Notas.
    const result = describeAuditEntry({
      ...base,
      action: 'UPDATE',
      tableName: 'tenant_platform_info',
      oldData: { status: 'active', internal_notes: null },
      newData: { status: 'active', internal_notes: 'Cliente moroso, no renovar' },
    })
    expect(result).toEqual(['Actualizó las notas internas.'])
  })

  it('un UPDATE con varios cambios los lista todos', () => {
    // Estado y notas pueden cambiar en la misma fila; mostrar solo uno
    // ocultaría el otro.
    const result = describeAuditEntry({
      ...base,
      action: 'UPDATE',
      tableName: 'tenant_platform_info',
      oldData: { status: 'active', status_reason: null, internal_notes: null },
      newData: { status: 'suspended', status_reason: 'X', internal_notes: 'nota' },
    })
    expect(result).toHaveLength(2)
  })

  it('agregar y quitar superadmins se distinguen', () => {
    expect(
      describeAuditEntry({ ...base, action: 'INSERT', tableName: 'platform_admins' }),
    ).toEqual(['Agregó a un superadmin.'])
    expect(
      describeAuditEntry({
        ...base,
        action: 'UPDATE',
        tableName: 'platform_admins',
        newData: { deleted_at: '2026-09-24T12:00:00Z' },
      }),
    ).toEqual(['Quitó a un superadmin.'])
    expect(
      describeAuditEntry({
        ...base,
        action: 'UPDATE',
        tableName: 'platform_admins',
        newData: { deleted_at: null },
      }),
    ).toEqual(['Reactivó a un superadmin.'])
  })

  it('una entrada desconocida no truena: cae en una frase genérica', () => {
    // Una tabla o evento nuevo que aún no tenga frase no debe romper la
    // pestaña Bitácora completa.
    expect(describeAuditEntry({ ...base, action: 'DELETE', tableName: 'algo_nuevo' })).toEqual([
      'Realizó un cambio.',
    ])
    expect(
      describeAuditEntry({ ...base, action: 'UPDATE', tableName: 'x', event: 'otro_evento' }),
    ).toEqual(['Evento: otro_evento.'])
  })
})
