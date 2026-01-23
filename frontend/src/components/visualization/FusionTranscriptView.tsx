import { useRef, useEffect, useState } from 'react'
import * as d3 from 'd3'
import { VisualizationData, FusionExonInfo } from '../../api/client'
import { useTheme } from '../../context/ThemeContext'

interface FusionTranscriptViewProps {
  data: VisualizationData
}

export default function FusionTranscriptView({ data }: FusionTranscriptViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const { theme } = useTheme()
  const [tooltip, setTooltip] = useState<{
    visible: boolean
    x: number
    y: number
    content: FusionExonInfo | null
  }>({ visible: false, x: 0, y: 0, content: null })

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || !data.fusion_transcript) return

    const container = containerRef.current
    const width = container.clientWidth
    const height = 200
    const margin = { top: 40, right: 40, bottom: 40, left: 40 }
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', width).attr('height', height)

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`)

    const transcript = data.fusion_transcript
    const textColor = theme === 'dark' ? '#F3F4F6' : '#1F2937'
    const lineColor = theme === 'dark' ? '#6B7280' : '#9CA3AF'

    // Scale for transcript coordinates
    const xScale = d3.scaleLinear()
      .domain([0, transcript.total_length])
      .range([0, innerWidth])

    // Draw transcript backbone (thin line)
    g.append('line')
      .attr('x1', 0)
      .attr('y1', innerHeight / 2)
      .attr('x2', innerWidth)
      .attr('y2', innerHeight / 2)
      .attr('stroke', lineColor)
      .attr('stroke-width', 2)

    // Draw exons as rectangles
    const exonHeight = 30

    transcript.exons.forEach((exon) => {
      const x = xScale(exon.start)
      const width = xScale(exon.end) - xScale(exon.start)
      const color = exon.gene === 'A' ? data.gene_a.color : data.gene_b.color

      // Exon rectangle
      const rect = g.append('rect')
        .attr('x', x)
        .attr('y', innerHeight / 2 - exonHeight / 2)
        .attr('width', Math.max(width, 2))
        .attr('height', exonHeight)
        .attr('fill', color)
        .attr('fill-opacity', exon.is_coding ? 0.9 : 0.4)
        .attr('stroke', exon.is_coding ? color : lineColor)
        .attr('stroke-width', exon.is_coding ? 2 : 1)
        .attr('rx', 2)
        .style('cursor', 'pointer')

      // Tooltip events
      rect.on('mouseenter', function(event) {
        d3.select(this).attr('fill-opacity', 1)
        const rect = (event.target as SVGRectElement).getBoundingClientRect()
        const containerRect = container.getBoundingClientRect()
        setTooltip({
          visible: true,
          x: rect.left - containerRect.left + rect.width / 2,
          y: rect.top - containerRect.top - 10,
          content: exon
        })
      })
      rect.on('mouseleave', function() {
        d3.select(this).attr('fill-opacity', exon.is_coding ? 0.9 : 0.4)
        setTooltip(prev => ({ ...prev, visible: false }))
      })

      // Exon number label (for larger exons)
      if (width > 20) {
        g.append('text')
          .attr('x', x + width / 2)
          .attr('y', innerHeight / 2 + 4)
          .attr('text-anchor', 'middle')
          .attr('fill', 'white')
          .attr('font-size', '10px')
          .attr('font-weight', 'bold')
          .attr('pointer-events', 'none')
          .text(exon.rank)
      }
    })

    // Draw junction marker
    const junctionX = xScale(transcript.junction_position)
    g.append('line')
      .attr('x1', junctionX)
      .attr('y1', innerHeight / 2 - exonHeight - 10)
      .attr('x2', junctionX)
      .attr('y2', innerHeight / 2 + exonHeight + 10)
      .attr('stroke', '#EF4444')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '4,2')

    g.append('text')
      .attr('x', junctionX)
      .attr('y', innerHeight / 2 - exonHeight - 15)
      .attr('text-anchor', 'middle')
      .attr('fill', '#EF4444')
      .attr('font-size', '11px')
      .attr('font-weight', 'bold')
      .text('Junction')

    // Draw CDS region indicator
    if (transcript.cds_start !== undefined && transcript.cds_end !== undefined) {
      const cdsStartX = xScale(transcript.cds_start)
      const cdsEndX = xScale(transcript.cds_end)

      g.append('rect')
        .attr('x', cdsStartX)
        .attr('y', innerHeight / 2 + exonHeight / 2 + 8)
        .attr('width', cdsEndX - cdsStartX)
        .attr('height', 4)
        .attr('fill', '#8B5CF6')
        .attr('rx', 2)

      g.append('text')
        .attr('x', (cdsStartX + cdsEndX) / 2)
        .attr('y', innerHeight / 2 + exonHeight / 2 + 22)
        .attr('text-anchor', 'middle')
        .attr('fill', '#8B5CF6')
        .attr('font-size', '10px')
        .text('CDS')
    }

    // Gene labels
    const geneAExons = transcript.exons.filter(e => e.gene === 'A')
    const geneBExons = transcript.exons.filter(e => e.gene === 'B')

    if (geneAExons.length > 0) {
      const midA = (xScale(geneAExons[0].start) + xScale(geneAExons[geneAExons.length - 1].end)) / 2
      g.append('text')
        .attr('x', midA)
        .attr('y', -15)
        .attr('text-anchor', 'middle')
        .attr('fill', data.gene_a.color)
        .attr('font-size', '12px')
        .attr('font-weight', 'bold')
        .text(data.gene_a.symbol)
    }

    if (geneBExons.length > 0) {
      const midB = (xScale(geneBExons[0].start) + xScale(geneBExons[geneBExons.length - 1].end)) / 2
      g.append('text')
        .attr('x', midB)
        .attr('y', -15)
        .attr('text-anchor', 'middle')
        .attr('fill', data.gene_b.color)
        .attr('font-size', '12px')
        .attr('font-weight', 'bold')
        .text(data.gene_b.symbol)
    }

    // Length scale
    g.append('text')
      .attr('x', innerWidth / 2)
      .attr('y', innerHeight + 25)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', '11px')
      .text(`Fusion transcript length: ${transcript.total_length.toLocaleString()} bp`)

  }, [data, theme])

  if (!data.fusion_transcript) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 text-center text-gray-500">
        Transcript data not available
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        Fusion Transcript
      </h3>
      <div ref={containerRef} className="relative">
        <svg ref={svgRef} className="w-full" />

        {/* Tooltip */}
        {tooltip.visible && tooltip.content && (
          <div
            className="absolute z-10 bg-gray-900 text-white text-xs rounded-lg p-2 pointer-events-none transform -translate-x-1/2 -translate-y-full"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            <div className="font-semibold">
              {tooltip.content.gene === 'A' ? data.gene_a.symbol : data.gene_b.symbol} Exon {tooltip.content.rank}
            </div>
            <div>Length: {tooltip.content.length.toLocaleString()} bp</div>
            <div>{tooltip.content.is_coding ? 'Coding' : 'Non-coding'}</div>
            <div className="text-gray-400 text-[10px]">
              Original: {tooltip.content.original_genomic_start.toLocaleString()}-{tooltip.content.original_genomic_end.toLocaleString()}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 mt-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded" style={{ backgroundColor: data.gene_a.color, opacity: 0.9 }} />
          <span className="text-gray-600 dark:text-gray-400">{data.gene_a.symbol} coding</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded" style={{ backgroundColor: data.gene_a.color, opacity: 0.4 }} />
          <span className="text-gray-600 dark:text-gray-400">UTR</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded" style={{ backgroundColor: data.gene_b.color, opacity: 0.9 }} />
          <span className="text-gray-600 dark:text-gray-400">{data.gene_b.symbol} coding</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 bg-red-500" />
          <span className="text-gray-600 dark:text-gray-400">Junction</span>
        </div>
      </div>
    </div>
  )
}
