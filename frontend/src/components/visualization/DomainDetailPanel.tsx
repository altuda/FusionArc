import { DomainInfo } from '../../api/client'

interface DomainDetailPanelProps {
  domainsA: DomainInfo[]
  domainsB: DomainInfo[]
  geneASymbol: string
  geneBSymbol: string
}

export default function DomainDetailPanel({
  domainsA,
  domainsB,
  geneASymbol,
  geneBSymbol,
}: DomainDetailPanelProps) {
  const StatusBadge = ({ status }: { status: string }) => {
    const colors = {
      retained: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      truncated: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
      lost: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      unknown: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
    }

    return (
      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${colors[status as keyof typeof colors] || colors.unknown}`}>
        {status}
      </span>
    )
  }

  const DomainList = ({
    domains,
    geneSymbol,
    color,
  }: {
    domains: DomainInfo[]
    geneSymbol: string
    color: string
  }) => (
    <div className="space-y-2">
      <h4 className="font-medium text-gray-900 dark:text-white flex items-center">
        <span className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: color }} />
        {geneSymbol} Domains ({domains.length})
      </h4>

      {domains.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 italic">No domains found</p>
      ) : (
        <div className="space-y-2">
          {domains.map((domain, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
            >
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <span className="font-medium text-gray-900 dark:text-white">
                    {domain.name}
                  </span>
                  {domain.is_kinase && (
                    <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 rounded-full">
                      Kinase
                    </span>
                  )}
                  <StatusBadge status={domain.status} />
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {domain.source} • Position: {domain.start}-{domain.end}
                </div>
                {domain.description && (
                  <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {domain.description}
                  </div>
                )}
              </div>

              <div className="flex items-center space-x-2 ml-4">
                {domain.accession && (
                  <>
                    <a
                      href={`https://pfam.xfam.org/family/${domain.accession}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400"
                    >
                      Pfam
                    </a>
                    <span className="text-gray-300 dark:text-gray-600">|</span>
                    <a
                      href={`https://www.uniprot.org/uniprot/?query=${domain.accession}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400"
                    >
                      UniProt
                    </a>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  // Summary statistics
  const retainedA = domainsA.filter(d => d.status === 'retained').length
  const retainedB = domainsB.filter(d => d.status === 'retained').length
  const totalKinase = [...domainsA, ...domainsB].filter(d => d.is_kinase).length
  const retainedKinase = [...domainsA, ...domainsB].filter(d => d.is_kinase && d.status === 'retained').length

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {retainedA + retainedB}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Domains Retained</div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {domainsA.filter(d => d.status === 'truncated').length + domainsB.filter(d => d.status === 'truncated').length}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Domains Truncated</div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {domainsA.filter(d => d.status === 'lost').length + domainsB.filter(d => d.status === 'lost').length}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Domains Lost</div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
          <div className={`text-2xl font-bold ${retainedKinase > 0 ? 'text-green-600 dark:text-green-400' : totalKinase > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>
            {retainedKinase}/{totalKinase}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Kinase Domains</div>
        </div>
      </div>

      {/* Domain lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DomainList domains={domainsA} geneSymbol={geneASymbol} color="#3B82F6" />
        <DomainList domains={domainsB} geneSymbol={geneBSymbol} color="#10B981" />
      </div>
    </div>
  )
}
