/** Shared status/severity presentation for the incidents pages. */

export type PillTone = 'default' | 'success' | 'warn' | 'danger' | 'accent';

export function statusTone(status: string): PillTone {
  switch (status) {
    case 'IN_REVIEW':
      return 'warn';
    case 'APPROVED':
      return 'success';
    case 'EXPORTED':
      return 'accent';
    default:
      return 'default';
  }
}

export function statusLabel(status: string): string {
  return status.replace('_', ' ').toLowerCase();
}

export function severityTone(severity: string): PillTone {
  switch (severity) {
    case 'CRITICAL':
      return 'danger';
    case 'HIGH':
      return 'warn';
    default:
      return 'default';
  }
}
