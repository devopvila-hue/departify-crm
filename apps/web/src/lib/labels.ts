/**
 * Etiquetas de dominio en español.
 *
 * El CRM guarda enums estables en inglés (lead, customer, open…) pero la
 * interfaz es en español: nunca debe mostrar el valor crudo al usuario.
 */
export const LIFECYCLE_LABEL: Record<string, string> = {
  lead: 'Lead',
  prospect: 'Prospecto',
  customer: 'Cliente',
  partner: 'Partner',
  archived: 'Archivado',
};

export const COMPANY_STATUS_LABEL: Record<string, string> = {
  active: 'Activa',
  inactive: 'Inactiva',
  archived: 'Archivada',
};

export const DEAL_STATUS_LABEL: Record<string, string> = {
  open: 'Abierta',
  won: 'Ganada',
  lost: 'Perdida',
};

export const TASK_STATUS_LABEL: Record<string, string> = {
  open: 'Abierta',
  done: 'Hecha',
  cancelled: 'Cancelada',
};

export const PRIORITY_LABEL: Record<string, string> = {
  low: 'Baja',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
};

export function label(map: Record<string, string>, value: string | null | undefined): string {
  if (!value) return '—';
  return map[value] ?? value;
}
