/** Infer feature type from domain name and source database. */
export function inferFeatureType(name: string, source: string): string {
  const nameLower = name.toLowerCase()
  if (nameLower.includes('kinase')) return 'kinase'
  if (nameLower.includes('repeat') || nameLower.includes('wd40') || nameLower.includes('ank') || nameLower.includes('lrr')) return 'repeat'
  if (nameLower.includes('motif')) return 'motif'
  if (nameLower.includes('site') || nameLower.includes('binding')) return 'site'
  if (nameLower.includes('signal') || nameLower.includes('peptide')) return 'signal_peptide'
  if (nameLower.includes('transmembrane') || nameLower.includes('tm_helix')) return 'transmembrane'
  if (nameLower.includes('coil')) return 'coiled_coil'
  if (nameLower.includes('disorder') || nameLower.includes('low_complexity') || nameLower.includes('low complexity')) return 'disorder'
  if (nameLower.includes('family')) return 'family'
  if (nameLower.includes('superfamily')) return 'homologous_superfamily'
  if (nameLower.includes('domain')) return 'domain'
  const sourceLower = source.toLowerCase()
  if (sourceLower.includes('superfamily') || sourceLower.includes('gene3d')) return 'homologous_superfamily'
  if (sourceLower === 'panther') return 'family'
  if (sourceLower === 'signalp') return 'signal_peptide'
  if (sourceLower === 'phobius') return 'transmembrane'
  if (sourceLower === 'ncoils') return 'coiled_coil'
  if (sourceLower === 'seg' || sourceLower === 'mobidblite') return 'disorder'
  if (sourceLower === 'alphafold' || sourceLower === 'sifts') return 'structure'
  return 'domain'
}
