import { DomainFilters } from '../components/visualization/ProteinSchematic'

export interface FilterableDomain {
  source: string
  data_provider?: string
}

/**
 * Determines whether a domain should be displayed based on the current filters.
 * This logic is used by both FusionSchematicView and ProteinSchematic components.
 */
export function shouldShowDomain(domain: FilterableDomain, filters?: DomainFilters): boolean {
  // Filter by database source (Pfam, SMART, etc.)
  const sources = filters?.sources || []
  const sourceMatch = sources.length === 0 || sources.includes(domain.source)

  // Filter by data provider (InterPro, CDD, etc.)
  const dataProviders = filters?.dataProviders || []
  const providerMatch = dataProviders.length === 0 ||
    Boolean(domain.data_provider && dataProviders.includes(domain.data_provider))

  // Exclude specific data providers (e.g., CDD)
  const excludeProviders = filters?.excludeDataProviders || []
  const notExcluded = excludeProviders.length === 0 ||
    !domain.data_provider ||
    !excludeProviders.includes(domain.data_provider)

  return sourceMatch && providerMatch && notExcluded
}

/**
 * Computes the effective filters based on the includeCDD flag.
 * Used in FusionDetail to toggle CDD domain visibility.
 */
export function computeEffectiveFilters(domainFilters: DomainFilters, includeCDD: boolean): DomainFilters {
  if (includeCDD) {
    return { ...domainFilters, excludeDataProviders: [] }
  } else {
    return { ...domainFilters, excludeDataProviders: ['CDD'] }
  }
}
