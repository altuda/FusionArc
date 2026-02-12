import { useRef, useEffect, useMemo, useState } from 'react'
import * as d3 from 'd3'
import { VisualizationData } from '../../api/client'
import { useTheme } from '../../context/ThemeContext'
import { DomainColorMap } from '../../utils/domainColors'
import { shouldShowDomain as shouldShowDomainFilter } from '../../utils/domainFilters'
import { getDatabaseUrl } from '../../utils/databaseUrl'
import { inferFeatureType } from '../../utils/featureType'
import { TYPE_COLORS, SOURCE_COLORS } from '../../utils/colorConstants'
import { DomainFilters } from './ProteinSchematic'

interface FusionSchematicViewProps {
  data: VisualizationData
  domainColorMap?: DomainColorMap
  filters?: DomainFilters
  onSvgReady?: (svg: string) => void
  showStrandOrientation?: boolean
}

export default function FusionSchematicView({ data, domainColorMap, filters, onSvgReady, showStrandOrientation = false }: FusionSchematicViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const { theme } = useTheme()
  const [hoveredDomain, setHoveredDomain] = useState<string | null>(null)
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [containerWidth, setContainerWidth] = useState(0)

  const localColorMap = useMemo(() => {
    if (domainColorMap) return domainColorMap
    const map = new DomainColorMap()
    const allDomains = [...data.gene_a.domains, ...data.gene_b.domains]
    map.preloadFromDomains(allDomains)
    return map
  }, [data, domainColorMap])

  const shouldShowDomain = (domain: { source: string; data_provider?: string }): boolean => {
    return shouldShowDomainFilter(domain, filters)
  }

  const getDomainColor = (name: string, source: string, isKinase: boolean): string => {
    const colorMode = filters?.colorMode || 'domain'
    if (colorMode === 'domain') {
      if (isKinase) return '#EF4444'
      return localColorMap.getColor(name)
    }
    if (colorMode === 'type') {
      if (isKinase) return TYPE_COLORS['kinase']
      const featureType = inferFeatureType(name, source)
      return TYPE_COLORS[featureType] || TYPE_COLORS['default']
    }
    return SOURCE_COLORS[source] || SOURCE_COLORS['default']
  }

  // Track container width for resize handling
  useEffect(() => {
    if (!containerRef.current) return

    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth)
      }
    }

    // Initial width
    updateWidth()

    // Update on resize
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [])

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || containerWidth === 0) return

    const container = containerRef.current
    const width = containerWidth
    const height = 380
    const margin = { top: 50, right: 100, bottom: 60, left: 50 }
    const innerWidth = width - margin.left - margin.right
    const domainHeight = 24
    const rowHeight = 80
    const geneGap = 40

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`)

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)
    const textColor = theme === 'dark' ? '#F3F4F6' : '#1F2937'
    const lineColor = theme === 'dark' ? '#6B7280' : '#9CA3AF'

    const geneA = data.gene_a
    const geneB = data.gene_b

    // Debug: log the data to understand what we're receiving
    console.log('FusionSchematicView data:', {
      geneA: {
        symbol: geneA.symbol,
        aa_breakpoint: geneA.aa_breakpoint,
        protein_length: geneA.protein_length,
        domain_count: geneA.domains.length,
        max_domain_end: geneA.domains.length > 0 ? Math.max(...geneA.domains.map(d => d.end)) : 0,
        domains: geneA.domains.map(d => ({ name: d.name, start: d.start, end: d.end }))
      },
      geneB: {
        symbol: geneB.symbol,
        aa_breakpoint: geneB.aa_breakpoint,
        protein_length: geneB.protein_length,
        domain_count: geneB.domains.length,
        max_domain_end: geneB.domains.length > 0 ? Math.max(...geneB.domains.map(d => d.end)) : 0,
        domains: geneB.domains.map(d => ({ name: d.name, start: d.start, end: d.end }))
      }
    })

    // Backend now sends protein_length as FULL protein length (max of domain ends and breakpoint)
    // Use Math.max with local calculations as a safety fallback
    const maxDomainEndA = geneA.domains.length > 0 ? Math.max(...geneA.domains.map(d => d.end)) : 0
    const maxDomainEndB = geneB.domains.length > 0 ? Math.max(...geneB.domains.map(d => d.end)) : 0

    // Full protein length: max of backend value, domain ends, and breakpoint position
    const proteinLengthA = Math.max(geneA.protein_length || 0, maxDomainEndA, geneA.aa_breakpoint || 0) || 500
    const proteinLengthB = Math.max(geneB.protein_length || 0, maxDomainEndB, geneB.aa_breakpoint || 0) || 500

    const aaBreakpointA = geneA.aa_breakpoint || 0
    const aaBreakpointB = geneB.aa_breakpoint || 0
    const maxProteinLength = Math.max(proteinLengthA, proteinLengthB)
    const breakpointLocationA = geneA.breakpoint_location || ''
    const breakpointLocationB = geneB.breakpoint_location || ''

    const scale = d3.scaleLinear().domain([0, maxProteinLength]).range([0, innerWidth])

    const drawGene = (
      geneData: typeof geneA, yCenter: number, is5Prime: boolean, aaBreakpoint: number, proteinLength: number
    ): { breakpointX: number } => {
      const proteinEndX = scale(proteinLength)

      // Backbone
      g.append('line').attr('x1', 0).attr('y1', yCenter).attr('x2', proteinEndX).attr('y2', yCenter).attr('stroke', lineColor).attr('stroke-width', 4)

      const retainedStart = is5Prime ? 0 : aaBreakpoint
      const retainedEnd = is5Prime ? aaBreakpoint : proteinLength
      const lostStart = is5Prime ? aaBreakpoint : 0
      const lostEnd = is5Prime ? proteinLength : aaBreakpoint

      geneData.domains.forEach((domain) => {
        if (!shouldShowDomain(domain)) return

        const domainStartPos = scale(domain.start)
        const domainEndPos = scale(Math.min(domain.end, proteinLength))
        if (domainEndPos <= domainStartPos) return

        const color = getDomainColor(domain.name, domain.source, domain.is_kinase)
        const dbUrl = getDatabaseUrl(domain.source, domain.accession)

        const domainInLostRegion = (domain.start >= lostStart && domain.start < lostEnd) ||
                                   (domain.end > lostStart && domain.end <= lostEnd) ||
                                   (domain.start <= lostStart && domain.end >= lostEnd)

        const domainInRetainedRegion = (domain.start >= retainedStart && domain.start < retainedEnd) ||
                                       (domain.end > retainedStart && domain.end <= retainedEnd) ||
                                       (domain.start <= retainedStart && domain.end >= retainedEnd)

        // Retained portion
        if (domainInRetainedRegion && retainedEnd > retainedStart) {
          const clipStart = Math.max(domain.start, retainedStart)
          const clipEnd = Math.min(domain.end, retainedEnd)
          if (clipEnd > clipStart) {
            g.append('rect')
              .attr('x', scale(clipStart)).attr('y', yCenter - domainHeight / 2)
              .attr('width', scale(clipEnd) - scale(clipStart)).attr('height', domainHeight)
              .attr('fill', color).attr('rx', 4).attr('opacity', 0.85)
              .attr('stroke', domain.is_kinase ? '#991B1B' : 'none')
              .attr('stroke-width', domain.is_kinase ? 2 : 0)
              .style('cursor', dbUrl ? 'pointer' : 'default')
              .on('mouseenter', function() { d3.select(this).attr('opacity', 1); setHoveredDomain(domain.name) })
              .on('mousemove', function(event) {
                const cr = container.getBoundingClientRect()
                setMousePos({ x: event.clientX - cr.left, y: event.clientY - cr.top })
              })
              .on('mouseleave', function() { d3.select(this).attr('opacity', 0.85); setHoveredDomain(null) })
              .on('click', function() { if (dbUrl) window.open(dbUrl, '_blank', 'noopener,noreferrer') })
          }
        }

        // Lost portion
        if (domainInLostRegion && lostEnd > lostStart) {
          const clipStart = Math.max(domain.start, lostStart)
          const clipEnd = Math.min(domain.end, lostEnd)
          if (clipEnd > clipStart) {
            g.append('rect')
              .attr('x', scale(clipStart)).attr('y', yCenter - domainHeight / 2)
              .attr('width', scale(clipEnd) - scale(clipStart)).attr('height', domainHeight)
              .attr('fill', color).attr('rx', 4).attr('opacity', 0.25)
              .attr('stroke', lineColor).attr('stroke-width', 1).attr('stroke-dasharray', '4,2')
              .style('cursor', dbUrl ? 'pointer' : 'default')
              .on('mouseenter', function() { d3.select(this).attr('opacity', 0.5); setHoveredDomain(domain.name) })
              .on('mousemove', function(event) {
                const cr = container.getBoundingClientRect()
                setMousePos({ x: event.clientX - cr.left, y: event.clientY - cr.top })
              })
              .on('mouseleave', function() { d3.select(this).attr('opacity', 0.25); setHoveredDomain(null) })
              .on('click', function() { if (dbUrl) window.open(dbUrl, '_blank', 'noopener,noreferrer') })
          }
        }
      })

      // Breakpoint marker
      const bpX = scale(aaBreakpoint)
      g.append('line').attr('x1', bpX).attr('y1', yCenter - domainHeight - 8).attr('x2', bpX).attr('y2', yCenter + domainHeight + 8).attr('stroke', '#EF4444').attr('stroke-width', 2)
      const arrowDir = is5Prime ? -1 : 1
      g.append('polygon').attr('points', `${bpX},${yCenter - domainHeight - 12} ${bpX + arrowDir * 8},${yCenter - domainHeight - 16} ${bpX + arrowDir * 8},${yCenter - domainHeight - 8}`).attr('fill', '#EF4444')

      // Shade lost region
      if (is5Prime && lostEnd > lostStart) {
        g.append('rect').attr('x', bpX).attr('y', yCenter - domainHeight / 2 - 2).attr('width', proteinEndX - bpX).attr('height', domainHeight + 4).attr('fill', theme === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.08)').attr('pointer-events', 'none')
      } else if (!is5Prime && lostEnd > lostStart) {
        g.append('rect').attr('x', 0).attr('y', yCenter - domainHeight / 2 - 2).attr('width', bpX).attr('height', domainHeight + 4).attr('fill', theme === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.08)').attr('pointer-events', 'none')
      }

      // Gene label with optional strand orientation
      const strandSuffix = showStrandOrientation && geneData.strand ? ` (${geneData.strand})` : ''
      g.append('text').attr('x', proteinEndX + 15).attr('y', yCenter + 5).attr('fill', geneData.color).attr('font-size', '14px').attr('font-weight', 'bold').text(geneData.symbol + strandSuffix)

      return { breakpointX: bpX }
    }

    const geneAY = rowHeight / 2
    const geneBY = rowHeight + geneGap + rowHeight / 2

    const resultA = drawGene(geneA, geneAY, true, aaBreakpointA, proteinLengthA)
    const resultB = drawGene(geneB, geneBY, false, aaBreakpointB, proteinLengthB)

    const bpXA = resultA.breakpointX
    const bpXB = resultB.breakpointX
    // Show breakpoint position (AA from N-terminus) for both genes
    // This matches ProteinPaint's display convention
    const retainedAAa = aaBreakpointA
    const retainedAAb = aaBreakpointB

    // Breakpoint labels
    g.append('line').attr('x1', bpXA - 30).attr('y1', geneAY + domainHeight + 15).attr('x2', bpXA + 5).attr('y2', geneAY + domainHeight + 15).attr('stroke', textColor).attr('stroke-width', 2)
    const exonLabelA = breakpointLocationA ? `${breakpointLocationA}, ${retainedAAa} AA` : `${retainedAAa} AA`
    g.append('text').attr('x', bpXA - 12).attr('y', geneAY + domainHeight + 32).attr('text-anchor', 'middle').attr('fill', textColor).attr('font-size', '11px').attr('font-weight', '500').text(exonLabelA)

    g.append('line').attr('x1', bpXB - 5).attr('y1', geneBY - domainHeight - 15).attr('x2', bpXB + 30).attr('y2', geneBY - domainHeight - 15).attr('stroke', textColor).attr('stroke-width', 2)
    const exonLabelB = breakpointLocationB ? `${breakpointLocationB}, ${retainedAAb} AA` : `${retainedAAb} AA`
    g.append('text').attr('x', bpXB + 12).attr('y', geneBY - domainHeight - 25).attr('text-anchor', 'middle').attr('fill', textColor).attr('font-size', '11px').attr('font-weight', '500').text(exonLabelB)

    // Connecting line
    g.append('line').attr('x1', bpXA).attr('y1', geneAY + domainHeight + 15).attr('x2', bpXB).attr('y2', geneBY - domainHeight - 15).attr('stroke', textColor).attr('stroke-width', 1.5).attr('stroke-dasharray', '6,4')

    // Scale bar
    const scaleBarLength = 100
    const scaleBarWidth = scale(scaleBarLength)
    const scaleBarY = geneBY + domainHeight + 45
    g.append('line').attr('x1', innerWidth - scaleBarWidth).attr('y1', scaleBarY).attr('x2', innerWidth).attr('y2', scaleBarY).attr('stroke', textColor).attr('stroke-width', 1.5)
    g.append('line').attr('x1', innerWidth - scaleBarWidth).attr('y1', scaleBarY - 3).attr('x2', innerWidth - scaleBarWidth).attr('y2', scaleBarY + 3).attr('stroke', textColor).attr('stroke-width', 1.5)
    g.append('line').attr('x1', innerWidth).attr('y1', scaleBarY - 3).attr('x2', innerWidth).attr('y2', scaleBarY + 3).attr('stroke', textColor).attr('stroke-width', 1.5)
    g.append('text').attr('x', innerWidth - scaleBarWidth / 2).attr('y', scaleBarY + 15).attr('text-anchor', 'middle').attr('fill', textColor).attr('font-size', '10px').text(`${scaleBarLength} AA`)

    // Notify parent of SVG content
    if (onSvgReady && svgRef.current) {
      onSvgReady(svgRef.current.outerHTML)
    }

  // Note: shouldShowDomain and getDomainColor depend on filters and localColorMap which are in deps
  }, [data, theme, localColorMap, filters, onSvgReady, containerWidth, showStrandOrientation])

  return (
    <div className="mt-4">
      <div ref={containerRef} className="relative">
        <svg ref={svgRef} className="w-full" />
        {hoveredDomain && (
          <div
            className="absolute z-10 px-2 py-1 text-sm bg-gray-900 dark:bg-gray-700 text-white rounded shadow-lg pointer-events-none"
            style={{ left: mousePos.x + 12, top: mousePos.y - 28 }}
          >
            {hoveredDomain}
          </div>
        )}
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
        <span className="ml-2 text-gray-400">• Click domains to view in database</span>
      </p>
    </div>
  )
}
