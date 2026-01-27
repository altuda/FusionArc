import { useRef, useEffect, useState, useMemo } from 'react'
import * as d3 from 'd3'
import { VisualizationData, DomainInfo } from '../../api/client'
import { useTheme } from '../../context/ThemeContext'
import { DomainColorMap } from '../../utils/domainColors'
import { shouldShowDomain as shouldShowDomainFilter } from '../../utils/domainFilters'
import FusionSchematicView from './FusionSchematicView'

// Generate URL to database entry based on source and accession
const getDatabaseUrl = (source: string, accession: string | undefined): string | null => {
  if (!accession) return null
  const sourceLower = source.toLowerCase()
  const accLower = accession.toLowerCase()
  // Handle CDD-style accessions (pfam09606, smart00297, cd00001) - route to NCBI CDD
  if (accLower.startsWith('pfam') || accLower.startsWith('smart') || accLower.startsWith('cd')) {
    return `https://www.ncbi.nlm.nih.gov/Structure/cdd/cddsrv.cgi?acc=${accession}`
  }
  if (sourceLower === 'pfam') return `https://www.ebi.ac.uk/interpro/entry/pfam/${accession}/`
  if (sourceLower === 'smart') return `https://smart.embl.de/smart/do_annotation.pl?DOMAIN=${accession}`
  if (sourceLower === 'cdd') return `https://www.ncbi.nlm.nih.gov/Structure/cdd/cddsrv.cgi?acc=${accession}`
  if (sourceLower === 'superfamily' || sourceLower === 'supfam') return `https://supfam.org/SUPERFAMILY/cgi-bin/scop.cgi?sunid=${accession.replace('SSF', '')}`
  if (sourceLower === 'gene3d') return `https://www.cathdb.info/superfamily/${accession.replace('G3DSA:', '')}`
  if (sourceLower === 'panther') return `https://www.pantherdb.org/panther/family.do?clsAccession=${accession}`
  if (sourceLower === 'prosite' || sourceLower.includes('prosite')) return `https://prosite.expasy.org/${accession}`
  if (sourceLower === 'interpro') return `https://www.ebi.ac.uk/interpro/entry/InterPro/${accession}/`
  if (sourceLower === 'prints') return `https://www.ebi.ac.uk/interpro/entry/prints/${accession}/`
  if (sourceLower === 'uniprot') return `https://www.uniprot.org/uniprotkb/${accession}`
  return null
}

export type ColorMode = 'source' | 'type' | 'domain'
export type ViewMode = 'fusion' | 'full' | 'stacked'

export interface DomainFilters {
  sources: string[]
  dataProviders: string[]  // InterPro, UniProt, CDD, Ensembl
  excludeDataProviders?: string[]  // Providers to exclude (e.g., ['CDD'])
  colorMode: ColorMode
}

interface ProteinSchematicProps {
  data: VisualizationData
  filters?: DomainFilters
  showStrandOrientation?: boolean
  onSvgReady?: (svg: string) => void
  domainColorMap?: DomainColorMap
  viewMode?: ViewMode
}

// Infer feature type from domain name
const inferFeatureType = (name: string, source: string): string => {
  const nameLower = name.toLowerCase()
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
  const sourceLower = source.toLowerCase()
  if (sourceLower.includes('superfamily') || sourceLower.includes('gene3d')) return 'homologous_superfamily'
  if (sourceLower === 'panther') return 'family'
  if (sourceLower === 'signalp') return 'signal_peptide'
  if (sourceLower === 'phobius') return 'transmembrane'
  if (sourceLower === 'ncoils') return 'coiled_coil'
  if (sourceLower === 'seg' || sourceLower === 'mobidblite') return 'disorder'
  if (sourceLower === 'alphafold' || sourceLower === 'sifts') return 'structure'
  return 'domain'
}

const TYPE_COLORS: Record<string, string> = {
  'domain': '#3B82F6', 'family': '#8B5CF6', 'homologous_superfamily': '#F59E0B',
  'repeat': '#10B981', 'site': '#EC4899', 'signal_peptide': '#F97316',
  'transmembrane': '#14B8A6', 'coiled_coil': '#0EA5E9', 'low_complexity': '#78716C',
  'disorder': '#64748B', 'structure': '#22C55E', 'kinase': '#EF4444', 'default': '#6366F1',
}

