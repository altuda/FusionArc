import { describe, it, expect } from 'vitest'
import { shouldShowDomain, computeEffectiveFilters, FilterableDomain } from './domainFilters'
import { DomainFilters } from '../components/visualization/ProteinSchematic'

describe('shouldShowDomain', () => {
  describe('filtering by excludeDataProviders', () => {
    it('should show domain when excludeDataProviders is empty', () => {
      const domain: FilterableDomain = { source: 'Pfam', data_provider: 'CDD' }
      const filters: DomainFilters = {
        sources: [],
        dataProviders: [],
        excludeDataProviders: [],
        colorMode: 'domain',
      }
      expect(shouldShowDomain(domain, filters)).toBe(true)
    })

    it('should exclude domain when its data_provider is in excludeDataProviders', () => {
      const domain: FilterableDomain = { source: 'Pfam', data_provider: 'CDD' }
      const filters: DomainFilters = {
        sources: [],
        dataProviders: [],
        excludeDataProviders: ['CDD'],
        colorMode: 'domain',
      }
      expect(shouldShowDomain(domain, filters)).toBe(false)
    })

    it('should show domain when its data_provider is NOT in excludeDataProviders', () => {
      const domain: FilterableDomain = { source: 'Pfam', data_provider: 'InterPro' }
      const filters: DomainFilters = {
        sources: [],
        dataProviders: [],
        excludeDataProviders: ['CDD'],
        colorMode: 'domain',
      }
      expect(shouldShowDomain(domain, filters)).toBe(true)
    })

    it('should show domain when it has no data_provider even if excludeDataProviders is set', () => {
      const domain: FilterableDomain = { source: 'Pfam' }
      const filters: DomainFilters = {
        sources: [],
        dataProviders: [],
        excludeDataProviders: ['CDD'],
        colorMode: 'domain',
      }
      expect(shouldShowDomain(domain, filters)).toBe(true)
    })

    it('should exclude multiple data providers', () => {
      const cddDomain: FilterableDomain = { source: 'Pfam', data_provider: 'CDD' }
      const interproDomain: FilterableDomain = { source: 'Pfam', data_provider: 'InterPro' }
      const uniprotDomain: FilterableDomain = { source: 'Pfam', data_provider: 'UniProt' }

      const filters: DomainFilters = {
        sources: [],
        dataProviders: [],
        excludeDataProviders: ['CDD', 'InterPro'],
        colorMode: 'domain',
      }

      expect(shouldShowDomain(cddDomain, filters)).toBe(false)
      expect(shouldShowDomain(interproDomain, filters)).toBe(false)
      expect(shouldShowDomain(uniprotDomain, filters)).toBe(true)
    })
  })

  describe('FusionSchematicView filtering logic', () => {
    it('should correctly exclude CDD domains from specified data providers', () => {
      const domains: FilterableDomain[] = [
        { source: 'Pfam', data_provider: 'CDD' },
        { source: 'SMART', data_provider: 'CDD' },
        { source: 'Pfam', data_provider: 'InterPro' },
        { source: 'Gene3D', data_provider: 'InterPro' },
      ]

      const filters: DomainFilters = {
        sources: [],
        dataProviders: [],
        excludeDataProviders: ['CDD'],
        colorMode: 'domain',
      }

      const visibleDomains = domains.filter(d => shouldShowDomain(d, filters))

      expect(visibleDomains).toHaveLength(2)
      expect(visibleDomains.every(d => d.data_provider === 'InterPro')).toBe(true)
    })

    it('should show all domains when no exclusions are set', () => {
      const domains: FilterableDomain[] = [
        { source: 'Pfam', data_provider: 'CDD' },
        { source: 'SMART', data_provider: 'InterPro' },
        { source: 'Gene3D' },
      ]

      const filters: DomainFilters = {
        sources: [],
        dataProviders: [],
        excludeDataProviders: [],
        colorMode: 'domain',
      }

      const visibleDomains = domains.filter(d => shouldShowDomain(d, filters))
      expect(visibleDomains).toHaveLength(3)
    })
  })

  describe('ProteinSchematic filtering logic', () => {
    it('should correctly exclude domains from specified data providers', () => {
      const domains: FilterableDomain[] = [
        { source: 'Pfam', data_provider: 'CDD' },
        { source: 'Pfam', data_provider: 'UniProt' },
        { source: 'SMART', data_provider: 'CDD' },
        { source: 'Gene3D', data_provider: 'InterPro' },
      ]

      const filters: DomainFilters = {
        sources: [],
        dataProviders: [],
        excludeDataProviders: ['CDD'],
        colorMode: 'source',
      }

      const visibleDomains = domains.filter(d => shouldShowDomain(d, filters))

      expect(visibleDomains).toHaveLength(2)
      expect(visibleDomains.map(d => d.data_provider)).toEqual(['UniProt', 'InterPro'])
    })

    it('should combine source filter with data provider exclusion', () => {
      const domains: FilterableDomain[] = [
        { source: 'Pfam', data_provider: 'CDD' },
        { source: 'Pfam', data_provider: 'InterPro' },
        { source: 'SMART', data_provider: 'CDD' },
        { source: 'SMART', data_provider: 'InterPro' },
      ]

      const filters: DomainFilters = {
        sources: ['Pfam'],  // Only show Pfam
        dataProviders: [],
        excludeDataProviders: ['CDD'],  // Exclude CDD
        colorMode: 'domain',
      }

      const visibleDomains = domains.filter(d => shouldShowDomain(d, filters))

      expect(visibleDomains).toHaveLength(1)
      expect(visibleDomains[0]).toEqual({ source: 'Pfam', data_provider: 'InterPro' })
    })
  })
})

