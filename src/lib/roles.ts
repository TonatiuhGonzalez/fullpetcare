import type { MemberRole } from '@/services/memberships'

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Dueño',
  receptionist: 'Recepción',
  groomer: 'Groomer',
  vet: 'Veterinario',
}

/** Nombre en español para mostrar en la UI de un rol de membresía. */
export function roleLabel(role: MemberRole | null): string {
  if (!role) return ''
  return ROLE_LABELS[role]
}

// A partir de aquí: reglas de permisos por rol para la INTERFAZ (ronda de
// UAT, 2026-09-07). El backend (RLS + create_appointment(), migración
// role_permission_hardening.sql) ya rechaza estas mismas acciones si se
// intentan de todos modos — estas funciones solo evitan mostrar un botón
// o un formulario que al final se va a rechazar (CLAUDE.md: "no tiene
// sentido que un veterinario pueda ver el botón de crear cita si al
// final back lo bloquea"). Son funciones puras: mismo criterio que
// lib/availability.ts — reciben el rol, regresan un booleano, sin saber
// nada de Vue ni de Supabase.

/**
 * true si el rol hace tareas de "recepción": agendar citas, dar de alta o
 * editar clientes/mascotas, generar el link público, ver el listado
 * completo de clientes — CLAUDE.md §6.1 se las da a owner y receptionist.
 * groomer y vet solo ATIENDEN lo que recepción ya agendó.
 */
export function isFrontDesk(role: MemberRole | null): boolean {
  return role === 'owner' || role === 'receptionist'
}

type ServiceKind = 'grooming' | 'veterinary'

/** El rol de empleado que corresponde a un tipo de cita/servicio. */
export function roleForServiceKind(kind: ServiceKind): MemberRole {
  return kind === 'grooming' ? 'groomer' : 'vet'
}

/**
 * true si el rol puede ATENDER citas de este tipo — owner (puede todo) o
 * el rol específico del tipo. receptionist queda fuera a propósito: agenda
 * citas, no las atiende (mismo criterio que create_appointment() en la
 * base, que rechaza asignarle una cita a recepción). Se usa para filtrar
 * a quién se le puede asignar una cita al agendar (NewAppointmentPage.vue).
 */
export function canAttendKind(role: MemberRole | null, kind: ServiceKind): boolean {
  return role === 'owner' || role === roleForServiceKind(kind)
}

/**
 * Qué categorías del catálogo puede VER un rol (CatalogPage.vue). A
 * diferencia de canAttendKind, receptionist SÍ ve las dos — necesita
 * cotizar cualquier servicio al agendar, aunque no lo atienda ella misma.
 * groomer/vet solo ven la categoría que les toca atender: no necesitan
 * los precios de servicios que nunca van a dar.
 */
export function visibleServiceKinds(role: MemberRole | null): ServiceKind[] {
  if (role === 'groomer') return ['grooming']
  if (role === 'vet') return ['veterinary']
  return ['grooming', 'veterinary']
}

type TimelineEntryType = 'grooming' | 'veterinary' | 'vaccination' | 'weight'

/**
 * Qué tipos de evento del historial de una mascota puede ver un rol
 * (PetDetailPage.vue > PetTimeline.vue). groomer: solo lo que él mismo
 * hace (estética) — ni siquiera las visitas de veterinaria, cartilla o
 * peso, que son información clínica. vet: lo suyo (veterinaria) más
 * cartilla y peso (parte normal de una consulta). owner/receptionist ven
 * todo, sin restricción — necesitan el cuadro completo del negocio.
 */
export function visibleTimelineTypes(role: MemberRole | null): TimelineEntryType[] {
  if (role === 'groomer') return ['grooming']
  if (role === 'vet') return ['veterinary', 'vaccination', 'weight']
  return ['grooming', 'veterinary', 'vaccination', 'weight']
}
