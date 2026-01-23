import { useRef, useEffect, useState, useMemo } from 'react'
import * as d3 from 'd3'
import { VisualizationData, DomainInfo } from '../../api/client'
import { useTheme } from '../../context/ThemeContext'
import { DomainColorMap } from '../../utils/domainColors'
import FusionSchematicView from './FusionSchematicView'

export type ColorMode = 'source' | 'type' | 'domain'
export type ViewMode = 'fusion' | 'full' | 'stacked'  // fusion = fusion protein only, full = both original proteins, stacked = genes stacked vertically

export interface DomainFilters {
  sources: string[]  // empty = show all
  colorMode: ColorMode  // 'source' = by database, 'type' = by functional type, 'domain' = by domain name (consistent)
}

interface ProteinSchematicProps {
  data: VisualizationData
  filters?: DomainFilters
  showStrandOrientation?: boolean
  onSvgReady?: (svg: string) => void
  domainColorMap?: DomainColorMap  // Optional shared color map for consistency across visualizations
  viewMode?: ViewMode  // 'fusion' = fusion protein, 'full' = full original proteins
}

// Infer feature type from domain name
const inferFeatureType = (name: string, source: string): string => {
  const nameLower = name.toLowerCase()

  // Check name for keywords (most specific first)
  if (nameLower.includes('kinase')) return 'kinase'
  if (nameLower.includes('repeat') || nameLower.includes('wd40') || nameLower.includes('ank') || nameLower.includes('lrr')) return 'repeat'
  if (nameLower.includes('motif')) return 'motif'
  if (nameLower.includes('site') || nameLower.includes('binding')) return 'site'
  if (nameLower.includes('signal') || nameLower.includes('peptide')) return 'signal_peptide'
  if (nameLower.includes('transmembrane') || nameLower.includes('tm_helix')) return 'transmembrane'
  if (nameLower.includes('coil')) return 'coiled_coil'
  if (nameLower.includes('disorder') || nameLower.includes('low_complexity') || nameLower.includes('low complexity')) return 'disorder'
  if (nameLower.includes('family')) return 'family'
  if (nameLower.includes('superfamily')) return 'homologous_superfamily'
  if (nameLower.includes('domain')) return 'domain'

  // Fall back to source-based inference
  const sourceLower = source.toLowerCase()
  if (sourceLower.includes('superfamily') || sourceLower.includes('gene3d')) return 'homologous_superfamily'
  if (sourceLower === 'panther') return 'family'
  if (sourceLower === 'signalp') return 'signal_peptide'
  if (sourceLower === 'phobius') return 'transmembrane'
  if (sourceLower === 'ncoils') return 'coiled_coil'
  if (sourceLower === 'seg' || sourceLower === 'mobidblite') return 'disorder'
  if (sourceLower === 'alphafold' || sourceLower === 'sifts') return 'structure'

  return 'domain' // Default
}

// Colors by functional type
const TYPE_COLORS: Record<string, string> = {
  'domain': '#3B82F6',           // Blue
  'family': '#8B5CF6',           // Purple
  'homologous_superfamily': '#F59E0B', // Amber
  'repeat': '#10B981',           // Green
  'site': '#EC4899',             // Pink
  'signal_peptide': '#F97316',   // Orange
  'transmembrane': '#14B8A6',    // Teal
  'coiled_coil': '#0EA5E9',      // Sky blue
  'low_complexity': '#78716C',   // Gray
  'disorder': '#64748B',         // Slate
  'structure': '#22C55E',        // Green
  'kinase': '#EF4444',           // Red (special)
  'default': '#6366F1',          // Indigo
}

// Colors by source database (fallback)
const SOURCE_COLORS: Record<string, string> = {
  'Pfam': '#3B82F6', 'pfam': '#3B82F6',
  'Smart': '#10B981', 'smart': '#10B981', 'SMART': '#10B981',
  'Superfamily': '#F59E0B', 'superfamily': '#F59E0B', 'SuperFamily': '#F59E0B',
  'CDD': '#8B5CF6', 'cdd': '#8B5CF6',
  'PANTHER': '#EC4899', 'panther': '#EC4899',
  'Gene3D': '#06B6D4', 'gene3d': '#06B6D4',
  'Prosite_profiles': '#84CC16', 'Prosite_patterns': '#84CC16',
  'SignalP': '#F97316',
  'Phobius': '#14B8A6',
  'PRINTS': '#A855F7',
  'MobiDBLite': '#64748B',
  'Seg': '#78716C',
  'ncoils': '#0EA5E9',
  'sifts': '#D946EF',
  'alphafold': '#22C55E',
  'default': '#6366F1',
}