describe('computeEffectiveFilters', () => {
  describe('effect of includeCDD flag on excludeDataProviders', () => {
    const baseFilters: DomainFilters = {
      sources: ['Pfam', 'SMART'],
      dataProviders: [],
      colorMode: 'domain',
    }

    it('should set excludeDataProviders to empty array when includeCDD is true', () => {
      const effectiveFilters = computeEffectiveFilters(baseFilters, true)

      expect(effectiveFilters.excludeDataProviders).toEqual([])
      expect(effectiveFilters.sources).toEqual(['Pfam', 'SMART'])
      expect(effectiveFilters.colorMode).toBe('domain')
    })

    it('should set excludeDataProviders to ["CDD"] when includeCDD is false', () => {
      const effectiveFilters = computeEffectiveFilters(baseFilters, false)

      expect(effectiveFilters.excludeDataProviders).toEqual(['CDD'])
      expect(effectiveFilters.sources).toEqual(['Pfam', 'SMART'])
      expect(effectiveFilters.colorMode).toBe('domain')
    })

    it('should not modify original filters object', () => {
      const originalFilters: DomainFilters = {
        sources: ['Pfam'],
        dataProviders: ['InterPro'],
        colorMode: 'type',
      }

      computeEffectiveFilters(originalFilters, false)

      expect(originalFilters.excludeDataProviders).toBeUndefined()
    })

    it('should override existing excludeDataProviders when includeCDD is true', () => {
      const filtersWithExclusions: DomainFilters = {
        sources: [],
        dataProviders: [],
        excludeDataProviders: ['CDD', 'UniProt'],
        colorMode: 'domain',
      }

      const effectiveFilters = computeEffectiveFilters(filtersWithExclusions, true)

      expect(effectiveFilters.excludeDataProviders).toEqual([])
    })

    it('should correctly filter CDD domains through the full flow', () => {
      const domains: FilterableDomain[] = [
        { source: 'Pfam', data_provider: 'CDD' },
        { source: 'Pfam', data_provider: 'InterPro' },
        { source: 'SMART', data_provider: 'CDD' },
      ]

      // Simulate FusionDetail with includeCDD = false
      const filtersWithCDDExcluded = computeEffectiveFilters(baseFilters, false)
      const visibleWithoutCDD = domains.filter(d => shouldShowDomain(d, filtersWithCDDExcluded))

      expect(visibleWithoutCDD).toHaveLength(1)
      expect(visibleWithoutCDD[0].data_provider).toBe('InterPro')

      // Simulate FusionDetail with includeCDD = true
      const filtersWithCDDIncluded = computeEffectiveFilters(baseFilters, true)
      const visibleWithCDD = domains.filter(d => shouldShowDomain(d, filtersWithCDDIncluded))

      expect(visibleWithCDD).toHaveLength(3)
    })
  })
})
