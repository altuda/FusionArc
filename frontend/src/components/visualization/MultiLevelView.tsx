import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import * as d3 from 'd3'
import { VisualizationData } from '../../api/client'
import { useTheme } from '../../context/ThemeContext'
import { DomainColorMap } from '../../utils/domainColors'

interface MultiLevelViewProps {
  data: VisualizationData
  domainColorMap?: DomainColorMap  // Optional shared color map for consistency
}

export default function MultiLevelView({ data, domainColorMap }: MultiLevelViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const { theme } = useTheme()
  const [activeGene, setActiveGene] = useState<'A' | 'B'>('A')

  // Create local color map if not provided, pre-populated with all domains
  const localColorMap = useMemo(() => {
    if (domainColorMap) return domainColorMap
    const map = new DomainColorMap()
    const allDomains = [...data.gene_a.domains, ...data.gene_b.domains]
    map.preloadFromDomains(allDomains)
    return map
  }, [data, domainColorMap])

  const renderVisualization = useCallback(() => {
    if (!svgRef.current || !containerRef.current) return

    const container = containerRef.current
    const width = container.clientWidth
    const height = 450
    const margin = { top: 30, right: 60, bottom: 30, left: 80 }
    const innerWidth = width - margin.left - margin.right
    const levelHeight = 80
    const levelGap = 30

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', width).attr('height', height)

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`)

    const textColor = theme === 'dark' ? '#F3F4F6' : '#1F2937'
    const lineColor = theme === 'dark' ? '#4B5563' : '#D1D5DB'
    const bgColor = theme === 'dark' ? '#374151' : '#F3F4F6'

    const geneData = activeGene === 'A' ? data.gene_a : data.gene_b
    const breakpoint = geneData.breakpoint || 0
    const geneStart = geneData.gene_start || (geneData.exons.length > 0 ? Math.min(...geneData.exons.map(e => e.start)) : 0)
    const geneEnd = geneData.gene_end || (geneData.exons.length > 0 ? Math.max(...geneData.exons.map(e => e.end)) : 100000)

    // === Level 1: DNA/Genomic ===
    const dnaY = 0
    const dnaScale = d3.scaleLinear()
      .domain([geneStart, geneEnd])
      .range([0, innerWidth])

    // DNA label
    g.append('text')
      .attr('x', -10)
      .attr('y', dnaY + levelHeight / 2)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .attr('fill', textColor)
      .attr('font-size', '12px')
      .attr('font-weight', 'bold')
      .text('DNA')

    // DNA backbone
    g.append('rect')
      .attr('x', 0)
      .attr('y', dnaY + levelHeight / 2 - 8)
      .attr('width', innerWidth)
      .attr('height', 16)
      .attr('fill', bgColor)
      .attr('rx', 4)

    // DNA breakpoint marker
    if (breakpoint >= geneStart && breakpoint <= geneEnd) {
      const bpX = dnaScale(breakpoint)
      g.append('line')
        .attr('x1', bpX)
        .attr('y1', dnaY)
        .attr('x2', bpX)
        .attr('y2', dnaY + levelHeight)
        .attr('stroke', '#EF4444')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '4,2')

      g.append('text')
        .attr('x', bpX)
        .attr('y', dnaY - 5)
        .attr('text-anchor', 'middle')
        .attr('fill', '#EF4444')
        .attr('font-size', '10px')
        .text(`${geneData.chromosome}:${breakpoint.toLocaleString()}`)
    }

    // DNA axis
    const dnaAxis = d3.axisBottom(dnaScale)
      .ticks(6)
      .tickFormat(d => `${(+d / 1000000).toFixed(2)}Mb`)
    g.append('g')
      .attr('transform', `translate(0,${dnaY + levelHeight - 10})`)
      .call(dnaAxis)
      .selectAll('text')
      .attr('fill', textColor)
      .attr('font-size', '9px')

    // === Level 2: Transcript/Exons ===
    const transcriptY = dnaY + levelHeight + levelGap

    // Transcript label
    g.append('text')
      .attr('x', -10)
      .attr('y', transcriptY + levelHeight / 2)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .attr('fill', textColor)
      .attr('font-size', '12px')
      .attr('font-weight', 'bold')
      .text('Transcript')

    // Transcript backbone (introns)
    g.append('line')
      .attr('x1', 0)
      .attr('y1', transcriptY + levelHeight / 2)
      .attr('x2', innerWidth)
      .attr('y2', transcriptY + levelHeight / 2)
      .attr('stroke', lineColor)
      .attr('stroke-width', 2)

    // Draw exons
    const exonHeight = 24
    geneData.exons.forEach((exon) => {
      const x1 = dnaScale(exon.start)
      const x2 = dnaScale(exon.end)
      const exonWidth = Math.max(x2 - x1, 3)

      // Determine opacity based on retention status
      let opacity = 0.9
      if (exon.status === 'lost') opacity = 0.3
      else if (exon.status === 'partial') opacity = 0.7

      // Exon rectangle
      const rect = g.append('rect')
        .attr('x', x1)
        .attr('y', transcriptY + levelHeight / 2 - exonHeight / 2)
        .attr('width', exonWidth)
        .attr('height', exonHeight)
        .attr('fill', geneData.color)
        .attr('fill-opacity', opacity)
        .attr('stroke', exon.is_coding ? geneData.color : lineColor)
        .attr('stroke-width', exon.is_coding ? 2 : 1)
        .attr('rx', 2)
        .style('cursor', 'pointer')

      // Exon number
      if (exonWidth > 15) {
        g.append('text')
          .attr('x', x1 + exonWidth / 2)
          .attr('y', transcriptY + levelHeight / 2 + 4)
          .attr('text-anchor', 'middle')
          .attr('fill', 'white')
          .attr('font-size', '10px')
          .attr('font-weight', 'bold')
          .attr('pointer-events', 'none')
          .text(exon.rank)
      }

      // Hover effect
      rect.on('mouseenter', function() {
        d3.select(this).attr('fill-opacity', 1)
      })
      rect.on('mouseleave', function() {
        d3.select(this).attr('fill-opacity', opacity)
      })
    })

    // Transcript breakpoint marker
    if (breakpoint >= geneStart && breakpoint <= geneEnd) {
      const bpX = dnaScale(breakpoint)
      g.append('line')
        .attr('x1', bpX)
        .attr('y1', transcriptY + 5)
        .attr('x2', bpX)
        .attr('y2', transcriptY + levelHeight - 5)
        .attr('stroke', '#EF4444')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '4,2')
    }

    // CDS indicator
    if (geneData.cds_start && geneData.cds_end) {
      const cdsX1 = dnaScale(geneData.cds_start)
      const cdsX2 = dnaScale(geneData.cds_end)
      g.append('rect')
        .attr('x', cdsX1)
        .attr('y', transcriptY + levelHeight / 2 + exonHeight / 2 + 4)
        .attr('width', cdsX2 - cdsX1)
        .attr('height', 3)
        .attr('fill', '#8B5CF6')
    }

    // === Level 3: Protein/Domains ===
    const proteinY = transcriptY + levelHeight + levelGap
    const proteinLength = geneData.protein_length || 500
    const proteinScale = d3.scaleLinear()
      .domain([0, proteinLength])
      .range([0, innerWidth])

    // Protein label
    g.append('text')
      .attr('x', -10)
      .attr('y', proteinY + levelHeight / 2)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .attr('fill', textColor)
      .attr('font-size', '12px')
      .attr('font-weight', 'bold')
      .text('Protein')

    // Protein backbone
    g.append('rect')
      .attr('x', 0)
      .attr('y', proteinY + levelHeight / 2 - 6)
      .attr('width', innerWidth)
      .attr('height', 12)
      .attr('fill', bgColor)
      .attr('rx', 4)

    // Draw domains
    const domainHeight = 20

    geneData.domains.forEach((domain) => {
      if (domain.status === 'lost') return

      const x1 = proteinScale(domain.start)
      const x2 = proteinScale(domain.end)
      const domainWidth = Math.max(x2 - x1, 3)
      // Use consistent domain colors from shared color map
      const color = domain.is_kinase ? '#EF4444' : localColorMap.getColor(domain.name)

      const opacity = domain.status === 'truncated' ? 0.6 : 0.85

      g.append('rect')
        .attr('x', x1)
        .attr('y', proteinY + levelHeight / 2 - domainHeight / 2)
        .attr('width', domainWidth)
        .attr('height', domainHeight)
        .attr('fill', color)
        .attr('fill-opacity', opacity)
        .attr('stroke', domain.is_kinase ? '#991B1B' : 'none')
        .attr('stroke-width', domain.is_kinase ? 2 : 0)
        .attr('rx', 3)
    })

    // Protein breakpoint marker
    if (geneData.aa_breakpoint) {
      const bpX = proteinScale(geneData.aa_breakpoint)
      g.append('line')
        .attr('x1', bpX)
        .attr('y1', proteinY + 5)
        .attr('x2', bpX)
        .attr('y2', proteinY + levelHeight - 5)
        .attr('stroke', '#EF4444')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '4,2')

      g.append('text')
        .attr('x', bpX)
        .attr('y', proteinY + levelHeight + 12)
        .attr('text-anchor', 'middle')
        .attr('fill', '#EF4444')
        .attr('font-size', '10px')
        .text(`AA ${geneData.aa_breakpoint}`)
    }

    // Protein axis
    const proteinAxis = d3.axisBottom(proteinScale)
      .ticks(6)
      .tickFormat(d => `${d}`)
    g.append('g')
      .attr('transform', `translate(0,${proteinY + levelHeight - 10})`)
      .call(proteinAxis)
      .selectAll('text')
      .attr('fill', textColor)
      .attr('font-size', '9px')

    // === Connection lines between levels ===
    // Draw vertical lines connecting breakpoints across levels
    if (breakpoint >= geneStart && breakpoint <= geneEnd && geneData.aa_breakpoint) {
      const dnaX = dnaScale(breakpoint)
      const proteinX = proteinScale(geneData.aa_breakpoint)

      // DNA to Transcript connection
      g.append('line')
        .attr('x1', dnaX)
        .attr('y1', dnaY + levelHeight)
        .attr('x2', dnaX)
        .attr('y2', transcriptY)
        .attr('stroke', '#EF4444')
        .attr('stroke-width', 1)
        .attr('stroke-opacity', 0.3)

      // Transcript to Protein connection (curved)
      const midY = transcriptY + levelHeight + levelGap / 2
      g.append('path')
        .attr('d', `M ${dnaX} ${transcriptY + levelHeight}
                    Q ${dnaX} ${midY} ${(dnaX + proteinX) / 2} ${midY}
                    Q ${proteinX} ${midY} ${proteinX} ${proteinY}`)
        .attr('stroke', '#EF4444')
        .attr('stroke-width', 1)
        .attr('stroke-opacity', 0.3)
        .attr('fill', 'none')
    }

  }, [data, theme, activeGene, localColorMap])

  useEffect(() => {
    renderVisualization()
  }, [renderVisualization])

  useEffect(() => {
    const handleResize = () => renderVisualization()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [renderVisualization])

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Multi-Level View
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 dark:text-gray-400">Gene:</span>
          <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
            <button
              onClick={() => setActiveGene('A')}
              className={`px-3 py-1 text-sm font-medium transition-colors ${
                activeGene === 'A'
                  ? 'bg-blue-500 text-white'
                  : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
              }`}
            >
              {data.gene_a.symbol}
            </button>
            <button
              onClick={() => setActiveGene('B')}
              className={`px-3 py-1 text-sm font-medium transition-colors ${
                activeGene === 'B'
                  ? 'bg-green-500 text-white'
                  : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
              }`}
            >
              {data.gene_b.symbol}
            </button>
          </div>
        </div>
      </div>

      <div ref={containerRef} className="relative">
        <svg ref={svgRef} className="w-full" />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-4 mt-4 text-xs text-gray-600 dark:text-gray-400">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: data.gene_a.color }} />
          <span>Coding exon</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded border-2" style={{ borderColor: '#9CA3AF', backgroundColor: 'transparent' }} />
          <span>UTR exon</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-1 bg-purple-500" />
          <span>CDS region</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-0.5 h-3 bg-red-500" />
          <span>Breakpoint</span>
        </div>
      </div>

      <p className="text-xs text-center text-gray-500 dark:text-gray-400 mt-2">
        Synchronized view showing genomic coordinates, transcript structure, and protein domains.
        The red dashed line indicates the fusion breakpoint across all levels.
      </p>
    </div>
  )
}
