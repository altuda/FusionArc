import { useRef, useEffect, useState, useMemo } from 'react'
import * as d3 from 'd3'
import { VisualizationData, MutationInfo, MutationType, ExonInfo } from '../../api/client'
import { useTheme } from '../../context/ThemeContext'
import { MUTATION_COLORS, MUTATION_LABELS } from '../../utils/mutationConstants'

interface DNALollipopPlotProps {
  data: VisualizationData
  mutationsA: MutationInfo[]
  mutationsB: MutationInfo[]
  height?: number
  onSvgReady?: (svg: string) => void
}

/**
 * Map exons to protein coordinates.
 * Returns array of { start, end, rank, is_coding, status } in amino acid positions.
 */
function mapExonsToProteinCoords(
  exons: ExonInfo[],
  strand: string | undefined,
  cdsStart: number | undefined,
  cdsEnd: number | undefined
): { start: number; end: number; rank: number; is_coding: boolean; status: string }[] {
  if (!exons.length || !cdsStart || !cdsEnd) return []

  // Sort exons by genomic position (ascending for +, descending for -)
  const sortedExons = [...exons].sort((a, b) =>
    strand === '-' ? b.start - a.start : a.start - b.start
  )

  const result: { start: number; end: number; rank: number; is_coding: boolean; status: string }[] = []
  let currentAA = 1 // Start at amino acid 1

  for (const exon of sortedExons) {
    // Calculate the coding portion of this exon
    const codingStart = Math.max(exon.start, cdsStart)
    const codingEnd = Math.min(exon.end, cdsEnd)

    if (codingStart <= codingEnd) {
      // This exon has coding sequence
      const codingLength = codingEnd - codingStart + 1
      const aaLength = Math.ceil(codingLength / 3)

      result.push({
        start: currentAA,
        end: currentAA + aaLength - 1,
        rank: exon.rank,
        is_coding: true,
        status: exon.status
      })

      currentAA += aaLength
    }
  }

  return result
}

interface GeneTrackProps {
  gene: 'A' | 'B'
  symbol: string
  exons: ExonInfo[]
  mutations: MutationInfo[]
  proteinLength: number
  aaBreakpoint?: number
  strand?: string
  cdsStart?: number
  cdsEnd?: number
  color: string
  is5Prime: boolean
  width: number
  height: number
  margin: { top: number; right: number; bottom: number; left: number }
  theme: 'light' | 'dark'
  visibleTypes: Set<MutationType>
  zoomDomain: [number, number] | null
  onZoom: (domain: [number, number] | null) => void
  onTooltip: (mutation: MutationInfo | null, x: number, y: number) => void
}

