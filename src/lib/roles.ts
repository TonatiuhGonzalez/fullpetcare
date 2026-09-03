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
