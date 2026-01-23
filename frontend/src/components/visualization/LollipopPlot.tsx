import { useRef, useEffect, useState, useMemo } from 'react'
import * as d3 from 'd3'
import { VisualizationData, MutationInfo, MutationType } from '../../api/client'
import { useTheme } from '../../context/ThemeContext'
import { DomainColorMap } from '../../utils/domainColors'

interface LollipopPlotProps {
  data: VisualizationData
  mutations: MutationInfo[]
  height?: number
  domainColorMap?: DomainColorMap  // Optional shared color map for consistency
}

// Color scheme for mutation types (matching ProteinPaint style)
const MUTATION_COLORS: Record<MutationType, string> = {
  missense: '#3B82F6',    // Blue
  nonsense: '#EF4444',    // Red
  frameshift: '#F97316',  // Orange
  silent: '#10B981',      // Green
  splice: '#8B5CF6',      // Purple
  inframe_indel: '#EC4899', // Pink
  other: '#6B7280',       // Gray
}

const MUTATION_LABELS: Record<MutationType, string> = {
  missense: 'Missense',
  nonsense: 'Nonsense',
  frameshift: 'Frameshift',
  silent: 'Silent',
  splice: 'Splice',
  inframe_indel: 'In-frame Indel',
  other: 'Other',
}

