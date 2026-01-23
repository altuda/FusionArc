import { useRef, useEffect, useMemo } from 'react'
import * as d3 from 'd3'
import { VisualizationData, DomainInfo } from '../../api/client'
import { useTheme } from '../../context/ThemeContext'
import { DomainColorMap } from '../../utils/domainColors'
import { DomainFilters } from './ProteinSchematic'

interface FusionSchematicViewProps {
  data: VisualizationData
  domainColorMap?: DomainColorMap
  filters?: DomainFilters
}

export default function FusionSchematicView({ data, domainColorMap, filters }: FusionSchematicViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const { theme } = useTheme()

  const localColorMap = useMemo(() => {
    if (domainColorMap) return domainColorMap
    const map = new DomainColorMap()
    const allDomains = [...data.gene_a.domains, ...data.gene_b.domains]
    map.preloadFromDomains(allDomains)
    return map
  }, [data, domainColorMap])

  // Filter function for domain source filtering
  const shouldShowDomain = (domain: DomainInfo): boolean => {
    if (!filters?.sources || filters.sources.length === 0) return true
    return filters.sources.includes(domain.source)
  }

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return

    const container = containerRef.current
    const width = container.clientWidth
    const height = 320
    const margin = { top: 50, right: 100, bottom: 60, left: 50 }
    const innerWidth = width - margin.left - margin.right
    const domainHeight = 24
    const rowHeight = 80
    const geneGap = 40

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', width).attr('height', height)

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`)

    const textColor = theme === 'dark' ? '#F3F4F6' : '#1F2937'
    const lineColor = theme === 'dark' ? '#6B7280' : '#9CA3AF'

    const geneA = data.gene_a
    const geneB = data.gene_b

    // Get protein lengths - use max of protein_length or max domain end
    const proteinLengthA = Math.max(
      geneA.protein_length || 0,
      geneA.aa_breakpoint || 0,
      ...geneA.domains.map(d => d.end)
    ) || 500

    const proteinLengthB = Math.max(
      geneB.protein_length || 0,
      geneB.aa_breakpoint || 0,
      ...geneB.domains.map(d => d.end)
    ) || 500

    // Ensure breakpoints are within valid range
    const aaBreakpointA = Math.min(geneA.aa_breakpoint || 0, proteinLengthA)
    const aaBreakpointB = Math.min(geneB.aa_breakpoint || 0, proteinLengthB)

    // Use the maximum protein length for unified scale
    const maxProteinLength = Math.max(proteinLengthA, proteinLengthB)

    // Use breakpoint location from backend (e.g., "exon 31" or "intron 6")
    const breakpointLocationA = geneA.breakpoint_location || ''
    const breakpointLocationB = geneB.breakpoint_location || ''

    // Unified scale for both proteins
    const scale = d3.scaleLinear()
      .domain([0, maxProteinLength])
      .range([0, innerWidth])

    // Draw gene with thin line backbone and domains on top (matching Full Proteins design)
    const drawGene = (
      geneData: typeof geneA,
      yCenter: number,
      is5Prime: boolean,
      aaBreakpoint: number,
      proteinLength: number
    ): { breakpointX: number } => {

      const proteinEndX = scale(proteinLength)

      // Draw thin grey backbone line
      g.append('line')
        .attr('x1', 0)
        .attr('y1', yCenter)
        .attr('x2', proteinEndX)
        .attr('y2', yCenter)
        .attr('stroke', lineColor)
        .attr('stroke-width', 4)

      // Calculate retained and lost regions
      const retainedStart = is5Prime ? 0 : aaBreakpoint
      const retainedEnd = is5Prime ? aaBreakpoint : proteinLength
      const lostStart = is5Prime ? aaBreakpoint : 0
      const lostEnd = is5Prime ? proteinLength : aaBreakpoint

      // Draw all domains
      geneData.domains.forEach((domain) => {
        if (!shouldShowDomain(domain)) return

        const domainStartPos = scale(domain.start)
        const domainEndPos = scale(Math.min(domain.end, proteinLength))

        if (domainEndPos <= domainStartPos) return

        const color = domain.is_kinase ? '#EF4444' : localColorMap.getColor(domain.name)

        // Check if domain is in lost region
        const domainInLostRegion = (domain.start >= lostStart && domain.start < lostEnd) ||
                                   (domain.end > lostStart && domain.end <= lostEnd) ||
                                   (domain.start <= lostStart && domain.end >= lostEnd)

        // Check if domain is in retained region
        const domainInRetainedRegion = (domain.start >= retainedStart && domain.start < retainedEnd) ||
                                       (domain.end > retainedStart && domain.end <= retainedEnd) ||
                                       (domain.start <= retainedStart && domain.end >= retainedEnd)

        // Draw retained portion of domain
        if (domainInRetainedRegion && retainedEnd > retainedStart) {
          const clipStart = Math.max(domain.start, retainedStart)
          const clipEnd = Math.min(domain.end, retainedEnd)
          if (clipEnd > clipStart) {
            g.append('rect')
              .attr('x', scale(clipStart))
              .attr('y', yCenter - domainHeight / 2)
              .attr('width', scale(clipEnd) - scale(clipStart))
              .attr('height', domainHeight)
              .attr('fill', color)
              .attr('rx', 4)
              .attr('opacity', 0.85)
              .attr('stroke', domain.is_kinase ? '#991B1B' : 'none')
              .attr('stroke-width', domain.is_kinase ? 2 : 0)
          }
        }

        // Draw lost portion of domain (faded with dashed border)
        if (domainInLostRegion && lostEnd > lostStart) {
          const clipStart = Math.max(domain.start, lostStart)
          const clipEnd = Math.min(domain.end, lostEnd)
          if (clipEnd > clipStart) {
            g.append('rect')
              .attr('x', scale(clipStart))
              .attr('y', yCenter - domainHeight / 2)
              .attr('width', scale(clipEnd) - scale(clipStart))
              .attr('height', domainHeight)
              .attr('fill', color)
              .attr('rx', 4)
              .attr('opacity', 0.25)
              .attr('stroke', lineColor)
              .attr('stroke-width', 1)
              .attr('stroke-dasharray', '4,2')
          }
        }
      })

      // Draw breakpoint marker
      const bpX = scale(aaBreakpoint)
      g.append('line')
        .attr('x1', bpX)
        .attr('y1', yCenter - domainHeight - 8)
        .attr('x2', bpX)
        .attr('y2', yCenter + domainHeight + 8)
        .attr('stroke', '#EF4444')
        .attr('stroke-width', 2)

      // Arrow indicator showing what's retained
      const arrowDir = is5Prime ? -1 : 1
      g.append('polygon')
        .attr('points', `${bpX},${yCenter - domainHeight - 12} ${bpX + arrowDir * 8},${yCenter - domainHeight - 16} ${bpX + arrowDir * 8},${yCenter - domainHeight - 8}`)
        .attr('fill', '#EF4444')

      // Shade the lost region
      if (is5Prime && lostEnd > lostStart) {
        g.append('rect')
          .attr('x', bpX)
          .attr('y', yCenter - domainHeight / 2 - 2)
          .attr('width', proteinEndX - bpX)
          .attr('height', domainHeight + 4)
          .attr('fill', theme === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.08)')
          .attr('pointer-events', 'none')
      } else if (!is5Prime && lostEnd > lostStart) {
        g.append('rect')
          .attr('x', 0)
          .attr('y', yCenter - domainHeight / 2 - 2)
          .attr('width', bpX)
          .attr('height', domainHeight + 4)
          .attr('fill', theme === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.08)')
          .attr('pointer-events', 'none')
      }

      // Gene label
      g.append('text')
        .attr('x', proteinEndX + 15)
        .attr('y', yCenter + 5)
        .attr('fill', geneData.color)
        .attr('font-size', '14px')
        .attr('font-weight', 'bold')
        .text(geneData.symbol)

      return { breakpointX: bpX }
    }

    // Calculate Y positions
    const geneAY = rowHeight / 2
    const geneBY = rowHeight + geneGap + rowHeight / 2

    // Draw both genes
    const resultA = drawGene(geneA, geneAY, true, aaBreakpointA, proteinLengthA)
    const resultB = drawGene(geneB, geneBY, false, aaBreakpointB, proteinLengthB)

    // Breakpoint labels
    const bpXA = resultA.breakpointX
    const bpXB = resultB.breakpointX

    // Calculate retained AA counts
    const retainedAAa = aaBreakpointA
    const retainedAAb = Math.max(0, proteinLengthB - aaBreakpointB)

    // Gene A breakpoint label (below)
    g.append('line')
      .attr('x1', bpXA - 30)
      .attr('y1', geneAY + domainHeight + 15)
      .attr('x2', bpXA + 5)
      .attr('y2', geneAY + domainHeight + 15)
      .attr('stroke', textColor)
      .attr('stroke-width', 2)

    const exonLabelA = breakpointLocationA
      ? `${breakpointLocationA}, ${retainedAAa} AA`
      : `${retainedAAa} AA`
    g.append('text')
      .attr('x', bpXA - 12)
      .attr('y', geneAY + domainHeight + 32)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', '11px')
      .attr('font-weight', '500')
      .text(exonLabelA)

    // Gene B breakpoint label (above)
    g.append('line')
      .attr('x1', bpXB - 5)
      .attr('y1', geneBY - domainHeight - 15)
      .attr('x2', bpXB + 30)
      .attr('y2', geneBY - domainHeight - 15)
      .attr('stroke', textColor)
      .attr('stroke-width', 2)

    const exonLabelB = breakpointLocationB
      ? `${breakpointLocationB}, ${retainedAAb} AA`
      : `${retainedAAb} AA`
    g.append('text')
      .attr('x', bpXB + 12)
      .attr('y', geneBY - domainHeight - 25)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', '11px')
      .attr('font-weight', '500')
      .text(exonLabelB)

    // Connecting dashed line between breakpoints
    g.append('line')
      .attr('x1', bpXA)
      .attr('y1', geneAY + domainHeight + 15)
      .attr('x2', bpXB)
      .attr('y2', geneBY - domainHeight - 15)
      .attr('stroke', textColor)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '6,4')

    // Scale bar at bottom right
    const scaleBarLength = 100
    const scaleBarWidth = scale(scaleBarLength)
    const scaleBarY = geneBY + domainHeight + 45

    g.append('line')
      .attr('x1', innerWidth - scaleBarWidth)
      .attr('y1', scaleBarY)
      .attr('x2', innerWidth)
      .attr('y2', scaleBarY)
      .attr('stroke', textColor)
      .attr('stroke-width', 1.5)

    // Scale bar ticks
    g.append('line')
      .attr('x1', innerWidth - scaleBarWidth)
      .attr('y1', scaleBarY - 3)
      .attr('x2', innerWidth - scaleBarWidth)
      .attr('y2', scaleBarY + 3)
      .attr('stroke', textColor)
      .attr('stroke-width', 1.5)

    g.append('line')
      .attr('x1', innerWidth)
      .attr('y1', scaleBarY - 3)
      .attr('x2', innerWidth)
      .attr('y2', scaleBarY + 3)
      .attr('stroke', textColor)
      .attr('stroke-width', 1.5)

    g.append('text')
      .attr('x', innerWidth - scaleBarWidth / 2)
      .attr('y', scaleBarY + 15)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', '10px')
      .text(`${scaleBarLength} AA`)

  }, [data, theme, localColorMap, filters, shouldShowDomain])

  return (
    <div className="mt-4">
      <div ref={containerRef} className="relative">
        <svg ref={svgRef} className="w-full" />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-6 mt-4 text-sm text-gray-600 dark:text-gray-400">
        <div className="flex items-center gap-2">
          <div className="w-6 h-4 border-2 border-gray-600 dark:border-gray-300 rounded" />
          <span>Retained</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-4 border border-dashed border-gray-400 rounded bg-gray-100 dark:bg-gray-800 opacity-50" />
          <span>Lost</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 bg-red-500 rounded" />
          <span>Breakpoint</span>
        </div>
      </div>

      <p className="text-xs text-center text-gray-500 dark:text-gray-400 mt-3">
        <span className="font-medium" style={{ color: data.gene_a.color }}>{data.gene_a.symbol}</span> (5' partner) fused to{' '}
        <span className="font-medium" style={{ color: data.gene_b.color }}>{data.gene_b.symbol}</span> (3' partner)
        {data.is_in_frame !== undefined && (
          <span className="ml-2">— {data.is_in_frame ? 'In-frame' : 'Out-of-frame'}</span>
        )}
      </p>
    </div>
  )
}
