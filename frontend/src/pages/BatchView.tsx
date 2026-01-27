import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import Card, { CardHeader, CardBody } from '../components/common/Card'
import Button from '../components/common/Button'
import LoadingSpinner from '../components/common/LoadingSpinner'
import StatusBadge, { getFrameStatus, getKinaseStatus } from '../components/common/StatusBadge'
import ViewModeSelector from '../components/common/ViewModeSelector'
import DatabaseFilter from '../components/common/DatabaseFilter'
import ProteinSchematic, { DomainFilters, ColorMode, ViewMode } from '../components/visualization/ProteinSchematic'
import FusionTranscriptView from '../components/visualization/FusionTranscriptView'
import MultiLevelView from '../components/visualization/MultiLevelView'
import DomainColorLegend, { LegendItem, getLegendItems, FeatureTypeLegend, SourceLegend } from '../components/visualization/DomainColorLegend'
import ExportButtons from '../components/visualization/ExportButtons'
import { useFusions, useVisualizationData } from '../hooks/useFusions'
import { getSessionDomains, getSessionDomainSources, refreshFusionDomains, FusionResponse, DomainInfo } from '../api/client'
import { DomainColorMap } from '../utils/domainColors'
import { computeEffectiveFilters } from '../utils/domainFilters'

type ViewTab = 'schematic' | 'transcript' | 'multilevel'