const defaultFilters: DomainFilters = {
  sources: [],
  colorMode: 'domain',  // Default to domain-based coloring for consistency
}

export default function ProteinSchematic({ data, filters = defaultFilters, showStrandOrientation = false, onSvgReady, domainColorMap, viewMode = 'fusion' }: ProteinSchematicProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<{
    show: boolean
    x: number
    y: number
    content: { name: string; source: string; start: number; end: number; status: string; is_kinase: boolean }
  } | null>(null)
  const { theme } = useTheme()

  // Create local color map if not provided, pre-populated with all domains
  const localColorMap = useMemo(() => {
    if (domainColorMap) return domainColorMap
    const map = new DomainColorMap()
    // Preload all domain names for consistent colors
    const allDomains = [...data.gene_a.domains, ...data.gene_b.domains]
    map.preloadFromDomains(allDomains)
    return map
  }, [data, domainColorMap])

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return

    const container = containerRef.current
    const width = container.clientWidth
    const margin = { top: 40, right: 40, bottom: 50, left: 40 }
    const innerWidth = width - margin.left - margin.right

    // Height depends on view mode
    const height = viewMode === 'full' ? 280 : 160
    const innerHeight = height - margin.top - margin.bottom

    // Clear previous content
    d3.select(svgRef.current).selectAll('*').remove()

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`)

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`)

    const textColor = theme === 'dark' ? '#F3F4F6' : '#1F2937'
    const lineColor = theme === 'dark' ? '#6B7280' : '#9CA3AF'
    const domainHeight = 24

    // Get domain color based on color mode
    const getLocalDomainColor = (name: string, source: string, isKinase: boolean): string => {
      const colorMode = filters.colorMode || 'domain'

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

    // Filter function for source filter only (status handled separately based on view)
    const shouldShowBySource = (domain: DomainInfo): boolean => {
      const sources = filters.sources || []
      if (sources.length > 0 && !sources.includes(domain.source)) return false
      return true
    }

    // Helper to draw a single protein with domains
    const drawProtein = (
      geneData: typeof data.gene_a,
      yCenter: number,
      proteinLength: number,
      breakpoint: number | undefined,
      is5Prime: boolean,
      showAllDomains: boolean
    ) => {
      const xScale = d3.scaleLinear()
        .domain([0, proteinLength])
        .range([0, innerWidth])

      // Draw backbone
      g.append('line')
        .attr('x1', 0)
        .attr('y1', yCenter)
        .attr('x2', innerWidth)
        .attr('y2', yCenter)
        .attr('stroke', lineColor)
        .attr('stroke-width', 4)

      // Draw domains
      geneData.domains.forEach((domain) => {
        if (!shouldShowBySource(domain)) return
        // In full view, show all domains; in fusion view, only retained/truncated
        if (!showAllDomains && domain.status === 'lost') return

        const startPos = xScale(domain.start)
        const endPos = xScale(domain.end)

        if (endPos <= startPos) return

        const color = getLocalDomainColor(domain.name, domain.source, domain.is_kinase)
        const isLost = domain.status === 'lost'

        g.append('rect')
          .attr('x', startPos)
          .attr('y', yCenter - domainHeight / 2)
          .attr('width', endPos - startPos)
          .attr('height', domainHeight)
          .attr('fill', color)
          .attr('rx', 4)
          .attr('opacity', isLost ? 0.25 : 0.85)
          .attr('stroke', domain.is_kinase ? '#991B1B' : (isLost ? lineColor : 'none'))
          .attr('stroke-width', domain.is_kinase ? 2 : (isLost ? 1 : 0))
          .attr('stroke-dasharray', isLost ? '4,2' : 'none')
          .style('cursor', 'pointer')
          .on('mouseenter', function(event) {
            d3.select(this).attr('opacity', isLost ? 0.5 : 1)
            const rect = (event.target as SVGRectElement).getBoundingClientRect()
            const containerRect = container.getBoundingClientRect()
            setTooltip({
              show: true,
              x: rect.left - containerRect.left + rect.width / 2,
              y: rect.top - containerRect.top - 10,
              content: { name: domain.name, source: domain.source, start: domain.start, end: domain.end, status: domain.status, is_kinase: domain.is_kinase },
            })
          })
          .on('mouseleave', function() {
            d3.select(this).attr('opacity', isLost ? 0.25 : 0.85)
            setTooltip(null)
          })
      })

      // Draw breakpoint marker
      if (breakpoint !== undefined && breakpoint > 0) {
        const bpX = xScale(breakpoint)

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

        // Breakpoint label
        g.append('text')
          .attr('x', bpX)
          .attr('y', yCenter + domainHeight + 22)
          .attr('text-anchor', 'middle')
          .attr('fill', '#EF4444')
          .attr('font-size', '10px')
          .attr('font-weight', 'bold')
          .text(`aa ${breakpoint}`)

        // Shade the lost region
        if (is5Prime) {
          // 5' partner: shade region after breakpoint (lost)
          g.append('rect')
            .attr('x', bpX)
            .attr('y', yCenter - domainHeight / 2 - 2)
            .attr('width', innerWidth - bpX)
            .attr('height', domainHeight + 4)
            .attr('fill', theme === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.08)')
            .attr('pointer-events', 'none')
        } else {
          // 3' partner: shade region before breakpoint (lost)
          g.append('rect')
            .attr('x', 0)
            .attr('y', yCenter - domainHeight / 2 - 2)
            .attr('width', bpX)
            .attr('height', domainHeight + 4)
            .attr('fill', theme === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.08)')
            .attr('pointer-events', 'none')
        }
      }

      return xScale
    }

    if (viewMode === 'full') {
      // FULL VIEW: Show both original proteins stacked
      const geneALength = Math.max(...data.gene_a.domains.map(d => d.end), data.gene_a.aa_breakpoint || 0, data.gene_a.protein_length || 100)
      const geneBLength = Math.max(...data.gene_b.domains.map(d => d.end), data.gene_b.protein_length || 100)

      const rowHeight = 80
      const geneAY = rowHeight / 2
      const geneBY = rowHeight + rowHeight / 2 + 20

      // Gene A label
      g.append('text')
        .attr('x', 0)
        .attr('y', geneAY - domainHeight - 15)
        .attr('fill', data.gene_a.color)
        .attr('font-weight', 'bold')
        .attr('font-size', '14px')
        .text(`${data.gene_a.symbol} (5' partner)${showStrandOrientation && data.gene_a.strand ? ` ${data.gene_a.strand}` : ''}`)

      // Draw Gene A
      const xScaleA = drawProtein(data.gene_a, geneAY, geneALength, data.gene_a.aa_breakpoint, true, true)

      // Gene A axis
      const xAxisA = d3.axisBottom(xScaleA).ticks(6)
      g.append('g')
        .attr('transform', `translate(0, ${geneAY + domainHeight / 2 + 8})`)
        .call(xAxisA)
        .selectAll('text')
        .attr('fill', textColor)
        .attr('font-size', '9px')

      // Gene B label
      g.append('text')
        .attr('x', 0)
        .attr('y', geneBY - domainHeight - 15)
        .attr('fill', data.gene_b.color)
        .attr('font-weight', 'bold')
        .attr('font-size', '14px')
        .text(`${data.gene_b.symbol} (3' partner)${showStrandOrientation && data.gene_b.strand ? ` ${data.gene_b.strand}` : ''}`)

      // Draw Gene B
      const xScaleB = drawProtein(data.gene_b, geneBY, geneBLength, data.gene_b.aa_breakpoint, false, true)

      // Gene B axis
      const xAxisB = d3.axisBottom(xScaleB).ticks(6)
      g.append('g')
        .attr('transform', `translate(0, ${geneBY + domainHeight / 2 + 8})`)
        .call(xAxisB)
        .selectAll('text')
        .attr('fill', textColor)
        .attr('font-size', '9px')

      // Legend for lost regions
      g.append('rect')
        .attr('x', innerWidth - 120)
        .attr('y', -25)
        .attr('width', 12)
        .attr('height', 12)
        .attr('fill', theme === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.08)')
        .attr('stroke', lineColor)
        .attr('stroke-width', 1)

      g.append('text')
        .attr('x', innerWidth - 104)
        .attr('y', -15)
        .attr('fill', textColor)
        .attr('font-size', '10px')
        .text('Lost in fusion')

    } else {
      // FUSION VIEW: Show the resulting fusion protein (original behavior)
      const xScale = d3.scaleLinear()
        .domain([0, data.total_length])
        .range([0, innerWidth])

      const geneAEnd = xScale(data.junction_position)

      // Draw backbone
      g.append('line')
        .attr('x1', 0)
        .attr('y1', innerHeight / 2)
        .attr('x2', innerWidth)
        .attr('y2', innerHeight / 2)
        .attr('stroke', lineColor)
        .attr('stroke-width', 4)

      // Draw Gene A domains (retained/truncated only)
      data.gene_a.domains.forEach((domain) => {
        if (!shouldShowBySource(domain)) return
        if (domain.status === 'lost') return

        const startPos = xScale(domain.start)
        const endPos = xScale(Math.min(domain.end, data.junction_position))

        if (endPos <= startPos) return

        const color = getLocalDomainColor(domain.name, domain.source, domain.is_kinase)

        g.append('rect')
          .attr('x', startPos)
          .attr('y', innerHeight / 2 - domainHeight / 2)
          .attr('width', endPos - startPos)
          .attr('height', domainHeight)
          .attr('fill', color)
          .attr('rx', 4)
          .attr('opacity', 0.85)
          .attr('stroke', domain.is_kinase ? '#991B1B' : 'none')
          .attr('stroke-width', domain.is_kinase ? 2 : 0)
          .style('cursor', 'pointer')
          .on('mouseenter', function(event) {
            d3.select(this).attr('opacity', 1)
            const rect = (event.target as SVGRectElement).getBoundingClientRect()
            const containerRect = container.getBoundingClientRect()
            setTooltip({
              show: true,
              x: rect.left - containerRect.left + rect.width / 2,
              y: rect.top - containerRect.top - 10,
              content: { name: domain.name, source: domain.source, start: domain.start, end: domain.end, status: domain.status, is_kinase: domain.is_kinase },
            })
          })
          .on('mouseleave', function() {
            d3.select(this).attr('opacity', 0.85)
            setTooltip(null)
          })
      })

      // Draw Gene B domains (retained/truncated only)
      data.gene_b.domains.forEach((domain) => {
        if (!shouldShowBySource(domain)) return
        if (domain.status === 'lost') return

        const offset = data.junction_position - (data.gene_b.aa_breakpoint || 0)
        const startPos = xScale(Math.max(domain.start + offset, data.junction_position))
        const endPos = xScale(domain.end + offset)

        if (endPos <= startPos) return

        const color = getLocalDomainColor(domain.name, domain.source, domain.is_kinase)

        g.append('rect')
          .attr('x', startPos)
          .attr('y', innerHeight / 2 - domainHeight / 2)
          .attr('width', endPos - startPos)
          .attr('height', domainHeight)
          .attr('fill', color)
          .attr('rx', 4)
          .attr('opacity', 0.85)
          .attr('stroke', domain.is_kinase ? '#991B1B' : 'none')
          .attr('stroke-width', domain.is_kinase ? 2 : 0)
          .style('cursor', 'pointer')
          .on('mouseenter', function(event) {
            d3.select(this).attr('opacity', 1)
            const rect = (event.target as SVGRectElement).getBoundingClientRect()
            const containerRect = container.getBoundingClientRect()
            setTooltip({
              show: true,
              x: rect.left - containerRect.left + rect.width / 2,
              y: rect.top - containerRect.top - 10,
              content: { name: domain.name, source: domain.source, start: domain.start, end: domain.end, status: domain.status, is_kinase: domain.is_kinase },
            })
          })
          .on('mouseleave', function() {
            d3.select(this).attr('opacity', 0.85)
            setTooltip(null)
          })
      })

      // Junction marker
      g.append('line')
        .attr('x1', geneAEnd)
        .attr('y1', innerHeight / 2 - domainHeight - 5)
        .attr('x2', geneAEnd)
        .attr('y2', innerHeight / 2 + domainHeight + 5)
        .attr('stroke', '#EF4444')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '4,2')

      // Gene labels
      g.append('text')
        .attr('x', geneAEnd / 2)
        .attr('y', -10)
        .attr('text-anchor', 'middle')
        .attr('fill', data.gene_a.color)
        .attr('font-weight', 'bold')
        .attr('font-size', '14px')
        .text(data.gene_a.symbol + (showStrandOrientation && data.gene_a.strand ? ` (${data.gene_a.strand})` : ''))

      g.append('text')
        .attr('x', geneAEnd + (innerWidth - geneAEnd) / 2)
        .attr('y', -10)
        .attr('text-anchor', 'middle')
        .attr('fill', data.gene_b.color)
        .attr('font-weight', 'bold')
        .attr('font-size', '14px')
        .text(data.gene_b.symbol + (showStrandOrientation && data.gene_b.strand ? ` (${data.gene_b.strand})` : ''))

      // Frame status
      const frameText = data.is_in_frame === true ? 'In-frame' : data.is_in_frame === false ? 'Out-of-frame' : 'Unknown'
      const frameColor = data.is_in_frame === true ? '#10B981' : data.is_in_frame === false ? '#EF4444' : '#6B7280'

      g.append('text')
        .attr('x', innerWidth / 2)
        .attr('y', innerHeight + 30)
        .attr('text-anchor', 'middle')
        .attr('fill', frameColor)
        .attr('font-weight', 'bold')
        .attr('font-size', '12px')
        .text(frameText)

      // Axis
      const xAxis = d3.axisBottom(xScale).ticks(8)
      g.append('g')
        .attr('transform', `translate(0, ${innerHeight / 2 + domainHeight / 2 + 8})`)
        .call(xAxis)
        .selectAll('text')
        .attr('fill', textColor)
        .attr('font-size', '10px')

      g.append('text')
        .attr('x', innerWidth / 2)
        .attr('y', innerHeight + 45)
        .attr('text-anchor', 'middle')
        .attr('fill', lineColor)
        .attr('font-size', '10px')
        .text('Amino acid position')
    }

    // Callback with SVG content
    if (onSvgReady) {
      const svgContent = svgRef.current.outerHTML
      onSvgReady(svgContent)
    }

  }, [data, filters, showStrandOrientation, theme, onSvgReady, localColorMap, viewMode])

  // Render stacked view if that mode is selected
  if (viewMode === 'stacked') {
    return (
      <FusionSchematicView data={data} domainColorMap={localColorMap} filters={filters} />
    )
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <svg ref={svgRef} className="w-full" />

      {tooltip?.show && (
        <div
          className="absolute z-10 px-3 py-2 text-sm bg-gray-900 dark:bg-gray-700 text-white rounded-lg shadow-lg pointer-events-none transform -translate-x-1/2 -translate-y-full"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="font-semibold">{tooltip.content.name}</div>
          <div className="text-gray-300 text-xs">Source: {tooltip.content.source}</div>
          <div className="text-gray-300 text-xs">
            Position: {tooltip.content.start}-{tooltip.content.end} aa
          </div>
          {tooltip.content.is_kinase && (
            <div className="text-red-400 text-xs font-medium">Kinase domain</div>
          )}
          <div className={`text-xs font-medium ${
            tooltip.content.status === 'retained' ? 'text-green-400' :
            tooltip.content.status === 'truncated' ? 'text-yellow-400' : 'text-red-400'
          }`}>
            {tooltip.content.status.charAt(0).toUpperCase() + tooltip.content.status.slice(1)}
          </div>
        </div>
      )}
    </div>
  )
}
