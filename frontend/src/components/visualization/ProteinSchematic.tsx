import { useRef, useEffect, useState } from 'react'
import * as d3 from 'd3'
import { VisualizationData, DomainInfo } from '../../api/client'
import { useTheme } from '../../context/ThemeContext'

interface ProteinSchematicProps {
  data: VisualizationData
  showAllDomains?: boolean
  onSvgReady?: (svg: string) => void
}

const DOMAIN_COLORS = [
  '#440154', '#482878', '#3E4A89', '#31688E', '#26828E',
  '#1F9E89', '#35B779', '#6DCD59', '#B4DE2C', '#FDE725'
]

export default function ProteinSchematic({ data, showAllDomains = true, onSvgReady }: ProteinSchematicProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<{
    show: boolean
    x: number
    y: number
    content: { name: string; description?: string; start: number; end: number; status: string }
  } | null>(null)
  const { theme } = useTheme()

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return

    const container = containerRef.current
    const width = container.clientWidth
    const height = 200
    const margin = { top: 40, right: 40, bottom: 60, left: 40 }
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    // Clear previous content
    d3.select(svgRef.current).selectAll('*').remove()

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`)

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`)

    // Scale for protein length
    const xScale = d3.scaleLinear()
      .domain([0, data.total_length])
      .range([0, innerWidth])

    // Background
    const bgColor = theme === 'dark' ? '#1F2937' : '#FFFFFF'
    const textColor = theme === 'dark' ? '#F3F4F6' : '#1F2937'
    const lineColor = theme === 'dark' ? '#6B7280' : '#9CA3AF'

    // Backbone line
    g.append('line')
      .attr('x1', 0)
      .attr('y1', innerHeight / 2)
      .attr('x2', innerWidth)
      .attr('y2', innerHeight / 2)
      .attr('stroke', lineColor)
      .attr('stroke-width', 2)

    // Gene A region
    const geneAEnd = xScale(data.junction_position)
    g.append('rect')
      .attr('x', 0)
      .attr('y', innerHeight / 2 - 15)
      .attr('width', geneAEnd)
      .attr('height', 30)
      .attr('fill', data.gene_a.color)
      .attr('opacity', 0.3)
      .attr('rx', 4)

    // Gene B region
    g.append('rect')
      .attr('x', geneAEnd)
      .attr('y', innerHeight / 2 - 15)
      .attr('width', innerWidth - geneAEnd)
      .attr('height', 30)
      .attr('fill', data.gene_b.color)
      .attr('opacity', 0.3)
      .attr('rx', 4)

    // Draw domains
    const allDomains: { domain: DomainInfo; gene: 'a' | 'b'; color: string }[] = []

    data.gene_a.domains.forEach((domain, i) => {
      if (showAllDomains || domain.status !== 'lost') {
        allDomains.push({ domain, gene: 'a', color: DOMAIN_COLORS[i % DOMAIN_COLORS.length] })
      }
    })

    data.gene_b.domains.forEach((domain, i) => {
      if (showAllDomains || domain.status !== 'lost') {
        allDomains.push({ domain, gene: 'b', color: DOMAIN_COLORS[(i + data.gene_a.domains.length) % DOMAIN_COLORS.length] })
      }
    })

    allDomains.forEach(({ domain, gene, color }) => {
      let startPos: number, endPos: number

      if (gene === 'a') {
        startPos = xScale(domain.start)
        endPos = xScale(Math.min(domain.end, data.junction_position))
      } else {
        const offset = data.junction_position - (data.gene_b.aa_breakpoint || 0)
        startPos = xScale(Math.max(domain.start + offset, data.junction_position))
        endPos = xScale(domain.end + offset)
      }

      if (endPos > startPos) {
        const rect = g.append('rect')
          .attr('x', startPos)
          .attr('y', innerHeight / 2 - 20)
          .attr('width', endPos - startPos)
          .attr('height', 40)
          .attr('fill', color)
          .attr('rx', 6)
          .attr('opacity', domain.status === 'lost' ? 0.3 : 0.9)
          .attr('stroke', domain.is_kinase ? '#EF4444' : 'none')
          .attr('stroke-width', domain.is_kinase ? 3 : 0)
          .style('cursor', 'pointer')

        rect.on('mouseenter', function(event) {
          d3.select(this).attr('opacity', 1)
          const rect = (event.target as SVGRectElement).getBoundingClientRect()
          const containerRect = container.getBoundingClientRect()
          setTooltip({
            show: true,
            x: rect.left - containerRect.left + rect.width / 2,
            y: rect.top - containerRect.top - 10,
            content: {
              name: domain.name,
              description: domain.description,
              start: domain.start,
              end: domain.end,
              status: domain.status,
            },
          })
        })

        rect.on('mouseleave', function() {
          d3.select(this).attr('opacity', domain.status === 'lost' ? 0.3 : 0.9)
          setTooltip(null)
        })

        rect.on('click', () => {
          if (domain.accession) {
            window.open(`https://www.uniprot.org/uniprot/?query=${domain.accession}`, '_blank')
          }
        })
      }
    })

    // Junction marker (lightning bolt)
    const junctionX = geneAEnd
    const junctionPath = d3.path()
    junctionPath.moveTo(junctionX - 5, innerHeight / 2 - 35)
    junctionPath.lineTo(junctionX + 3, innerHeight / 2 - 10)
    junctionPath.lineTo(junctionX - 2, innerHeight / 2 - 10)
    junctionPath.lineTo(junctionX + 5, innerHeight / 2 + 35)
    junctionPath.lineTo(junctionX - 3, innerHeight / 2 + 10)
    junctionPath.lineTo(junctionX + 2, innerHeight / 2 + 10)
    junctionPath.closePath()

    g.append('path')
      .attr('d', junctionPath.toString())
      .attr('fill', '#EF4444')
      .attr('stroke', '#DC2626')
      .attr('stroke-width', 1)

    // Labels
    g.append('text')
      .attr('x', geneAEnd / 2)
      .attr('y', -15)
      .attr('text-anchor', 'middle')
      .attr('fill', data.gene_a.color)
      .attr('font-weight', 'bold')
      .attr('font-size', '14px')
      .text(data.gene_a.symbol)

    g.append('text')
      .attr('x', geneAEnd + (innerWidth - geneAEnd) / 2)
      .attr('y', -15)
      .attr('text-anchor', 'middle')
      .attr('fill', data.gene_b.color)
      .attr('font-weight', 'bold')
      .attr('font-size', '14px')
      .text(data.gene_b.symbol)

    // Frame status indicator
    const frameText = data.is_in_frame === true ? 'In-frame' : data.is_in_frame === false ? 'Out-of-frame' : 'Unknown'
    const frameColor = data.is_in_frame === true ? '#10B981' : data.is_in_frame === false ? '#EF4444' : '#6B7280'

    g.append('text')
      .attr('x', innerWidth / 2)
      .attr('y', innerHeight + 35)
      .attr('text-anchor', 'middle')
      .attr('fill', frameColor)
      .attr('font-weight', 'bold')
      .attr('font-size', '12px')
      .text(frameText)

    // Axis
    const xAxis = d3.axisBottom(xScale).ticks(10)
    g.append('g')
      .attr('transform', `translate(0, ${innerHeight / 2 + 25})`)
      .call(xAxis)
      .selectAll('text')
      .attr('fill', textColor)

    g.append('text')
      .attr('x', innerWidth / 2)
      .attr('y', innerHeight + 55)
      .attr('text-anchor', 'middle')
      .attr('fill', lineColor)
      .attr('font-size', '11px')
      .text('Amino acid position')

    // Callback with SVG content
    if (onSvgReady) {
      const svgContent = svgRef.current.outerHTML
      onSvgReady(svgContent)
    }

  }, [data, showAllDomains, theme, onSvgReady])

  return (
    <div ref={containerRef} className="relative w-full">
      <svg ref={svgRef} className="w-full" />

      {tooltip?.show && (
        <div
          className="absolute z-10 px-3 py-2 text-sm bg-gray-900 dark:bg-gray-700 text-white rounded-lg shadow-lg pointer-events-none transform -translate-x-1/2 -translate-y-full"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="font-semibold">{tooltip.content.name}</div>
          {tooltip.content.description && (
            <div className="text-gray-300 text-xs">{tooltip.content.description}</div>
          )}
          <div className="text-gray-300 text-xs">
            Position: {tooltip.content.start}-{tooltip.content.end}
          </div>
          <div className={`text-xs font-medium ${
            tooltip.content.status === 'retained' ? 'text-green-400' :
            tooltip.content.status === 'truncated' ? 'text-yellow-400' : 'text-red-400'
          }`}>
            Status: {tooltip.content.status}
          </div>
        </div>
      )}
    </div>
  )
}
