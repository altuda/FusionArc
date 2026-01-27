import { useState, useCallback, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import Card, { CardHeader, CardBody } from '../components/common/Card'
import Button from '../components/common/Button'
import LoadingSpinner from '../components/common/LoadingSpinner'
import StatusBadge, { getFrameStatus, getKinaseStatus } from '../components/common/StatusBadge'
import ViewModeSelector from '../components/common/ViewModeSelector'
import DatabaseFilter from '../components/common/DatabaseFilter'
import ProteinSchematic, { DomainFilters, ColorMode, ViewMode } from '../components/visualization/ProteinSchematic'
import SequenceView from '../components/visualization/SequenceView'
import DomainDetailPanel from '../components/visualization/DomainDetailPanel'
import ExportButtons from '../components/visualization/ExportButtons'
import FusionTranscriptView from '../components/visualization/FusionTranscriptView'
import MultiLevelView from '../components/visualization/MultiLevelView'
import LollipopPlot from '../components/visualization/LollipopPlot'
import DomainColorLegend, { getLegendItems, FeatureTypeLegend, SourceLegend } from '../components/visualization/DomainColorLegend'
import { useFusionDetail, useVisualizationData, useFusionMutations } from '../hooks/useFusions'
import { refreshFusionDomains, getSessionDomains, MutationInfo, MutationType } from '../api/client'
import { DomainColorMap } from '../utils/domainColors'
import { computeEffectiveFilters } from '../utils/domainFilters'

// Cache for session-level color maps (persists across navigation within session)
const sessionColorMapCache = new Map<string, DomainColorMap>()

export default function FusionDetail() {
  const { sessionId, fusionId } = useParams<{ sessionId: string; fusionId: string }>()
  const queryClient = useQueryClient()
  const [showStrandOrientation, setShowStrandOrientation] = useState(false)
  const [svgContents, setSvgContents] = useState<Record<string, string | null>>({})
  const [activeTab, setActiveTab] = useState<'schematic' | 'transcript' | 'multilevel' | 'mutations' | 'sequence' | 'domains'>('schematic')
  const [isRefreshingDomains, setIsRefreshingDomains] = useState(false)
  const [schematicViewMode, setSchematicViewMode] = useState<ViewMode>('fusion')
  const [useBatchColors, setUseBatchColors] = useState(false)
  const [sessionDomains, setSessionDomains] = useState<string[] | null>(null)
  const [isLoadingBatchColors, setIsLoadingBatchColors] = useState(false)

  // Domain filters - default to 'domain' for consistent colors across fusions
  const [domainFilters, setDomainFilters] = useState<DomainFilters>({
    sources: [],
    dataProviders: [],  // Empty means show all; ['CDD'] would exclude CDD
    colorMode: 'domain',
  })
  const [includeCDD, setIncludeCDD] = useState(true)

  const { data: fusion, isLoading: isLoadingFusion, error: fusionError } = useFusionDetail(sessionId, fusionId)
  const { data: vizData, isLoading: isLoadingViz } = useVisualizationData(sessionId, fusionId)
  const { data: mutationData, isLoading: isLoadingMutations } = useFusionMutations(sessionId, fusionId)

  // Handler for refreshing domains from InterPro/UniProt
  const handleRefreshDomains = useCallback(async () => {
    if (!sessionId || !fusionId) return

    setIsRefreshingDomains(true)
    try {
      await refreshFusionDomains(sessionId, fusionId)
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['fusion', sessionId, fusionId] })
      queryClient.invalidateQueries({ queryKey: ['visualization', sessionId, fusionId] })
      // Also clear the session color cache so it gets rebuilt with new domains
      if (sessionId) {
        sessionColorMapCache.delete(sessionId)
        setSessionDomains(null)
      }
    } catch (error) {
      console.error('Failed to refresh domains:', error)
    } finally {
      setIsRefreshingDomains(false)
    }
  }, [sessionId, fusionId, queryClient])

  // Handler for toggling batch colors
  const handleBatchColorsToggle = useCallback(async (enabled: boolean) => {
    setUseBatchColors(enabled)

    if (enabled && sessionId && !sessionDomains) {
      // Fetch all domain names from the session
      setIsLoadingBatchColors(true)
      try {
        // Check cache first
        if (sessionColorMapCache.has(sessionId)) {
          setSessionDomains([]) // Trigger re-render, actual map is in cache
        } else {
          const domains = await getSessionDomains(sessionId)
          setSessionDomains(domains)

          // Create and cache the color map
          const map = new DomainColorMap()
          map.preloadFromDomains(domains.map(name => ({ name })))
          sessionColorMapCache.set(sessionId, map)
        }
      } catch (error) {
        console.error('Failed to fetch session domains:', error)
        setUseBatchColors(false)
      } finally {
        setIsLoadingBatchColors(false)
      }
    }
  }, [sessionId, sessionDomains])

  // Transform mutation data for the lollipop plot
  const mutations = useMemo((): MutationInfo[] => {
    if (!vizData || !mutationData) return []

    const result: MutationInfo[] = []

    // Helper to normalize mutation type
    const normalizeType = (type: string): MutationType => {
      const validTypes: MutationType[] = ['missense', 'nonsense', 'frameshift', 'silent', 'splice', 'inframe_indel', 'other']
      return validTypes.includes(type as MutationType) ? (type as MutationType) : 'other'
    }

    // Add gene A mutations (positions are already correct)
    for (const mut of mutationData.mutations_a) {
      result.push({
        position: mut.position,
        ref_aa: mut.ref_aa,
        alt_aa: mut.alt_aa,
        type: normalizeType(mut.type),
        label: mut.label,
        count: mut.count,
        source: mut.source,
      })
    }

    // Add gene B mutations (offset position to fusion coordinate space)
    const offset = vizData.junction_position - (vizData.gene_b.aa_breakpoint || 0)
    for (const mut of mutationData.mutations_b) {
      result.push({
        position: mut.position + offset,
        ref_aa: mut.ref_aa,
        alt_aa: mut.alt_aa,
        type: normalizeType(mut.type),
        label: mut.label,
        count: mut.count,
        source: mut.source,
      })
    }

    return result
  }, [vizData, mutationData])

  // Create stable handlers for each tab to track their SVG content
  const svgHandlers = useMemo(() => ({
    schematic: (svg: string) => setSvgContents(prev => ({ ...prev, schematic: svg })),
    transcript: (svg: string) => setSvgContents(prev => ({ ...prev, transcript: svg })),
    multilevel: (svg: string) => setSvgContents(prev => ({ ...prev, multilevel: svg })),
    mutations: (svg: string) => setSvgContents(prev => ({ ...prev, mutations: svg })),
  }), [])

  // Create shared domain color map for consistent colors across all visualizations
  const domainColorMap = useMemo(() => {
    // If batch colors is enabled and we have a cached session map, use it
    if (useBatchColors && sessionId && sessionColorMapCache.has(sessionId)) {
      return sessionColorMapCache.get(sessionId)!
    }

    // Otherwise create a fusion-specific color map using vizData for consistency with legend
    if (!vizData) return new DomainColorMap()
    const map = new DomainColorMap()
    // Preload all domain names for consistent colors
    const allDomains = [...vizData.gene_a.domains, ...vizData.gene_b.domains]
    map.preloadFromDomains(allDomains)
    return map
  }, [vizData, useBatchColors, sessionId, sessionDomains]) // sessionDomains triggers re-render when loaded

  // Get domains for the legend, filtered by view mode to match visualization
  // In fusion view, only show domains that are actually visible (not lost/clipped)
  const allDomains = useMemo(() => {
    if (!vizData) return []

    // Helper to check if domain would be visible in fusion view
    const isVisibleInFusionView = (domain: typeof vizData.gene_a.domains[0], gene: 'a' | 'b') => {
      // Lost domains are never visible in fusion view
      if (domain.status === 'lost') return false

      if (gene === 'a') {
        // Gene A: domain must start before junction to be visible
        return domain.start < (vizData.gene_a.aa_breakpoint || vizData.junction_position)
      } else {
        // Gene B: domain must end after the breakpoint to be visible
        return domain.end > (vizData.gene_b.aa_breakpoint || 0)
      }
    }

    let domains: typeof vizData.gene_a.domains

    if (schematicViewMode === 'fusion') {
      // In fusion view, only include domains that are visible
      domains = [
        ...vizData.gene_a.domains.filter(d => isVisibleInFusionView(d, 'a')),
        ...vizData.gene_b.domains.filter(d => isVisibleInFusionView(d, 'b'))
      ]
    } else {
      // In stacked/full view, include all domains
      domains = [...vizData.gene_a.domains, ...vizData.gene_b.domains]
    }

    if (!includeCDD) {
      return domains.filter(d => d.data_provider !== 'CDD')
    }
    return domains
  }, [vizData, includeCDD, schematicViewMode])

  // Generate legend items respecting the source filter and view mode
  const legendItems = useMemo(() => {
    const showLost = schematicViewMode === 'stacked' || schematicViewMode === 'full'
    return getLegendItems(allDomains, domainColorMap, domainFilters.sources, showLost)
  }, [allDomains, domainColorMap, domainFilters.sources, schematicViewMode])

  // Get available sources from domains - must be before any conditional returns
  // Use vizData for consistency with allDomains
  const availableSources = useMemo(() => {
    if (!vizData) return []
    const sources = new Set<string>()
    vizData.gene_a.domains.forEach(d => sources.add(d.source))
    vizData.gene_b.domains.forEach(d => sources.add(d.source))
    return Array.from(sources).sort()
  }, [vizData])

  const toggleSourceFilter = useCallback((source: string) => {
    setDomainFilters(prev => {
      const currentSources = prev.sources || []
      return {
        ...prev,
        sources: currentSources.includes(source)
          ? currentSources.filter(s => s !== source)
          : [...currentSources, source]
      }
    })
  }, [])

  // Update excludeDataProviders filter when includeCDD changes
  const effectiveFilters = useMemo((): DomainFilters => {
    return computeEffectiveFilters(domainFilters, includeCDD)
  }, [domainFilters, includeCDD])

  if (isLoadingFusion || isLoadingViz) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (fusionError || !fusion) {
    return (
      <Card>
        <CardBody>
          <div className="text-center py-12">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              Fusion not found
            </h3>
            <p className="mt-2 text-gray-500 dark:text-gray-400">
              The requested fusion could not be loaded.
            </p>
            <Link to="/" className="mt-4 inline-block">
              <Button>Back to Dashboard</Button>
            </Link>
          </div>
        </CardBody>
      </Card>
    )
  }

  const fusionName = `${fusion.gene_a_symbol}--${fusion.gene_b_symbol}`

  const InfoItem = ({ label, value }: { label: string; value: string | number | null | undefined }) => (
    <div>
      <dt className="text-sm text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="text-sm font-medium text-gray-900 dark:text-white">{value ?? '-'}</dd>
    </div>
  )

  const frameStatus = getFrameStatus(fusion.is_in_frame)
  const kinaseStatus = getKinaseStatus(fusion.has_kinase_domain, fusion.kinase_retained)

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        to={sessionId ? `/session/${sessionId}` : '/'}
        className="inline-flex items-center text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
      >
        <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Dashboard
      </Link>

      {/* Header Card */}
      <Card>
        <CardBody>
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                <span style={{ color: '#3B82F6' }}>{fusion.gene_a_symbol}</span>
                <span className="text-gray-400 mx-2">--</span>
                <span style={{ color: '#10B981' }}>{fusion.gene_b_symbol}</span>
              </h1>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Fusion Case Report
              </p>
            </div>

            <div className="mt-4 lg:mt-0 flex flex-wrap items-center gap-2">
              <StatusBadge {...frameStatus} />
              {kinaseStatus && <StatusBadge {...kinaseStatus} />}
              {fusion.confidence && (fusion.junction_reads != null || fusion.spanning_reads != null) && (
                <StatusBadge
                  status={fusion.confidence === 'high' ? 'positive' : fusion.confidence === 'low' ? 'negative' : 'unknown'}
                  label={`${fusion.confidence} confidence`}
                />
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRefreshDomains}
                disabled={isRefreshingDomains}
                title="Fetch comprehensive domain data from InterPro, UniProt, Pfam, SMART, CDD, and other databases"
              >
                {isRefreshingDomains ? (
                  <span className="flex items-center">
                    <LoadingSpinner size="sm" className="-ml-1 mr-2" />
                    Fetching...
                  </span>
                ) : (
                  <span className="flex items-center">
                    <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Refresh Domains
                  </span>
                )}
              </Button>
            </div>
          </div>

          {/* Metadata grid */}
          <div className="mt-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <InfoItem label="Genome Build" value={fusion.genome_build === 'hg19' ? 'hg19 (GRCh37)' : 'hg38 (GRCh38)'} />
            <InfoItem label="Gene A Breakpoint" value={fusion.gene_a_chromosome ? `chr${fusion.gene_a_chromosome}:${fusion.gene_a_breakpoint}` : undefined} />
            <InfoItem label="Gene A Strand" value={fusion.gene_a_strand} />
            <InfoItem label="Gene B Breakpoint" value={fusion.gene_b_chromosome ? `chr${fusion.gene_b_chromosome}:${fusion.gene_b_breakpoint}` : undefined} />
            <InfoItem label="Gene B Strand" value={fusion.gene_b_strand} />
            {fusion.junction_reads != null && (
              <InfoItem label="Junction Reads" value={fusion.junction_reads} />
            )}
            {fusion.spanning_reads != null && (
              <InfoItem label="Spanning Reads" value={fusion.spanning_reads} />
            )}
          </div>
        </CardBody>
      </Card>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex space-x-8 overflow-x-auto">
          {[
            { id: 'schematic', label: 'Protein Schematic' },
            { id: 'transcript', label: 'Fusion Transcript' },
            { id: 'multilevel', label: 'Multi-Level View' },
            { id: 'mutations', label: 'Mutations' },
            { id: 'sequence', label: 'Sequence View' },
            { id: 'domains', label: 'Domain Details' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors
                ${activeTab === tab.id
                  ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content based on active tab */}
      {activeTab === 'schematic' && vizData && (
        <Card>
          <CardHeader>
            <div className="space-y-3">
              {/* Row 1: View mode and Export */}
              <div className="flex items-center justify-between">
                <ViewModeSelector value={schematicViewMode} onChange={setSchematicViewMode} />
                <ExportButtons
                  svgContent={svgContents['schematic'] || null}
                  sequence={fusion.fusion_sequence || null}
                  fusionName={fusionName}
                  legendItems={domainFilters.colorMode === 'domain' ? legendItems : []}
                />
              </div>

              {/* Row 2: Options */}
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <label className="flex items-center space-x-2 text-gray-600 dark:text-gray-400">
                  <input
                    type="checkbox"
                    checked={showStrandOrientation}
                    onChange={(e) => setShowStrandOrientation(e.target.checked)}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span>Show strand</span>
                </label>

                <div className="flex items-center space-x-2 text-gray-600 dark:text-gray-400">
                  <span>Color by:</span>
                  <select
                    value={domainFilters.colorMode || 'domain'}
                    onChange={(e) => setDomainFilters(prev => ({ ...prev, colorMode: e.target.value as ColorMode }))}
                    className="text-sm px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                  >
                    <option value="domain">Domain name</option>
                    <option value="type">Feature type</option>
                    <option value="source">Database</option>
                  </select>
                </div>

                {domainFilters.colorMode === 'domain' && (
                  <label className="flex items-center space-x-2 text-gray-600 dark:text-gray-400">
                    <input
                      type="checkbox"
                      checked={useBatchColors}
                      onChange={(e) => handleBatchColorsToggle(e.target.checked)}
                      disabled={isLoadingBatchColors}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="flex items-center">
                      Batch colors
                      {isLoadingBatchColors && <LoadingSpinner size="sm" className="ml-1" />}
                    </span>
                  </label>
                )}

                <label className="flex items-center space-x-2 text-gray-600 dark:text-gray-400" title="Include domain predictions from NCBI CDD (Conserved Domain Database)">
                  <input
                    type="checkbox"
                    checked={includeCDD}
                    onChange={(e) => setIncludeCDD(e.target.checked)}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span>Include CDD</span>
                </label>
              </div>

              {/* Row 3: Database filter */}
              <DatabaseFilter
                sources={availableSources}
                selectedSources={domainFilters.sources || []}
                onToggle={toggleSourceFilter}
              />
            </div>
          </CardHeader>
          <CardBody>
            <ProteinSchematic
              data={vizData}
              filters={effectiveFilters}
              showStrandOrientation={showStrandOrientation}
              onSvgReady={svgHandlers.schematic}
              domainColorMap={domainColorMap}
              viewMode={schematicViewMode}
            />
            <div className="mt-4">
              {domainFilters.colorMode === 'domain' && (
                <DomainColorLegend
                  domains={allDomains}
                  colorMap={domainColorMap}
                  sourceFilter={domainFilters.sources}
                  showLost={schematicViewMode === 'stacked' || schematicViewMode === 'full'}
                  compact
                />
              )}
              {domainFilters.colorMode === 'type' && (
                <FeatureTypeLegend compact domains={allDomains} sourceFilter={domainFilters.sources} />
              )}
              {domainFilters.colorMode === 'source' && (
                <SourceLegend compact sources={availableSources} />
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {activeTab === 'transcript' && vizData && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-gray-900 dark:text-white">Fusion Transcript</h3>
              <ExportButtons
                svgContent={svgContents['transcript'] || null}
                sequence={null}
                fusionName={`${fusionName}-transcript`}
              />
            </div>
          </CardHeader>
          <CardBody>
            <FusionTranscriptView data={vizData} onSvgReady={svgHandlers.transcript} />
          </CardBody>
        </Card>
      )}

      {activeTab === 'multilevel' && vizData && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-gray-900 dark:text-white">Multi-Level View</h3>
              <ExportButtons
                svgContent={svgContents['multilevel'] || null}
                sequence={null}
                fusionName={`${fusionName}-multilevel`}
              />
            </div>
          </CardHeader>
          <CardBody>
            <MultiLevelView data={vizData} domainColorMap={domainColorMap} onSvgReady={svgHandlers.multilevel} />
          </CardBody>
        </Card>
      )}

      {activeTab === 'mutations' && vizData && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-gray-900 dark:text-white">Mutation Lollipop Plot</h3>
              <ExportButtons
                svgContent={svgContents['mutations'] || null}
                sequence={null}
                fusionName={`${fusionName}-mutations`}
              />
            </div>
          </CardHeader>
          <CardBody>
            <div className="space-y-4">
              {isLoadingMutations ? (
                <div className="flex items-center justify-center py-12">
                  <LoadingSpinner />
                  <span className="ml-2 text-gray-600 dark:text-gray-400">Loading mutation data from cBioPortal...</span>
                </div>
              ) : mutations.length === 0 ? (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <div className="flex items-start">
                    <svg className="w-5 h-5 text-blue-500 mt-0.5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="text-sm text-blue-700 dark:text-blue-300">
                      <p className="font-medium">No mutations found</p>
                      <p className="mt-1">No mutation data found in cBioPortal for the retained regions of these genes. This could mean these regions have low mutation rates or the genes are not well-covered in the available studies.</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                  <div className="flex items-start">
                    <svg className="w-5 h-5 text-green-500 mt-0.5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="text-sm text-green-700 dark:text-green-300">
                      <p className="font-medium">Real Mutation Data from cBioPortal</p>
                      <p className="mt-1">Showing {mutations.length} mutations from TCGA, MSK-IMPACT, and other cancer genomics studies. Only mutations in the retained regions of the fusion protein are displayed.</p>
                    </div>
                  </div>
                </div>
              )}
              <LollipopPlot data={vizData} mutations={mutations} domainColorMap={domainColorMap} onSvgReady={svgHandlers.mutations} />
            </div>
          </CardBody>
        </Card>
      )}

      {activeTab === 'sequence' && fusion.fusion_sequence && vizData && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-gray-900 dark:text-white">
                Fusion Protein Sequence ({fusion.fusion_sequence.length} aa)
              </h3>
              <ExportButtons
                svgContent={null}
                sequence={fusion.fusion_sequence}
                fusionName={fusionName}
              />
            </div>
          </CardHeader>
          <CardBody>
            <SequenceView
              sequence={fusion.fusion_sequence}
              junctionPosition={vizData.junction_position}
              geneAColor={vizData.gene_a.color}
              geneBColor={vizData.gene_b.color}
            />
          </CardBody>
        </Card>
      )}

      {activeTab === 'sequence' && !fusion.fusion_sequence && (
        <Card>
          <CardBody>
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              Fusion sequence not available. This may occur if the breakpoints fall outside coding regions.
            </div>
          </CardBody>
        </Card>
      )}

      {activeTab === 'domains' && (
        <Card>
          <CardHeader>
            <h3 className="font-medium text-gray-900 dark:text-white">
              Domain Analysis
            </h3>
          </CardHeader>
          <CardBody>
            <DomainDetailPanel
              domainsA={fusion.domains_a || []}
              domainsB={fusion.domains_b || []}
              geneASymbol={fusion.gene_a_symbol}
              geneBSymbol={fusion.gene_b_symbol}
            />
          </CardBody>
        </Card>
      )}
    </div>
  )
}
