import { useRef, useEffect, useState, useMemo } from 'react'
import * as d3 from 'd3'
import { VisualizationData, MutationInfo, MutationType } from '../../api/client'
import { useTheme } from '../../context/ThemeContext'
import { DomainColorMap } from '../../utils/domainColors'
import { MUTATION_COLORS, MUTATION_LABELS } from '../../utils/mutationConstants'

interface LollipopPlotProps {
  data: VisualizationData
  mutations: MutationInfo[]
  height?: number
  domainColorMap?: DomainColorMap  // Optional shared color map for consistency
  onSvgReady?: (svg: string) => void
}

export default function LollipopPlot({ data, mutations, height = 400, domainColorMap, onSvgReady }: LollipopPlotProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const isSettingTransform = useRef(false)
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
  const [zoomDomain, setZoomDomain] = useState<[number, number] | null>(null)

  // Create local color map if not provided, pre-populated with all domains
  const localColorMap = useMemo(() => {
    if (domainColorMap) return domainColorMap
    const map = new DomainColorMap()
    const allDomains = [...data.gene_a.domains, ...data.gene_b.domains]
    map.preloadFromDomains(allDomains)
    return map
  }, [data, domainColorMap])

  // Filter mutations by visible types
  const filteredMutations = useMemo(() => {
    return mutations.filter(m => visibleTypes.has(m.type))
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

  const isZoomed = zoomDomain !== null

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return

    const container = containerRef.current
    const width = container.clientWidth
    const margin = { top: 40, right: 40, bottom: 100, left: 70 }
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', width).attr('height', height)

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`)

    const textColor = theme === 'dark' ? '#F3F4F6' : '#1F2937'
    const bgColor = theme === 'dark' ? '#374151' : '#F3F4F6'
    const gridColor = theme === 'dark' ? '#4B5563' : '#E5E7EB'

    // === Scales ===
    const xDomain: [number, number] = zoomDomain || [0, data.total_length]
    const xScale = d3.scaleLinear()
      .domain(xDomain)
      .range([0, innerWidth])

    // Y-axis: gnomAD allele frequency (linear scale 0-1, like ProteinPaint)
    const yScale = d3.scaleLinear()
      .domain([0, 1])
      .range([innerHeight - 40, 0])  // Leave room for protein backbone at bottom
      .clamp(true)

    // === Clip path for zoomed content ===
    svg.append('defs').append('clipPath')
      .attr('id', 'lollipop-clip')
      .append('rect')
      .attr('width', innerWidth)
      .attr('height', innerHeight + 20)
      .attr('x', 0)
      .attr('y', -10)

    // Zoom overlay rect — drawn first so lollipops render on top
    const zoomRect = g.append('rect')
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .style('cursor', isZoomed ? 'grab' : 'default')

    const clippedG = g.append('g')
      .attr('clip-path', 'url(#lollipop-clip)')

    // === Draw protein backbone with domains (at the bottom) ===
    const proteinY = innerHeight - 20
    const domainHeight = 24

    // Protein backbone
    clippedG.append('rect')
      .attr('x', xScale(xDomain[0]))
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
      const color = domain.is_kinase ? '#EF4444' : localColorMap.getColor(domain.name)

      clippedG.append('rect')
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
    clippedG.append('line')
      .attr('x1', junctionX)
      .attr('y1', 0)
      .attr('x2', junctionX)
      .attr('y2', innerHeight)
      .attr('stroke', '#EF4444')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '4,2')
      .attr('opacity', 0.6)

    // === Draw Y-axis grid lines ===
    const yAxisTicks = yScale.ticks(5)
    yAxisTicks.forEach(tick => {
      g.append('line')
        .attr('x1', 0)
        .attr('x2', innerWidth)
        .attr('y1', yScale(tick))
        .attr('y2', yScale(tick))
        .attr('stroke', gridColor)
        .attr('stroke-width', 0.5)
        .attr('stroke-dasharray', '2,2')
    })

    // === Draw lollipops with rotated labels (ProteinPaint style) ===
    const lollipopRadius = 5

    // Sort mutations by position for label collision detection
    const sortedMutations = [...filteredMutations]
      .filter(m => m.position >= xDomain[0] && m.position <= xDomain[1])
      .sort((a, b) => a.position - b.position)

    // Track placed label positions for collision detection
    // Each entry: { x, y } of the label anchor point
    const placedLabels: { x: number; y: number }[] = []
    const labelMinDist = 12 // Minimum pixel distance between label anchors

    sortedMutations.forEach((mut) => {
      const x = xScale(mut.position)
      // Use gnomAD AF for y-position, or place at y=0 if no AF
      const hasAF = mut.gnomad_af != null && mut.gnomad_af >= 0
      const y = hasAF ? yScale(mut.gnomad_af!) : yScale(0)
      const color = MUTATION_COLORS[mut.type]

      // Stem from backbone to lollipop
      clippedG.append('line')
        .attr('x1', x)
        .attr('y1', proteinY - domainHeight / 2)
        .attr('x2', x)
        .attr('y2', y)
        .attr('stroke', color)
        .attr('stroke-width', 1)
        .attr('opacity', 0.5)

      // Lollipop head
      const radius = lollipopRadius

      const circle = clippedG.append('circle')
        .attr('cx', x)
        .attr('cy', y)
        .attr('r', radius)
        .attr('fill', color)
        .attr('stroke', theme === 'dark' ? '#1F2937' : 'white')
        .attr('stroke-width', 1)
        .style('cursor', 'pointer')

      // Rotated label near the dot — only show if no collision
      const labelAngle = -60
      const labelOffset = radius + 3
      const labelX = x + labelOffset
      const labelY = y

      const hasCollision = placedLabels.some(p => {
        const dx = p.x - labelX
        const dy = p.y - labelY
        return Math.sqrt(dx * dx + dy * dy) < labelMinDist
      })

      if (!hasCollision) {
        clippedG.append('text')
          .attr('x', labelX)
          .attr('y', labelY)
          .attr('text-anchor', 'start')
          .attr('transform', `rotate(${labelAngle}, ${labelX}, ${labelY})`)
          .attr('fill', color)
          .attr('font-size', '8px')
          .attr('font-weight', '500')
          .attr('pointer-events', 'none')
          .text(mut.label)
        placedLabels.push({ x: labelX, y: labelY })
      }

      // Tooltip events (always active, even when label is hidden)
      circle.on('mouseenter', function(event) {
        d3.select(this).attr('r', radius + 2)
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
        d3.select(this).attr('r', radius)
        setTooltip(prev => ({ ...prev, visible: false }))
      })
    })

    // === Zoom & Pan (applied to background rect so lollipops stay interactive) ===
    const fullDomain: [number, number] = [0, data.total_length]
    const baseXScale = d3.scaleLinear().domain(fullDomain).range([0, innerWidth])
    const zoom = d3.zoom<SVGRectElement, unknown>()
      .scaleExtent([1, 50])
      .translateExtent([[0, 0], [innerWidth, innerHeight]])
      .extent([[0, 0], [innerWidth, innerHeight]])
      .on('zoom', (event) => {
        if (isSettingTransform.current) return
        const transform = event.transform
        const newXScale = transform.rescaleX(baseXScale.copy())
        const newDomain: [number, number] = [
          Math.max(fullDomain[0], Math.round(newXScale.domain()[0])),
          Math.min(fullDomain[1], Math.round(newXScale.domain()[1]))
        ]
        if (newDomain[1] - newDomain[0] >= 5) {
          if (transform.k <= 1.01) {
            setZoomDomain(null)
          } else {
            setZoomDomain(newDomain)
          }
        }
      });

    // Apply zoom to the background rect (not the SVG) so circles stay hoverable
    (zoomRect as unknown as d3.Selection<SVGRectElement, unknown, null, undefined>).call(zoom)

    // Restore transform to match current zoom domain (without triggering handler)
    if (zoomDomain) {
      const k = data.total_length / (zoomDomain[1] - zoomDomain[0])
      const tx = -zoomDomain[0] * (innerWidth / data.total_length) * k
      isSettingTransform.current = true;
      (zoomRect as unknown as d3.Selection<SVGRectElement, unknown, null, undefined>)
        .call(zoom.transform, d3.zoomIdentity.translate(tx, 0).scale(k))
      isSettingTransform.current = false
    }

    // Double-click to reset
    zoomRect.on('dblclick.zoom', () => {
      isSettingTransform.current = true;
      (zoomRect as unknown as d3.Selection<SVGRectElement, unknown, null, undefined>)
        .call(zoom.transform, d3.zoomIdentity)
      isSettingTransform.current = false
      setZoomDomain(null)
    })

    // === X-Axis (bottom, below backbone) ===
    const xAxis = d3.axisBottom(xScale).ticks(10)
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis)
      .selectAll('text')
      .attr('fill', textColor)
      .attr('font-size', '10px')

    g.append('text')
      .attr('x', innerWidth / 2)
      .attr('y', innerHeight + 35)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', '11px')
      .text('Amino acid position')

    // === Y-Axis (left, gnomAD_AF) - Linear scale 0-1 like ProteinPaint ===
    const yAxis = d3.axisLeft(yScale)
      .tickValues([0, 0.2, 0.4, 0.6, 0.8, 1.0])
      .tickFormat(d => d3.format('.1f')(d as number))

    g.append('g')
      .call(yAxis)
      .selectAll('text')
      .attr('fill', textColor)
      .attr('font-size', '9px')

    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -(innerHeight - 40) / 2)
      .attr('y', -55)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', '11px')
      .text('gnomAD_AF')

    // === Title ===
    g.append('text')
      .attr('x', innerWidth / 2)
      .attr('y', -15)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', '14px')
      .attr('font-weight', 'bold')
      .text(`${data.fusion_name} - Mutation Lollipop Plot`)

    // Notify parent of SVG content
    if (onSvgReady && svgRef.current) {
      const svgClone = svgRef.current.cloneNode(true) as SVGSVGElement
      const serializer = new XMLSerializer()
      onSvgReady(serializer.serializeToString(svgClone))
    }

  }, [data, filteredMutations, theme, height, localColorMap, onSvgReady, zoomDomain])

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
    <div className="relative">
      {/* Zoom controls */}
      {isZoomed && (
        <div className="absolute top-2 right-2 z-10 flex gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400 self-center">
            Viewing AA {zoomDomain![0]}–{zoomDomain![1]}
          </span>
          <button
            onClick={() => setZoomDomain(null)}
            className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-200 dark:hover:bg-gray-600 border border-gray-300 dark:border-gray-600"
          >
            Reset Zoom
          </button>
        </div>
      )}
      {!isZoomed && (
        <div className="absolute top-2 right-2 z-10">
          <span className="text-xs text-gray-400 dark:text-gray-500">
            Scroll to zoom, drag to pan
          </span>
        </div>
      )}

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
              {tooltip.mutation.gnomad_af != null && (
                <div>gnomAD_AF: {tooltip.mutation.gnomad_af >= 0.01
                  ? tooltip.mutation.gnomad_af.toFixed(6)
                  : tooltip.mutation.gnomad_af.toExponential(2)}</div>
              )}
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

// Demo/sample mutations for testing (without gnomAD AF - that comes from real API)
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
      source: ['COSMIC', 'ClinVar'][Math.floor(Math.random() * 2)]
      // gnomad_af comes from real API data, not generated
    })
  }

  return mutations
}
