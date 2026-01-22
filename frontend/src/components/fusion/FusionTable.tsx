import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FusionResponse } from '../../api/client'

interface FusionTableProps {
  fusions: FusionResponse[]
  sessionId: string
}

type SortField = 'name' | 'reads' | 'confidence' | 'frame'
type SortDir = 'asc' | 'desc'

export default function FusionTable({ fusions, sessionId }: FusionTableProps) {
  const [sortField, setSortField] = useState<SortField>('reads')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const sortedFusions = [...fusions].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    switch (sortField) {
      case 'name':
        return dir * `${a.gene_a_symbol}--${a.gene_b_symbol}`.localeCompare(`${b.gene_a_symbol}--${b.gene_b_symbol}`)
      case 'reads':
        return dir * ((a.junction_reads || 0) + (a.spanning_reads || 0) - (b.junction_reads || 0) - (b.spanning_reads || 0))
      case 'confidence':
        const confOrder = { high: 3, medium: 2, low: 1 }
        return dir * ((confOrder[a.confidence as keyof typeof confOrder] || 0) - (confOrder[b.confidence as keyof typeof confOrder] || 0))
      case 'frame':
        return dir * ((a.is_in_frame || -1) - (b.is_in_frame || -1))
      default:
        return 0
    }
  })

  const SortIcon = ({ field }: { field: SortField }) => (
    <span className="ml-1 text-gray-400">
      {sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  )

  const IndicatorDot = ({ status }: { status: 'green' | 'yellow' | 'red' | 'gray' }) => {
    const colors = {
      green: 'bg-green-500',
      yellow: 'bg-yellow-500',
      red: 'bg-red-500',
      gray: 'bg-gray-400',
    }
    return <span className={`inline-block w-3 h-3 rounded-full ${colors[status]}`} />
  }

  const getFrameStatus = (isInFrame: number | undefined): 'green' | 'red' | 'gray' => {
    if (isInFrame === 1) return 'green'
    if (isInFrame === 0) return 'red'
    return 'gray'
  }

  const getKinaseStatus = (hasKinase: number, kinaseRetained: number): 'green' | 'yellow' | 'red' | 'gray' => {
    if (hasKinase === 0) return 'gray'
    if (kinaseRetained === 1) return 'green'
    if (kinaseRetained === 0) return 'red'
    return 'yellow'
  }

  const getConfidenceStatus = (confidence: string | undefined): 'green' | 'yellow' | 'red' | 'gray' => {
    if (confidence === 'high') return 'green'
    if (confidence === 'medium') return 'yellow'
    if (confidence === 'low') return 'red'
    return 'gray'
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-800">
          <tr>
            <th
              className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
              onClick={() => handleSort('name')}
            >
              Fusion Name <SortIcon field="name" />
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Breakpoints
            </th>
            <th
              className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
              onClick={() => handleSort('reads')}
            >
              Reads <SortIcon field="reads" />
            </th>
            <th
              className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
              onClick={() => handleSort('frame')}
            >
              In-Frame <SortIcon field="frame" />
            </th>
            <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Kinase
            </th>
            <th
              className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
              onClick={() => handleSort('confidence')}
            >
              Confidence <SortIcon field="confidence" />
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
          {sortedFusions.map((fusion) => (
            <tr key={fusion.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
              <td className="px-6 py-4 whitespace-nowrap">
                <span className="font-medium text-gray-900 dark:text-white">
                  {fusion.gene_a_symbol}
                </span>
                <span className="text-gray-500 dark:text-gray-400">--</span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {fusion.gene_b_symbol}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                <div>
                  chr{fusion.gene_a_chromosome}:{fusion.gene_a_breakpoint}
                </div>
                <div>
                  chr{fusion.gene_b_chromosome}:{fusion.gene_b_breakpoint}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                <div>J: {fusion.junction_reads ?? '-'}</div>
                <div>S: {fusion.spanning_reads ?? '-'}</div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-center">
                <IndicatorDot status={getFrameStatus(fusion.is_in_frame)} />
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-center">
                <IndicatorDot status={getKinaseStatus(fusion.has_kinase_domain, fusion.kinase_retained)} />
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-center">
                <IndicatorDot status={getConfidenceStatus(fusion.confidence)} />
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right">
                <Link
                  to={`/session/${sessionId}/fusion/${fusion.id}`}
                  className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 font-medium"
                >
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