// Single fusion card component
function FusionCard({
  fusion,
  sessionId,
  activeTab,
  viewMode,
  domainFilters,
  showStrandOrientation,
  domainColorMap,
  legendItems,
  onDomainsLoaded,
}: {
  fusion: FusionResponse
  sessionId: string
  activeTab: ViewTab
  viewMode: ViewMode
  domainFilters: DomainFilters
  showStrandOrientation: boolean
  domainColorMap: DomainColorMap
  legendItems: LegendItem[]
  onDomainsLoaded?: (fusionId: string, domains: DomainInfo[]) => void
}) {
  const { data: vizData, isLoading } = useVisualizationData(sessionId, fusion.id)

  // Report domains when visualization data loads
  useEffect(() => {
    if (vizData && onDomainsLoaded) {
      const allDomains = [...vizData.gene_a.domains, ...vizData.gene_b.domains]
      onDomainsLoaded(fusion.id, allDomains)
    }
  }, [vizData, fusion.id, onDomainsLoaded])
  const [svgContent, setSvgContent] = useState<string | null>(null)

  const fusionName = `${fusion.gene_a_symbol}--${fusion.gene_b_symbol}`
  const frameStatus = getFrameStatus(fusion.is_in_frame)
  const kinaseStatus = getKinaseStatus(fusion.has_kinase_domain, fusion.kinase_retained)

  if (isLoading) {
    return (
      <Card>
        <CardBody>
          <div className="flex items-center justify-center py-12">
            <LoadingSpinner />
            <span className="ml-2 text-gray-600 dark:text-gray-400">Loading {fusionName}...</span>
          </div>
        </CardBody>
      </Card>
    )
  }

  if (!vizData) {
    return (
      <Card>
        <CardBody>
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            Failed to load visualization for {fusionName}
          </div>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              <span style={{ color: '#3B82F6' }}>{fusion.gene_a_symbol}</span>
              <span className="text-gray-400 mx-2">--</span>
              <span style={{ color: '#10B981' }}>{fusion.gene_b_symbol}</span>
            </h2>
            <span className={`px-2 py-0.5 text-xs font-medium rounded ${
              fusion.genome_build === 'hg19'
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'
                : 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
            }`}>
              {fusion.genome_build || 'hg38'}
            </span>
            <StatusBadge {...frameStatus} />
            {kinaseStatus && <StatusBadge {...kinaseStatus} />}
          </div>
          <div className="flex items-center space-x-4">
            <ExportButtons
              svgContent={svgContent}
              sequence={null}
              fusionName={fusionName}
              legendItems={legendItems}
            />
            <Link
              to={`/session/${sessionId}/fusion/${fusion.id}`}
              className="text-sm text-primary-600 hover:text-primary-700 dark:text-primary-400"
            >
              View Details →
            </Link>
          </div>
        </div>
        <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          <span className="mr-4">
            {fusion.gene_a_chromosome}:{fusion.gene_a_breakpoint}
          </span>
          <span>
            {fusion.gene_b_chromosome}:{fusion.gene_b_breakpoint}
          </span>
        </div>
      </CardHeader>
      <CardBody>
        {activeTab === 'schematic' && (
          <ProteinSchematic
            data={vizData}
            filters={domainFilters}
            showStrandOrientation={showStrandOrientation}
            domainColorMap={domainColorMap}
            viewMode={viewMode}
            onSvgReady={setSvgContent}
          />
        )}
        {activeTab === 'transcript' && (
          <FusionTranscriptView data={vizData} onSvgReady={setSvgContent} />
        )}
        {activeTab === 'multilevel' && (
          <MultiLevelView data={vizData} domainColorMap={domainColorMap} onSvgReady={setSvgContent} />
        )}
      </CardBody>
    </Card>
  )
}

export default function BatchView() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<ViewTab>('schematic')
  const [viewMode, setViewMode] = useState<ViewMode>('fusion')
  const [showStrandOrientation, setShowStrandOrientation] = useState(false)
  const [sessionDomains, setSessionDomains] = useState<string[] | null>(null)
  const [availableSources, setAvailableSources] = useState<string[]>([])
  const [isLoadingDomains, setIsLoadingDomains] = useState(false)
  const [isRefreshingDomains, setIsRefreshingDomains] = useState(false)
  const [aggregatedDomains, setAggregatedDomains] = useState<DomainInfo[]>([])
  const fusionDomainsRef = useRef<Map<string, DomainInfo[]>>(new Map())

  const [domainFilters, setDomainFilters] = useState<DomainFilters>({
    sources: [],
    dataProviders: [],
    colorMode: 'domain',
  })
  const [includeCDD, setIncludeCDD] = useState(true)
  const [useBatchConsistentColors, setUseBatchConsistentColors] = useState(true)

  const { data: fusionsData, isLoading: isLoadingFusions } = useFusions(sessionId)

  // Load session domains and sources for consistent colors across all fusions
  const loadSessionData = useCallback(async () => {
    if (!sessionId || sessionDomains !== null) return

    setIsLoadingDomains(true)
    try {
      const [domains, sources] = await Promise.all([
        getSessionDomains(sessionId),
        getSessionDomainSources(sessionId)
      ])
      setSessionDomains(domains)
      setAvailableSources(sources)
    } catch (error) {
      console.error('Failed to load session data:', error)
      setSessionDomains([])
      setAvailableSources([])
    } finally {
      setIsLoadingDomains(false)
    }
  }, [sessionId, sessionDomains])

  // Load data on mount
  useEffect(() => {
    loadSessionData()
  }, [loadSessionData])

  // Toggle source filter
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

  // Collect domains from all fusions for the legend
  const handleDomainsLoaded = useCallback((fusionId: string, domains: DomainInfo[]) => {
    fusionDomainsRef.current.set(fusionId, domains)
    // Aggregate all domains from all fusions
    const allDomains: DomainInfo[] = []
    fusionDomainsRef.current.forEach(d => allDomains.push(...d))
    setAggregatedDomains(allDomains)
  }, [])

  // Handler for refreshing domains for all fusions in batch
  // Process sequentially to avoid SQLite database locking issues
  const handleRefreshDomains = useCallback(async () => {
    if (!sessionId || !fusionsData) return

    setIsRefreshingDomains(true)
    try {
      // Refresh domains for each fusion sequentially (to avoid SQLite locking)
      for (const fusion of fusionsData.fusions) {
        try {
          await refreshFusionDomains(sessionId, fusion.id)
        } catch (error) {
          console.error(`Failed to refresh domains for ${fusion.gene_a_symbol}--${fusion.gene_b_symbol}:`, error)
        }
      }
      // Invalidate all relevant queries
      queryClient.invalidateQueries({ queryKey: ['fusions', sessionId] })
      fusionsData.fusions.forEach(fusion => {
        queryClient.invalidateQueries({ queryKey: ['fusion', sessionId, fusion.id] })
        queryClient.invalidateQueries({ queryKey: ['visualization', sessionId, fusion.id] })
      })
      // Reset session domains and aggregated domains to trigger reload
      setSessionDomains(null)
      setAvailableSources([])
      setAggregatedDomains([])
      fusionDomainsRef.current.clear()
    } catch (error) {
      console.error('Failed to refresh domains:', error)
    } finally {
      setIsRefreshingDomains(false)
    }
  }, [sessionId, fusionsData, queryClient])

  // Create shared domain color map
  const domainColorMap = useMemo(() => {
    const map = new DomainColorMap()
    if (useBatchConsistentColors && sessionDomains && sessionDomains.length > 0) {
      map.preloadFromDomains(sessionDomains.map(name => ({ name })))
    }
    return map
  }, [sessionDomains, useBatchConsistentColors])

  // Compute effective filters based on includeCDD toggle
  const effectiveFilters = useMemo((): DomainFilters => {
    return computeEffectiveFilters(domainFilters, includeCDD)
  }, [domainFilters, includeCDD])

  // Filter aggregated domains based on includeCDD for legend
  const filteredAggregatedDomains = useMemo(() => {
    if (!includeCDD) {
      return aggregatedDomains.filter(d => d.data_provider !== 'CDD')
    }
    return aggregatedDomains
  }, [aggregatedDomains, includeCDD])

  // Create legend items for exports (using aggregated domain info from visualization data)
  const legendItems = useMemo(() => {
    if (filteredAggregatedDomains.length === 0) return []

    return getLegendItems(
      filteredAggregatedDomains,
      domainColorMap,
      domainFilters.sources || [],
      viewMode === 'stacked' || viewMode === 'full'
    )
  }, [filteredAggregatedDomains, domainColorMap, domainFilters.sources, viewMode])

  if (isLoadingFusions) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!fusionsData || fusionsData.fusions.length === 0) {
    return (
      <Card>
        <CardBody>
          <div className="text-center py-12">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              No fusions in batch
            </h3>
            <p className="mt-2 text-gray-500 dark:text-gray-400">
              This batch doesn't contain any fusions.
            </p>
            <Link to="/" className="mt-4 inline-block">
              <Button>Back to Dashboard</Button>
            </Link>
          </div>
        </CardBody>
      </Card>
    )
  }

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
        Back to Session
      </Link>

      {/* Header */}
      <Card>
        <CardBody>
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Batch Comparison
              </h1>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {fusionsData.total} fusions with consistent domain coloring
              </p>
            </div>
            <div className="mt-4 lg:mt-0">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRefreshDomains}
                disabled={isRefreshingDomains}
                title="Fetch comprehensive domain data from InterPro, UniProt, Pfam, SMART, CDD, and other databases for all fusions"
              >
                {isRefreshingDomains ? (
                  <span className="flex items-center">
                    <LoadingSpinner size="sm" className="-ml-1 mr-2" />
                    Refreshing ({fusionsData.total})...
                  </span>
                ) : (
                  <span className="flex items-center">
                    <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Refresh All Domains
                  </span>
                )}
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Controls */}
      <Card>
        <CardBody>
          <div className="space-y-4">
            {/* Tab Navigation */}
            <div className="flex items-center justify-between">
              <div className="flex space-x-4">
                {[
                  { id: 'schematic', label: 'Protein Schematic' },
                  { id: 'transcript', label: 'Fusion Transcript' },
                  { id: 'multilevel', label: 'Multi-Level View' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as ViewTab)}
                    className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors
                      ${activeTab === tab.id
                        ? 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300'
                        : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'
                      }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {isLoadingDomains && (
                <span className="text-sm text-gray-500 flex items-center">
                  <LoadingSpinner size="sm" className="mr-2" />
                  Loading batch colors...
                </span>
              )}
            </div>

            {/* View Options */}
            {activeTab === 'schematic' && (
              <div className="space-y-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                {/* Row 1: View mode and options */}
                <div className="flex flex-wrap items-center gap-4">
                  <ViewModeSelector value={viewMode} onChange={setViewMode} />

                  <label className="flex items-center space-x-2 text-gray-600 dark:text-gray-400 text-sm">
                    <input
                      type="checkbox"
                      checked={showStrandOrientation}
                      onChange={(e) => setShowStrandOrientation(e.target.checked)}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span>Show strand</span>
                  </label>

                  <div className="flex items-center space-x-2 text-gray-600 dark:text-gray-400 text-sm">
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
                    <label className="flex items-center space-x-2 text-gray-600 dark:text-gray-400 text-sm"
                           title="Use consistent domain colors across all fusions in the batch">
                      <input
                        type="checkbox"
                        checked={useBatchConsistentColors}
                        onChange={(e) => setUseBatchConsistentColors(e.target.checked)}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span>Batch consistent colors</span>
                    </label>
                  )}

                  <label className="flex items-center space-x-2 text-gray-600 dark:text-gray-400 text-sm" title="Include domain predictions from NCBI CDD (Conserved Domain Database)">
                    <input
                      type="checkbox"
                      checked={includeCDD}
                      onChange={(e) => setIncludeCDD(e.target.checked)}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span>Include CDD</span>
                  </label>
                </div>

                {/* Row 2: Database filter */}
                <DatabaseFilter
                  sources={availableSources}
                  selectedSources={domainFilters.sources || []}
                  onToggle={toggleSourceFilter}
                />
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Color Legend (shared across all fusions) */}
      <Card>
        <CardHeader>
          <h3 className="text-sm font-medium text-gray-900 dark:text-white">
            {domainFilters.colorMode === 'domain'
              ? (useBatchConsistentColors ? 'Domain Legend (Batch-Consistent Colors)' : 'Domain Legend')
              : domainFilters.colorMode === 'type' ? 'Feature Type Legend' : 'Database Source Legend'}
          </h3>
        </CardHeader>
        <CardBody>
          {domainFilters.colorMode === 'domain' && filteredAggregatedDomains.length > 0 && (
            <DomainColorLegend
              domains={filteredAggregatedDomains}
              colorMap={domainColorMap}
              sourceFilter={domainFilters.sources || []}
              showLost={viewMode === 'stacked' || viewMode === 'full'}
              compact
            />
          )}
          {domainFilters.colorMode === 'type' && (
            <FeatureTypeLegend
              compact
              domains={filteredAggregatedDomains}
              sourceFilter={domainFilters.sources || []}
            />
          )}
          {domainFilters.colorMode === 'source' && (
            <SourceLegend compact sources={availableSources} />
          )}
        </CardBody>
      </Card>

      {/* Fusion Cards */}
      <div className="space-y-6">
        {fusionsData.fusions.map((fusion) => (
          <FusionCard
            key={fusion.id}
            fusion={fusion}
            sessionId={sessionId!}
            activeTab={activeTab}
            viewMode={viewMode}
            domainFilters={effectiveFilters}
            showStrandOrientation={showStrandOrientation}
            domainColorMap={domainColorMap}
            legendItems={legendItems}
            onDomainsLoaded={handleDomainsLoaded}
          />
        ))}
      </div>
    </div>
  )
}