const SOURCE_COLORS: Record<string, string> = {
  'Pfam': '#3B82F6', 'pfam': '#3B82F6', 'Smart': '#10B981', 'smart': '#10B981', 'SMART': '#10B981',
  'Superfamily': '#F59E0B', 'superfamily': '#F59E0B', 'SuperFamily': '#F59E0B',
  'CDD': '#8B5CF6', 'cdd': '#8B5CF6', 'PANTHER': '#EC4899', 'panther': '#EC4899',
  'Gene3D': '#06B6D4', 'gene3d': '#06B6D4', 'Prosite_profiles': '#84CC16', 'Prosite_patterns': '#84CC16',
  'SignalP': '#F97316', 'Phobius': '#14B8A6', 'PRINTS': '#A855F7', 'MobiDBLite': '#64748B',
  'Seg': '#78716C', 'ncoils': '#0EA5E9', 'sifts': '#D946EF', 'alphafold': '#22C55E', 'default': '#6366F1',
}

const defaultFilters: DomainFilters = { sources: [], dataProviders: [], colorMode: 'domain' }

export default function ProteinSchematic({ data, filters = defaultFilters, showStrandOrientation = false, onSvgReady, domainColorMap, viewMode = 'fusion' }: ProteinSchematicProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [hoveredDomain, setHoveredDomain] = useState<string | null>(null)
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const { theme } = useTheme()

  // Create local color map - MUST be before any conditional return
  const localColorMap = useMemo(() => {
    if (domainColorMap) return domainColorMap
    const map = new DomainColorMap()
    const allDomains = [...data.gene_a.domains, ...data.gene_b.domains]
    map.preloadFromDomains(allDomains)
    return map
  }, [data, domainColorMap])

  useEffect(() => {
    // Skip effect for stacked view (handled by FusionSchematicView)
    if (viewMode === 'stacked') return
    if (!svgRef.current || !containerRef.current) return

    const container = containerRef.current
    const width = container.clientWidth
    const margin = { top: 40, right: 40, bottom: 50, left: 40 }
    const innerWidth = width - margin.left - margin.right
    const height = viewMode === 'full' ? 280 : 160
    const innerHeight = height - margin.top - margin.bottom

    d3.select(svgRef.current).selectAll('*').remove()
    const svg = d3.select(svgRef.current).attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`)
    const g = svg.append('g').attr('transform', `translate(${margin.left}, ${margin.top})`)

    const textColor = theme === 'dark' ? '#F3F4F6' : '#1F2937'
    const lineColor = theme === 'dark' ? '#6B7280' : '#9CA3AF'
    const domainHeight = 24

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

    const shouldShowDomain = (domain: DomainInfo): boolean => {
      return shouldShowDomainFilter(domain, filters)
    }

    const drawDomainRect = (
      xPos: number, yPos: number, rectWidth: number,
      domain: DomainInfo, isLost: boolean
    ) => {
      const color = getLocalDomainColor(domain.name, domain.source, domain.is_kinase)
      const dbUrl = getDatabaseUrl(domain.source, domain.accession)

      g.append('rect')
        .attr('x', xPos)
        .attr('y', yPos - domainHeight / 2)
        .attr('width', rectWidth)
        .attr('height', domainHeight)
        .attr('fill', color)
        .attr('rx', 4)
        .attr('opacity', isLost ? 0.25 : 0.85)
        .attr('stroke', domain.is_kinase ? '#991B1B' : (isLost ? lineColor : 'none'))
        .attr('stroke-width', domain.is_kinase ? 2 : (isLost ? 1 : 0))
        .attr('stroke-dasharray', isLost ? '4,2' : 'none')
        .style('cursor', dbUrl ? 'pointer' : 'default')
        .on('mouseenter', function() {
          d3.select(this).attr('opacity', isLost ? 0.5 : 1)
          setHoveredDomain(domain.name)
        })
        .on('mousemove', function(event) {
          const containerRect = container.getBoundingClientRect()
          setMousePos({ x: event.clientX - containerRect.left, y: event.clientY - containerRect.top })
        })
        .on('mouseleave', function() {
          d3.select(this).attr('opacity', isLost ? 0.25 : 0.85)
          setHoveredDomain(null)
        })
        .on('click', function() {
          if (dbUrl) window.open(dbUrl, '_blank', 'noopener,noreferrer')
        })
    }

    const drawProtein = (
      geneData: typeof data.gene_a, yCenter: number, proteinLength: number,
      breakpoint: number | undefined, is5Prime: boolean, showAllDomains: boolean
    ) => {
      const xScale = d3.scaleLinear().domain([0, proteinLength]).range([0, innerWidth])
      g.append('line').attr('x1', 0).attr('y1', yCenter).attr('x2', innerWidth).attr('y2', yCenter).attr('stroke', lineColor).attr('stroke-width', 4)

      geneData.domains.forEach((domain) => {
        if (!shouldShowDomain(domain)) return
        if (!showAllDomains && domain.status === 'lost') return
        const startPos = xScale(domain.start)
        const endPos = xScale(domain.end)
        if (endPos <= startPos) return
        drawDomainRect(startPos, yCenter, endPos - startPos, domain, domain.status === 'lost')
      })

      if (breakpoint !== undefined && breakpoint > 0) {
        const bpX = xScale(breakpoint)
        g.append('line').attr('x1', bpX).attr('y1', yCenter - domainHeight - 8).attr('x2', bpX).attr('y2', yCenter + domainHeight + 8).attr('stroke', '#EF4444').attr('stroke-width', 2)
        const arrowDir = is5Prime ? -1 : 1
        g.append('polygon').attr('points', `${bpX},${yCenter - domainHeight - 12} ${bpX + arrowDir * 8},${yCenter - domainHeight - 16} ${bpX + arrowDir * 8},${yCenter - domainHeight - 8}`).attr('fill', '#EF4444')
        g.append('text').attr('x', bpX).attr('y', yCenter + domainHeight + 22).attr('text-anchor', 'middle').attr('fill', '#EF4444').attr('font-size', '10px').attr('font-weight', 'bold').text(`aa ${breakpoint}`)
        const shadeX = is5Prime ? bpX : 0
        const shadeW = is5Prime ? innerWidth - bpX : bpX
        g.append('rect').attr('x', shadeX).attr('y', yCenter - domainHeight / 2 - 2).attr('width', shadeW).attr('height', domainHeight + 4).attr('fill', theme === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.08)').attr('pointer-events', 'none')
      }
      return xScale
    }

    if (viewMode === 'full') {
      const geneALength = Math.max(...data.gene_a.domains.map(d => d.end), data.gene_a.aa_breakpoint || 0, data.gene_a.protein_length || 100)
      const geneBLength = Math.max(...data.gene_b.domains.map(d => d.end), data.gene_b.protein_length || 100)
      const rowHeight = 80, geneAY = rowHeight / 2, geneBY = rowHeight + rowHeight / 2 + 20

      g.append('text').attr('x', 0).attr('y', geneAY - domainHeight - 15).attr('fill', data.gene_a.color).attr('font-weight', 'bold').attr('font-size', '14px').text(`${data.gene_a.symbol} (5' partner)${showStrandOrientation && data.gene_a.strand ? ` ${data.gene_a.strand}` : ''}`)
      const xScaleA = drawProtein(data.gene_a, geneAY, geneALength, data.gene_a.aa_breakpoint, true, true)
      g.append('g').attr('transform', `translate(0, ${geneAY + domainHeight / 2 + 8})`).call(d3.axisBottom(xScaleA).ticks(6)).selectAll('text').attr('fill', textColor).attr('font-size', '9px')

      g.append('text').attr('x', 0).attr('y', geneBY - domainHeight - 15).attr('fill', data.gene_b.color).attr('font-weight', 'bold').attr('font-size', '14px').text(`${data.gene_b.symbol} (3' partner)${showStrandOrientation && data.gene_b.strand ? ` ${data.gene_b.strand}` : ''}`)
      const xScaleB = drawProtein(data.gene_b, geneBY, geneBLength, data.gene_b.aa_breakpoint, false, true)
      g.append('g').attr('transform', `translate(0, ${geneBY + domainHeight / 2 + 8})`).call(d3.axisBottom(xScaleB).ticks(6)).selectAll('text').attr('fill', textColor).attr('font-size', '9px')

      g.append('rect').attr('x', innerWidth - 120).attr('y', -25).attr('width', 12).attr('height', 12).attr('fill', theme === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.08)').attr('stroke', lineColor).attr('stroke-width', 1)
      g.append('text').attr('x', innerWidth - 104).attr('y', -15).attr('fill', textColor).attr('font-size', '10px').text('Lost in fusion')
    } else {
      const xScale = d3.scaleLinear().domain([0, data.total_length]).range([0, innerWidth])
      const geneAEnd = xScale(data.junction_position)

      g.append('line').attr('x1', 0).attr('y1', innerHeight / 2).attr('x2', innerWidth).attr('y2', innerHeight / 2).attr('stroke', lineColor).attr('stroke-width', 4)

      data.gene_a.domains.forEach((domain) => {
        if (!shouldShowDomain(domain) || domain.status === 'lost') return
        const startPos = xScale(domain.start)
        const endPos = xScale(Math.min(domain.end, data.junction_position))
        if (endPos <= startPos) return
        drawDomainRect(startPos, innerHeight / 2, endPos - startPos, domain, false)
      })

      data.gene_b.domains.forEach((domain) => {
        if (!shouldShowDomain(domain) || domain.status === 'lost') return
        const offset = data.junction_position - (data.gene_b.aa_breakpoint || 0)
        const startPos = xScale(Math.max(domain.start + offset, data.junction_position))
        const endPos = xScale(domain.end + offset)
        if (endPos <= startPos) return
        drawDomainRect(startPos, innerHeight / 2, endPos - startPos, domain, false)
      })

      g.append('line').attr('x1', geneAEnd).attr('y1', innerHeight / 2 - domainHeight - 5).attr('x2', geneAEnd).attr('y2', innerHeight / 2 + domainHeight + 5).attr('stroke', '#EF4444').attr('stroke-width', 2).attr('stroke-dasharray', '4,2')
      g.append('text').attr('x', geneAEnd / 2).attr('y', -10).attr('text-anchor', 'middle').attr('fill', data.gene_a.color).attr('font-weight', 'bold').attr('font-size', '14px').text(data.gene_a.symbol + (showStrandOrientation && data.gene_a.strand ? ` (${data.gene_a.strand})` : ''))
      g.append('text').attr('x', geneAEnd + (innerWidth - geneAEnd) / 2).attr('y', -10).attr('text-anchor', 'middle').attr('fill', data.gene_b.color).attr('font-weight', 'bold').attr('font-size', '14px').text(data.gene_b.symbol + (showStrandOrientation && data.gene_b.strand ? ` (${data.gene_b.strand})` : ''))

      const frameText = data.is_in_frame === true ? 'In-frame' : data.is_in_frame === false ? 'Out-of-frame' : 'Unknown'
      const frameColor = data.is_in_frame === true ? '#10B981' : data.is_in_frame === false ? '#EF4444' : '#6B7280'
      g.append('text').attr('x', innerWidth / 2).attr('y', innerHeight + 30).attr('text-anchor', 'middle').attr('fill', frameColor).attr('font-weight', 'bold').attr('font-size', '12px').text(frameText)

      g.append('g').attr('transform', `translate(0, ${innerHeight / 2 + domainHeight / 2 + 8})`).call(d3.axisBottom(xScale).ticks(8)).selectAll('text').attr('fill', textColor).attr('font-size', '10px')
      g.append('text').attr('x', innerWidth / 2).attr('y', innerHeight + 45).attr('text-anchor', 'middle').attr('fill', lineColor).attr('font-size', '10px').text('Amino acid position')
    }

    if (onSvgReady) onSvgReady(svgRef.current.outerHTML)
  }, [data, filters, showStrandOrientation, theme, onSvgReady, localColorMap, viewMode])

  // Render stacked view
  if (viewMode === 'stacked') {
    return <FusionSchematicView data={data} domainColorMap={localColorMap} filters={filters} onSvgReady={onSvgReady} showStrandOrientation={showStrandOrientation} />
  }

  return (
    <div ref={containerRef} className="relative w-full">
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
  )
}