function GeneTrack({
  gene,
  symbol,
  exons,
  mutations,
  proteinLength,
  aaBreakpoint,
  strand,
  cdsStart,
  cdsEnd,
  color,
  is5Prime,
  width,
  height,
  margin,
  theme,
  visibleTypes,
  zoomDomain,
  onZoom,
  onTooltip,
}: GeneTrackProps) {
  const ref = useRef<SVGGElement>(null)
  const isSettingTransform = useRef(false)

  useEffect(() => {
    if (!ref.current) return

    const g = d3.select(ref.current)
    g.selectAll('*').remove()

    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    const textColor = theme === 'dark' ? '#F3F4F6' : '#1F2937'
    const bgColor = theme === 'dark' ? '#4B5563' : '#E5E7EB'
    const gridColor = theme === 'dark' ? '#374151' : '#F3F4F6'
    const lostColor = theme === 'dark' ? '#1F2937' : '#D1D5DB'

    // X-axis: protein position (amino acid)
    const xDomain: [number, number] = zoomDomain || [0, proteinLength]
    const xScale = d3.scaleLinear()
      .domain(xDomain)
      .range([0, innerWidth])

    // Clip path for this track
    const clipId = `dna-clip-${gene}`
    const defs = g.append('defs')
    defs.append('clipPath')
      .attr('id', clipId)
      .append('rect')
      .attr('width', innerWidth)
      .attr('height', innerHeight + 20)
      .attr('x', 0)
      .attr('y', -10)

    // Zoom overlay rect — drawn first so lollipops render on top and stay hoverable
    const zoomRect = g.append('rect')
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .style('cursor', zoomDomain ? 'grab' : 'default')

    const clippedG = g.append('g')
      .attr('clip-path', `url(#${clipId})`)

    // Calculate dynamic Y-axis max based on actual AF values in data
    const afValues = mutations
      .filter(m => typeof m.gnomad_af === 'number' && !isNaN(m.gnomad_af) && m.gnomad_af > 0)
      .map(m => m.gnomad_af!)
    const maxAF = afValues.length > 0 ? Math.max(...afValues) : 0.1
    // Round up to a nice number and add 10% padding
    const yMax = Math.min(1, Math.max(0.1, Math.ceil(maxAF * 10) / 10 + 0.05))

    // Y-axis: gnomAD_AF using linear scale
    const yScale = d3.scaleLinear()
      .domain([0, yMax])
      .range([innerHeight - 50, 10])
      .clamp(true)

    // Generate tick values for linear scale
    const yAxisTicks = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0].filter(t => t <= yMax)
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

    // === Draw transcript backbone with exons ===
    const backboneY = innerHeight - 25
    const exonHeight = 24
    const transcriptHeight = 8

    // Map exons to protein coordinates
    const proteinExons = mapExonsToProteinCoords(exons, strand, cdsStart, cdsEnd)

    // Draw transcript backbone (thin line)
    clippedG.append('rect')
      .attr('x', 0)
      .attr('y', backboneY - transcriptHeight / 2)
      .attr('width', innerWidth)
      .attr('height', transcriptHeight)
      .attr('fill', bgColor)
      .attr('rx', 2)

    // Draw exons as colored blocks on the transcript
    proteinExons.forEach((exon) => {
      const x1 = xScale(exon.start)
      const x2 = xScale(exon.end)
      const exonWidth = Math.max(x2 - x1, 4)

      // Determine if exon is in retained or lost region
      let isRetained = true
      if (aaBreakpoint) {
        if (is5Prime) {
          // 5' gene: retained if exon is before breakpoint
          isRetained = exon.end <= aaBreakpoint
        } else {
          // 3' gene: retained if exon is after breakpoint
          isRetained = exon.start >= aaBreakpoint
        }
      }

      // Draw exon block
      clippedG.append('rect')
        .attr('x', x1)
        .attr('y', backboneY - exonHeight / 2)
        .attr('width', exonWidth)
        .attr('height', exonHeight)
        .attr('fill', isRetained ? color : lostColor)
        .attr('fill-opacity', isRetained ? 0.8 : 0.4)
        .attr('stroke', isRetained ? color : lostColor)
        .attr('stroke-width', 1)
        .attr('rx', 2)

      // Add exon number label for wider exons
      if (exonWidth > 25) {
        clippedG.append('text')
          .attr('x', x1 + exonWidth / 2)
          .attr('y', backboneY + 4)
          .attr('text-anchor', 'middle')
          .attr('fill', isRetained ? 'white' : textColor)
          .attr('font-size', '9px')
          .attr('font-weight', '500')
          .attr('pointer-events', 'none')
          .text(exon.rank)
      }
    })

    // === Draw breakpoint line ===
    if (aaBreakpoint && aaBreakpoint > 0 && aaBreakpoint < proteinLength) {
      const bpX = xScale(aaBreakpoint)

      // Vertical dashed line
      clippedG.append('line')
        .attr('x1', bpX)
        .attr('x2', bpX)
        .attr('y1', 0)
        .attr('y2', innerHeight)
        .attr('stroke', '#EF4444')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '4,2')
        .attr('opacity', 0.8)

      // "Breakpoint" label
      clippedG.append('text')
        .attr('x', bpX)
        .attr('y', innerHeight + 5)
        .attr('text-anchor', 'middle')
        .attr('fill', '#EF4444')
        .attr('font-size', '9px')
        .attr('font-weight', 'bold')
        .text('Breakpoint')

      // Draw "lost" region overlay
      const lostStart = is5Prime ? bpX : 0
      const lostEnd = is5Prime ? innerWidth : bpX

      clippedG.append('rect')
        .attr('x', lostStart)
        .attr('y', 0)
        .attr('width', lostEnd - lostStart)
        .attr('height', innerHeight - 35)
        .attr('fill', theme === 'dark' ? '#1F2937' : '#F9FAFB')
        .attr('opacity', 0.5)
        .attr('pointer-events', 'none')
    }

    // === Draw lollipops for mutations ===
    const filteredMutations = mutations.filter(m => visibleTypes.has(m.type))
    const lollipopRadius = 5

    // Sort by position, filter to visible range
    const sortedMutations = [...filteredMutations]
      .filter(m => m.position >= xDomain[0] && m.position <= xDomain[1])
      .sort((a, b) => a.position - b.position)

    // Track placed label positions for collision detection
    const placedLabels: { x: number; y: number }[] = []
    const labelMinDist = 12

    sortedMutations.forEach((mut) => {
      const x = xScale(mut.position)
      // Safely get gnomAD AF - handle null, undefined, and NaN
      const af = (typeof mut.gnomad_af === 'number' && !isNaN(mut.gnomad_af)) ? mut.gnomad_af : 0
      const y = yScale(af)
      const mutColor = MUTATION_COLORS[mut.type]

      // Check if mutation is in retained region
      let isRetained = true
      if (aaBreakpoint) {
        if (is5Prime) {
          isRetained = mut.position <= aaBreakpoint
        } else {
          isRetained = mut.position >= aaBreakpoint
        }
      }

      if (!isRetained) return // Don't draw lost mutations

      // Stem from backbone to lollipop
      clippedG.append('line')
        .attr('x1', x)
        .attr('y1', backboneY - exonHeight / 2)
        .attr('x2', x)
        .attr('y2', y)
        .attr('stroke', mutColor)
        .attr('stroke-width', 1)
        .attr('opacity', 0.6)

      // Lollipop head
      const circle = clippedG.append('circle')
        .attr('cx', x)
        .attr('cy', y)
        .attr('r', lollipopRadius)
        .attr('fill', mutColor)
        .attr('stroke', theme === 'dark' ? '#1F2937' : 'white')
        .attr('stroke-width', 1.5)
        .style('cursor', 'pointer')

      // Rotated label — only show if no collision with existing labels
      const labelAngle = -45
      const labelOffset = lollipopRadius + 2
      const labelX = x
      const labelY = y - labelOffset

      // Use protein change label, or hgvsc for intronic variants
      let labelText = mut.label
      if (mut.type === 'other' && mut.hgvsc) {
        labelText = mut.hgvsc.includes(':') ? mut.hgvsc.split(':').pop()! : mut.hgvsc
      }
      if (labelText.length > 12) {
        labelText = labelText.substring(0, 12) + '...'
      }

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
          .attr('fill', mutColor)
          .attr('font-size', '8px')
          .attr('font-weight', '500')
          .attr('pointer-events', 'none')
          .text(labelText)
        placedLabels.push({ x: labelX, y: labelY })
      }

      // Tooltip events
      circle.on('mouseenter', function(event) {
        d3.select(this).attr('r', lollipopRadius + 2)
        const rect = (event.target as SVGCircleElement).getBoundingClientRect()
        onTooltip(mut, rect.left + rect.width / 2, rect.top - 10)
      })
      circle.on('mouseleave', function() {
        d3.select(this).attr('r', lollipopRadius)
        onTooltip(null, 0, 0)
      })
    })

    // === Zoom & Pan ===
    const fullDomain: [number, number] = [0, proteinLength]
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
            onZoom(null)
          } else {
            onZoom(newDomain)
          }
        }
      });

    (zoomRect as unknown as d3.Selection<SVGRectElement, unknown, null, undefined>).call(zoom)

    // Restore transform to match current zoom domain
    if (zoomDomain) {
      const k = proteinLength / (zoomDomain[1] - zoomDomain[0])
      const tx = -zoomDomain[0] * (innerWidth / proteinLength) * k
      isSettingTransform.current = true;
      (zoomRect as unknown as d3.Selection<SVGRectElement, unknown, null, undefined>)
        .call(zoom.transform, d3.zoomIdentity.translate(tx, 0).scale(k))
      isSettingTransform.current = false
    }

    // Double-click to reset zoom
    zoomRect.on('dblclick.zoom', () => {
      isSettingTransform.current = true;
      (zoomRect as unknown as d3.Selection<SVGRectElement, unknown, null, undefined>)
        .call(zoom.transform, d3.zoomIdentity)
      isSettingTransform.current = false
      onZoom(null)
    })

    // === Draw axes ===
    // X-axis (protein position)
    const xAxis = d3.axisBottom(xScale)
      .ticks(10)
      .tickFormat(d => `${d}`)

    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis)
      .selectAll('text')
      .attr('fill', textColor)
      .attr('font-size', '9px')

    // X-axis label
    g.append('text')
      .attr('x', innerWidth / 2)
      .attr('y', innerHeight + 30)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', '10px')
      .text('Amino acid position')

    // Y-axis (gnomAD_AF) - linear scale
    const yAxis = d3.axisLeft(yScale)
      .tickValues(yAxisTicks)
      .tickFormat(d => d3.format('.1f')(d as number))

    g.append('g')
      .call(yAxis)
      .selectAll('text')
      .attr('fill', textColor)
      .attr('font-size', '9px')

    // Y-axis label
    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -(innerHeight - 50) / 2)
      .attr('y', -45)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', '10px')
      .text('gnomAD AF')

    // Gene title with transcript info
    g.append('text')
      .attr('x', innerWidth / 2)
      .attr('y', -8)
      .attr('text-anchor', 'middle')
      .attr('fill', color)
      .attr('font-size', '13px')
      .attr('font-weight', 'bold')
      .text(`${symbol} (${is5Prime ? "5' partner" : "3' partner"})`)

    // Variant count subtitle
    const retainedCount = filteredMutations.filter(m => {
      if (!aaBreakpoint) return true
      return is5Prime ? m.position <= aaBreakpoint : m.position >= aaBreakpoint
    }).length

    g.append('text')
      .attr('x', innerWidth / 2)
      .attr('y', -8 + 12)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', '10px')
      .attr('opacity', 0.7)
      .text(`${retainedCount} variants`)

  }, [gene, symbol, exons, mutations, proteinLength, aaBreakpoint, strand, cdsStart, cdsEnd, color, is5Prime, width, height, margin, theme, visibleTypes, zoomDomain, onZoom, onTooltip])

  return <g ref={ref} transform={`translate(${margin.left},${margin.top})`} />
}