export default function LollipopPlot({ data, mutations, height = 300, domainColorMap }: LollipopPlotProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const { theme } = useTheme()
  const [tooltip, setTooltip] = useState<{
    visible: boolean
    x: number
    y: number
    mutation: MutationInfo | null
  }>({ visible: false, x: 0, y: 0, mutation: null })
  const [visibleTypes, setVisibleTypes] = useState<Set<MutationType>>(
    new Set(['missense', 'nonsense', 'frameshift', 'silent', 'splice', 'inframe_indel', 'other'])
  )

  // Create local color map if not provided, pre-populated with all domains
  const localColorMap = useMemo(() => {
    if (domainColorMap) return domainColorMap
    const map = new DomainColorMap()
    const allDomains = [...data.gene_a.domains, ...data.gene_b.domains]
    map.preloadFromDomains(allDomains)
    return map
  }, [data, domainColorMap])

  // Group mutations by position for stacking
  const groupedMutations = useMemo(() => {
    const groups: Record<number, MutationInfo[]> = {}
    mutations
      .filter(m => visibleTypes.has(m.type))
      .forEach(m => {
        if (!groups[m.position]) groups[m.position] = []
        groups[m.position].push(m)
      })
    return groups
  }, [mutations, visibleTypes])

  // Count by type for legend
  const typeCounts = useMemo(() => {
    const counts: Record<MutationType, number> = {
      missense: 0, nonsense: 0, frameshift: 0, silent: 0,
      splice: 0, inframe_indel: 0, other: 0
    }
    mutations.forEach(m => counts[m.type]++)
    return counts
  }, [mutations])

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return

    const container = containerRef.current
    const width = container.clientWidth
    const margin = { top: 100, right: 40, bottom: 80, left: 40 }
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', width).attr('height', height)

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`)

    const textColor = theme === 'dark' ? '#F3F4F6' : '#1F2937'
    const bgColor = theme === 'dark' ? '#374151' : '#F3F4F6'

    // Scale for protein positions
    const xScale = d3.scaleLinear()
      .domain([0, data.total_length])
      .range([0, innerWidth])

    // === Draw protein backbone with domains ===
    const proteinY = innerHeight - 20
    const domainHeight = 24

    // Protein backbone
    g.append('rect')
      .attr('x', 0)
      .attr('y', proteinY - domainHeight / 2)
      .attr('width', innerWidth)
      .attr('height', domainHeight)
      .attr('fill', bgColor)
      .attr('rx', 4)

    // Draw domains from both genes with consistent colors
    const allDomains = [
      ...data.gene_a.domains.map(d => ({ ...d, gene: 'A' })),
      ...data.gene_b.domains.map(d => ({
        ...d,
        gene: 'B',
        // Offset gene B domains
        start: d.start + data.junction_position - (data.gene_b.aa_breakpoint || 0),
        end: d.end + data.junction_position - (data.gene_b.aa_breakpoint || 0)
      }))
    ].filter(d => d.status !== 'lost')

    allDomains.forEach(domain => {
      const x1 = xScale(domain.start)
      const x2 = xScale(domain.end)
      const domainWidth = Math.max(x2 - x1, 3)
      // Use consistent domain colors from shared color map
      const color = domain.is_kinase ? '#EF4444' : localColorMap.getColor(domain.name)

      g.append('rect')
        .attr('x', x1)
        .attr('y', proteinY - domainHeight / 2)
        .attr('width', domainWidth)
        .attr('height', domainHeight)
        .attr('fill', color)
        .attr('fill-opacity', domain.status === 'truncated' ? 0.5 : 0.8)
        .attr('rx', 3)
    })

    // Junction marker
    const junctionX = xScale(data.junction_position)
    g.append('line')
      .attr('x1', junctionX)
      .attr('y1', proteinY - domainHeight - 5)
      .attr('x2', junctionX)
      .attr('y2', proteinY + domainHeight + 5)
      .attr('stroke', '#EF4444')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '4,2')

    // === Draw lollipops ===
    const lollipopRadius = 8

    Object.entries(groupedMutations).forEach(([posStr, muts]) => {
      const pos = parseInt(posStr)
      const x = xScale(pos)

      // Sort mutations by type for consistent stacking
      muts.sort((a, b) => {
        const order = ['nonsense', 'frameshift', 'missense', 'splice', 'inframe_indel', 'silent', 'other']
        return order.indexOf(a.type) - order.indexOf(b.type)
      })

      muts.forEach((mut, i) => {
        const y = proteinY - domainHeight - 15 - (i * (lollipopRadius * 2 + 4))
        const color = MUTATION_COLORS[mut.type]

        // Stem
        if (i === 0) {
          g.append('line')
            .attr('x1', x)
            .attr('y1', proteinY - domainHeight / 2)
            .attr('x2', x)
            .attr('y2', y)
            .attr('stroke', color)
            .attr('stroke-width', 1.5)
        }

        // Lollipop head
        const circle = g.append('circle')
          .attr('cx', x)
          .attr('cy', y)
          .attr('r', mut.count && mut.count > 1 ? lollipopRadius + Math.min(mut.count, 10) : lollipopRadius)
          .attr('fill', color)
          .attr('stroke', theme === 'dark' ? '#1F2937' : 'white')
          .attr('stroke-width', 2)
          .style('cursor', 'pointer')

        // Count label inside circle (for mutations with count > 1)
        if (mut.count && mut.count > 1) {
          g.append('text')
            .attr('x', x)
            .attr('y', y + 4)
            .attr('text-anchor', 'middle')
            .attr('fill', 'white')
            .attr('font-size', '10px')
            .attr('font-weight', 'bold')
            .attr('pointer-events', 'none')
            .text(mut.count > 99 ? '99+' : mut.count)
        }

        // Mutation label above
        if (muts.length <= 3 || i === muts.length - 1) {
          g.append('text')
            .attr('x', x)
            .attr('y', y - lollipopRadius - 5)
            .attr('text-anchor', 'middle')
            .attr('fill', color)
            .attr('font-size', '10px')
            .attr('font-weight', 'bold')
            .text(mut.label)
        }

        // Tooltip events
        circle.on('mouseenter', function(event) {
          d3.select(this).attr('r', (mut.count && mut.count > 1 ? lollipopRadius + Math.min(mut.count, 10) : lollipopRadius) + 2)
          const rect = (event.target as SVGCircleElement).getBoundingClientRect()
          const containerRect = container.getBoundingClientRect()
          setTooltip({
            visible: true,
            x: rect.left - containerRect.left + rect.width / 2,
            y: rect.top - containerRect.top - 10,
            mutation: mut
          })
        })
        circle.on('mouseleave', function() {
          d3.select(this).attr('r', mut.count && mut.count > 1 ? lollipopRadius + Math.min(mut.count, 10) : lollipopRadius)
          setTooltip(prev => ({ ...prev, visible: false }))
        })
      })
    })

    // === Axis ===
    const xAxis = d3.axisBottom(xScale).ticks(10)
    g.append('g')
      .attr('transform', `translate(0,${proteinY + domainHeight / 2 + 10})`)
      .call(xAxis)
      .selectAll('text')
      .attr('fill', textColor)
      .attr('font-size', '10px')

    g.append('text')
      .attr('x', innerWidth / 2)
      .attr('y', proteinY + domainHeight / 2 + 40)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', '11px')
      .text('Amino acid position')

    // === Title ===
    g.append('text')
      .attr('x', innerWidth / 2)
      .attr('y', -margin.top + 20)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', '14px')
      .attr('font-weight', 'bold')
      .text(`${data.fusion_name} - Mutation Lollipop Plot`)

  }, [data, groupedMutations, theme, height, localColorMap])

  const toggleType = (type: MutationType) => {
    setVisibleTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) {
        next.delete(type)
      } else {
        next.add(type)
      }
      return next
    })
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4">
      <div ref={containerRef} className="relative">
        <svg ref={svgRef} className="w-full" />

        {/* Tooltip */}
        {tooltip.visible && tooltip.mutation && (
          <div
            className="absolute z-10 bg-gray-900 text-white text-xs rounded-lg p-3 pointer-events-none transform -translate-x-1/2 -translate-y-full"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            <div className="font-bold text-sm">{tooltip.mutation.label}</div>
            <div className="mt-1 space-y-0.5">
              <div>Position: {tooltip.mutation.position}</div>
              <div>Type: {MUTATION_LABELS[tooltip.mutation.type]}</div>
              {tooltip.mutation.count && <div>Count: {tooltip.mutation.count}</div>}
              {tooltip.mutation.source && <div>Source: {tooltip.mutation.source}</div>}
              {tooltip.mutation.clinical_significance && (
                <div>Clinical: {tooltip.mutation.clinical_significance}</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-4 border-t border-gray-200 dark:border-gray-700 pt-4">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Mutation Types ({mutations.length} total)
        </div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(MUTATION_COLORS) as MutationType[]).map(type => (
            typeCounts[type] > 0 && (
              <button
                key={type}
                onClick={() => toggleType(type)}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-opacity ${
                  visibleTypes.has(type) ? 'opacity-100' : 'opacity-40'
                }`}
                style={{
                  backgroundColor: `${MUTATION_COLORS[type]}20`,
                  color: MUTATION_COLORS[type],
                  border: `1px solid ${MUTATION_COLORS[type]}`
                }}
              >
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: MUTATION_COLORS[type] }}
                />
                {MUTATION_LABELS[type]}
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white dark:bg-gray-800 text-[10px]">
                  {typeCounts[type]}
                </span>
              </button>
            )
          ))}
        </div>
      </div>
    </div>
  )
}

