// Máquina de estados de una cita (CLAUDE.md §6.3: `scheduled` |
// `in_progress` | `completed` | `cancelled` | `no_show`). Función pura:
// una tabla de qué transiciones están permitidas, y una función que la
// consulta — nada de leer la cita real ni llamar a Supabase aquí, eso
// es trabajo de services/appointments.ts (tarea 4.10), que llama a
// `canTransition()` ANTES de hacer el UPDATE para dar un mensaje de
// error claro en español en vez de dejar que falle silenciosamente (o
// que la base lo permita por no tener ninguna regla que lo impida — un
// `status` es solo un enum de Postgres, no sabe nada de "completed no
// puede volver a scheduled").
import type { AppointmentStatus } from '@/services/appointments'

// `completed`, `cancelled` y `no_show` son estados TERMINALES: una vez
// ahí, la cita no cambia de estado nunca más (si algo salió mal, se
// corrige agendando una cita nueva, no reabriendo la vieja — mismo
// espíritu que "el expediente no se borra, se corrige con un registro
// nuevo").
const ALLOWED_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  scheduled: ['in_progress', 'cancelled', 'no_show'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  no_show: [],
}

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}
