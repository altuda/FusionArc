import { useState, useMemo, useCallback, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import Card, { CardHeader, CardBody } from '../components/common/Card'
import Button from '../components/common/Button'
import LoadingSpinner from '../components/common/LoadingSpinner'
import StatusBadge, { getFrameStatus, getKinaseStatus } from '../components/common/StatusBadge'
import ViewModeSelector from '../components/common/ViewModeSelector'
import DatabaseFilter from '../components/common/DatabaseFilter'
import ProteinSchematic, { DomainFilters, ColorMode, ViewMode } from '../components/visualization/ProteinSchematic'
import FusionTranscriptView from '../components/visualization/FusionTranscriptView'
import MultiLevelView from '../components/visualization/MultiLevelView'
import DomainColorLegend from '../components/visualization/DomainColorLegend'
import { useFusions, useVisualizationData } from '../hooks/useFusions'
import { getSessionDomains, getSessionDomainSources, getSessionDomainsInfo, FusionResponse, SessionDomainInfo, DomainInfo } from '../api/client'
import { DomainColorMap } from '../utils/domainColors'

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
}: {
  fusion: FusionResponse
  sessionId: string
  activeTab: ViewTab
  viewMode: ViewMode
  domainFilters: DomainFilters
  showStrandOrientation: boolean
  domainColorMap: DomainColorMap
}) {
  const { data: vizData, isLoading } = useVisualizationData(sessionId, fusion.id)

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
          <Link
            to={`/session/${sessionId}/fusion/${fusion.id}`}
            className="text-sm text-primary-600 hover:text-primary-700 dark:text-primary-400"
          >
            View Details →
          </Link>
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
          />
        )}
        {activeTab === 'transcript' && (
          <FusionTranscriptView data={vizData} />
        )}
        {activeTab === 'multilevel' && (
          <MultiLevelView data={vizData} domainColorMap={domainColorMap} />
        )}
      </CardBody>
    </Card>
  )
}

export default function BatchView() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [activeTab, setActiveTab] = useState<ViewTab>('schematic')
  const [viewMode, setViewMode] = useState<ViewMode>('fusion')
  const [showStrandOrientation, setShowStrandOrientation] = useState(false)
  const [sessionDomains, setSessionDomains] = useState<string[] | null>(null)
  const [sessionDomainsInfo, setSessionDomainsInfo] = useState<SessionDomainInfo[]>([])
  const [availableSources, setAvailableSources] = useState<string[]>([])
  const [isLoadingDomains, setIsLoadingDomains] = useState(false)

  const [domainFilters, setDomainFilters] = useState<DomainFilters>({
    sources: [],
    colorMode: 'domain',
  })

  const { data: fusionsData, isLoading: isLoadingFusions } = useFusions(sessionId)

  // Load session domains and sources for consistent colors across all fusions
  const loadSessionData = useCallback(async () => {
    if (!sessionId || sessionDomains !== null) return

    setIsLoadingDomains(true)
    try {
      const [domains, sources, domainsInfo] = await Promise.all([
        getSessionDomains(sessionId),
        getSessionDomainSources(sessionId),
        getSessionDomainsInfo(sessionId)
      ])
      setSessionDomains(domains)
      setAvailableSources(sources)
      setSessionDomainsInfo(domainsInfo)
    } catch (error) {
      console.error('Failed to load session data:', error)
      setSessionDomains([])
      setAvailableSources([])
      setSessionDomainsInfo([])
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

  // Create shared domain color map
  const domainColorMap = useMemo(() => {
    const map = new DomainColorMap()
    if (sessionDomains && sessionDomains.length > 0) {
      map.preloadFromDomains(sessionDomains.map(name => ({ name })))
    }
    return map
  }, [sessionDomains])

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

      {/* Domain Legend (shared across all fusions) */}
      {domainFilters.colorMode === 'domain' && sessionDomainsInfo.length > 0 && (
        <Card>
          <CardHeader>
            <h3 className="text-sm font-medium text-gray-900 dark:text-white">Domain Legend (Batch-Consistent Colors)</h3>
          </CardHeader>
          <CardBody>
            <DomainColorLegend
              domains={sessionDomainsInfo.map(d => ({
                name: d.name,
                source: d.source,
                start: 0,
                end: 0,
                status: d.status,
                is_kinase: d.is_kinase
              } as DomainInfo))}
              colorMap={domainColorMap}
              sourceFilter={domainFilters.sources || []}
              showLost={viewMode === 'stacked' || viewMode === 'full'}
              compact
            />
          </CardBody>
        </Card>
      )}

      {/* Fusion Cards */}
      <div className="space-y-6">
        {fusionsData.fusions.map((fusion) => (
          <FusionCard
            key={fusion.id}
            fusion={fusion}
            sessionId={sessionId!}
            activeTab={activeTab}
            viewMode={viewMode}
            domainFilters={domainFilters}
            showStrandOrientation={showStrandOrientation}
            domainColorMap={domainColorMap}
          />
        ))}
      </div>
    </div>
  )
}
