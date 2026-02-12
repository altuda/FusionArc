import { MutationType } from '../api/client'

/** Color scheme for mutation types (matching ProteinPaint style). */
export const MUTATION_COLORS: Record<MutationType, string> = {
  missense: '#3B82F6',    // Blue
  nonsense: '#EF4444',    // Red
  frameshift: '#F97316',  // Orange
  silent: '#10B981',      // Green
  splice: '#8B5CF6',      // Purple
  inframe_indel: '#EC4899', // Pink
  other: '#6B7280',       // Gray
}

/** Human-readable labels for mutation types. */
export const MUTATION_LABELS: Record<MutationType, string> = {
  missense: 'Missense',
  nonsense: 'Nonsense',
  frameshift: 'Frameshift',
  silent: 'Silent',
  splice: 'Splice',
  inframe_indel: 'In-frame Indel',
  other: 'Other',
}