export default function DNALollipopPlot({
  data,
  mutationsA,
  mutationsB,
  height = 650,
  onSvgReady
}: DNALollipopPlotProps) {
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
  const [zoomDomainA, setZoomDomainA] = useState<[number, number] | null>(null)
  const [zoomDomainB, setZoomDomainB] = useState<[number, number] | null>(null)

  // Count mutations by type (combining both genes)
  const typeCounts = useMemo(() => {
    const counts: Record<MutationType, number> = {
      missense: 0, nonsense: 0, frameshift: 0, silent: 0,
      splice: 0, inframe_indel: 0, other: 0
    }
    ;[...mutationsA, ...mutationsB].forEach(m => counts[m.type]++)
    return counts
  }, [mutationsA, mutationsB])

  const handleTooltip = (mutation: MutationInfo | null, x: number, y: number) => {
    if (!containerRef.current) return
    if (mutation) {
      const containerRect = containerRef.current.getBoundingClientRect()
      setTooltip({
        visible: true,
        x: x - containerRect.left,
        y: y - containerRect.top,
        mutation
      })
    } else {
      setTooltip(prev => ({ ...prev, visible: false }))
    }
  }

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

  const [width, setWidth] = useState(800)

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width)
      }
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (onSvgReady && svgRef.current) {
      const svgClone = svgRef.current.cloneNode(true) as SVGSVGElement
      const serializer = new XMLSerializer()
      onSvgReady(serializer.serializeToString(svgClone))
    }
  }, [data, mutationsA, mutationsB, visibleTypes, theme, width, onSvgReady])

  const margin = { top: 35, right: 40, bottom: 45, left: 60 }
  const trackHeight = (height - 40) / 2  // Split height between two tracks

  const textColor = theme === 'dark' ? '#F3F4F6' : '#1F2937'
  const isZoomedA = zoomDomainA !== null
  const isZoomedB = zoomDomainB !== null
  const isZoomed = isZoomedA || isZoomedB

  return (
    <div className="relative">
      {/* Zoom controls */}
      <div className="absolute top-2 right-2 z-10 flex gap-2 items-center">
        {!isZoomed && (
          <span className="text-xs text-gray-400 dark:text-gray-500">
            Scroll to zoom, drag to pan
          </span>
        )}
        {isZoomedA && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {data.gene_a.symbol}: AA {zoomDomainA![0]}–{zoomDomainA![1]}
          </span>
        )}
        {isZoomedB && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {data.gene_b.symbol}: AA {zoomDomainB![0]}–{zoomDomainB![1]}
          </span>
        )}
        {isZoomed && (
          <button
            onClick={() => { setZoomDomainA(null); setZoomDomainB(null) }}
            className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-200 dark:hover:bg-gray-600 border border-gray-300 dark:border-gray-600"
          >
            Reset Zoom
          </button>
        )}
      </div>

      <div ref={containerRef} className="relative">
        <svg ref={svgRef} width={width} height={height}>
          {/* Title */}
          <text
            x={width / 2}
            y={18}
            textAnchor="middle"
            fill={textColor}
            fontSize="14px"
            fontWeight="bold"
          >
            {data.fusion_name} - Transcript View with Mutations
          </text>

          {/* Gene A Track (top) */}
          <g transform={`translate(0, 25)`}>
            <GeneTrack
              gene="A"
              symbol={data.gene_a.symbol}
              exons={data.gene_a.exons}
              mutations={mutationsA}
              proteinLength={data.gene_a.protein_length || 500}
              aaBreakpoint={data.gene_a.aa_breakpoint}
              strand={data.gene_a.strand}
              cdsStart={data.gene_a.cds_start}
              cdsEnd={data.gene_a.cds_end}
              color={data.gene_a.color}
              is5Prime={true}
              width={width}
              height={trackHeight}
              margin={margin}
              theme={theme}
              visibleTypes={visibleTypes}
              zoomDomain={zoomDomainA}
              onZoom={setZoomDomainA}
              onTooltip={handleTooltip}
            />
          </g>

          {/* Gene B Track (bottom) */}
          <g transform={`translate(0, ${25 + trackHeight})`}>
            <GeneTrack
              gene="B"
              symbol={data.gene_b.symbol}
              exons={data.gene_b.exons}
              mutations={mutationsB}
              proteinLength={data.gene_b.protein_length || 500}
              aaBreakpoint={data.gene_b.aa_breakpoint}
              strand={data.gene_b.strand}
              cdsStart={data.gene_b.cds_start}
              cdsEnd={data.gene_b.cds_end}
              color={data.gene_b.color}
              is5Prime={false}
              width={width}
              height={trackHeight}
              margin={margin}
              theme={theme}
              visibleTypes={visibleTypes}
              zoomDomain={zoomDomainB}
              onZoom={setZoomDomainB}
              onTooltip={handleTooltip}
            />
          </g>
        </svg>

        {/* Tooltip */}
        {tooltip.visible && tooltip.mutation && (
          <div
            className="absolute z-10 bg-gray-900 text-white text-xs rounded-lg p-3 pointer-events-none transform -translate-x-1/2 -translate-y-full"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            <div className="font-bold text-sm">{tooltip.mutation.label}</div>
            <div className="mt-1 space-y-0.5">
              <div>AA Position: {tooltip.mutation.position}</div>
              {tooltip.mutation.genomic_pos && (
                <div>Genomic: chr{tooltip.mutation.genomic_pos.toLocaleString()}</div>
              )}
              {tooltip.mutation.hgvsc && (
                <div>cDNA: {tooltip.mutation.hgvsc}</div>
              )}
              <div>Type: {MUTATION_LABELS[tooltip.mutation.type]}</div>
              {tooltip.mutation.consequence && (
                <div>Effect: {tooltip.mutation.consequence.replace(/_/g, ' ')}</div>
              )}
              {tooltip.mutation.gnomad_af != null && (
                <div>gnomAD AF: {tooltip.mutation.gnomad_af >= 0.001
                  ? tooltip.mutation.gnomad_af.toFixed(4)
                  : tooltip.mutation.gnomad_af.toExponential(2)}</div>
              )}
              {tooltip.mutation.count && tooltip.mutation.count > 1 && (
                <div>Count: {tooltip.mutation.count}</div>
              )}
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
          Mutation Types ({mutationsA.length + mutationsB.length} total)
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
