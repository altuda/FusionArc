/** Feature type color mapping (superset). */
export const TYPE_COLORS: Record<string, string> = {
  'domain': '#3B82F6', 'family': '#8B5CF6', 'homologous_superfamily': '#F59E0B',
  'repeat': '#10B981', 'site': '#EC4899', 'signal_peptide': '#F97316',
  'transmembrane': '#14B8A6', 'coiled_coil': '#0EA5E9', 'low_complexity': '#78716C',
  'disorder': '#64748B', 'structure': '#22C55E', 'kinase': '#EF4444', 'default': '#6366F1',
}

/** Database source color mapping (superset with case variants). */
export const SOURCE_COLORS: Record<string, string> = {
  'Pfam': '#3B82F6', 'pfam': '#3B82F6', 'Smart': '#10B981', 'smart': '#10B981', 'SMART': '#10B981',
  'Superfamily': '#F59E0B', 'superfamily': '#F59E0B', 'SuperFamily': '#F59E0B',
  'CDD': '#8B5CF6', 'cdd': '#8B5CF6', 'PANTHER': '#EC4899', 'panther': '#EC4899',
  'Gene3D': '#06B6D4', 'gene3d': '#06B6D4', 'Prosite_profiles': '#84CC16', 'Prosite_patterns': '#84CC16',
  'PROSITE': '#84CC16',
  'SignalP': '#F97316', 'Phobius': '#14B8A6', 'PRINTS': '#A855F7', 'MobiDBLite': '#64748B',
  'Seg': '#78716C', 'ncoils': '#0EA5E9', 'sifts': '#D946EF', 'alphafold': '#22C55E',
  'InterPro': '#059669', 'default': '#6366F1',
}