// Demo/sample mutations for testing
export function generateSampleMutations(proteinLength: number): MutationInfo[] {
  const types: MutationType[] = ['missense', 'nonsense', 'frameshift', 'silent', 'splice', 'inframe_indel']
  const aminoAcids = 'ACDEFGHIKLMNPQRSTVWY'.split('')

  const mutations: MutationInfo[] = []

  // Generate some random mutations for demo
  for (let i = 0; i < 30; i++) {
    const pos = Math.floor(Math.random() * proteinLength) + 1
    const refAA = aminoAcids[Math.floor(Math.random() * aminoAcids.length)]
    const altAA = aminoAcids[Math.floor(Math.random() * aminoAcids.length)]
    const type = types[Math.floor(Math.random() * types.length)]

    let label = `${refAA}${pos}${altAA}`
    if (type === 'frameshift') label = `${refAA}${pos}fs`
    if (type === 'nonsense') label = `${refAA}${pos}*`

    mutations.push({
      position: pos,
      ref_aa: refAA,
      alt_aa: altAA,
      type,
      label,
      count: Math.random() > 0.7 ? Math.floor(Math.random() * 20) + 2 : 1,
      source: ['COSMIC', 'ClinVar', 'GDC'][Math.floor(Math.random() * 3)]
    })
  }

  return mutations
}
