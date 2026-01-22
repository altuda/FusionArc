import { useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import Card, { CardHeader, CardBody } from '../components/common/Card'
import Button from '../components/common/Button'
import ProteinSchematic from '../components/visualization/ProteinSchematic'
import SequenceView from '../components/visualization/SequenceView'
import DomainDetailPanel from '../components/visualization/DomainDetailPanel'
import ExportButtons from '../components/visualization/ExportButtons'
import { useFusionDetail, useVisualizationData } from '../hooks/useFusions'

export default function FusionDetail() {
  const { sessionId, fusionId } = useParams<{ sessionId: string; fusionId: string }>()
  const [showAllDomains, setShowAllDomains] = useState(true)
  const [svgContent, setSvgContent] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'schematic' | 'sequence' | 'domains'>('schematic')

  const { data: fusion, isLoading: isLoadingFusion, error: fusionError } = useFusionDetail(sessionId, fusionId)
  const { data: vizData, isLoading: isLoadingViz } = useVisualizationData(sessionId, fusionId)

  const handleSvgReady = useCallback((svg: string) => {
    setSvgContent(svg)
  }, [])

  if (isLoadingFusion || isLoadingViz) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <svg className="animate-spin h-12 w-12 text-primary-600" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
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

  const StatusBadge = ({ status, label }: { status: 'positive' | 'negative' | 'unknown'; label: string }) => {
    const colors = {
      positive: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      negative: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      unknown: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
    }
    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${colors[status]}`}>
        {label}
      </span>
    )
  }

  const getFrameStatus = () => {
    if (fusion.is_in_frame === 1) return { status: 'positive' as const, label: 'In-frame' }
    if (fusion.is_in_frame === 0) return { status: 'negative' as const, label: 'Out-of-frame' }
    return { status: 'unknown' as const, label: 'Unknown' }
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

            <div className="mt-4 lg:mt-0 flex flex-wrap gap-2">
              <StatusBadge {...getFrameStatus()} />
              {fusion.has_kinase_domain === 1 && (
                <StatusBadge
                  status={fusion.kinase_retained === 1 ? 'positive' : fusion.kinase_retained === 0 ? 'negative' : 'unknown'}
                  label={fusion.kinase_retained === 1 ? 'Kinase retained' : fusion.kinase_retained === 0 ? 'Kinase lost' : 'Kinase status unknown'}
                />
              )}
              {fusion.confidence && (
                <StatusBadge
                  status={fusion.confidence === 'high' ? 'positive' : fusion.confidence === 'low' ? 'negative' : 'unknown'}
                  label={`${fusion.confidence} confidence`}
                />
              )}
            </div>
          </div>

          {/* Metadata grid */}
          <div className="mt-6 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <InfoItem label="Gene A Breakpoint" value={fusion.gene_a_chromosome ? `chr${fusion.gene_a_chromosome}:${fusion.gene_a_breakpoint}` : undefined} />
            <InfoItem label="Gene A Strand" value={fusion.gene_a_strand} />
            <InfoItem label="Gene B Breakpoint" value={fusion.gene_b_chromosome ? `chr${fusion.gene_b_chromosome}:${fusion.gene_b_breakpoint}` : undefined} />
            <InfoItem label="Gene B Strand" value={fusion.gene_b_strand} />
            <InfoItem label="Junction Reads" value={fusion.junction_reads} />
            <InfoItem label="Spanning Reads" value={fusion.spanning_reads} />
          </div>
        </CardBody>
      </Card>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex space-x-8">
          {[
            { id: 'schematic', label: 'Protein Schematic' },
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
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <label className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
                  <input
                    type="checkbox"
                    checked={showAllDomains}
                    onChange={(e) => setShowAllDomains(e.target.checked)}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span>Show all domains</span>
                </label>
              </div>
              <ExportButtons
                svgContent={svgContent}
                sequence={fusion.fusion_sequence || null}
                fusionName={fusionName}
              />
            </div>
          </CardHeader>
          <CardBody>
            <ProteinSchematic
              data={vizData}
              showAllDomains={showAllDomains}
              onSvgReady={handleSvgReady}
            />
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
