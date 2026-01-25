import { useState } from 'react'
import Button from '../common/Button'
import { exportSVG, exportPNG, exportFASTA } from '../../api/client'
import { LegendItem, generateLegendSVG } from './DomainColorLegend'

interface ExportButtonsProps {
  svgContent: string | null
  sequence: string | null
  fusionName: string
  legendItems?: LegendItem[]  // Optional legend items for publication-ready export
  includeLegend?: boolean     // Whether to include legend in export
}

export default function ExportButtons({
  svgContent,
  sequence,
  fusionName,
  legendItems = [],
  includeLegend = true
}: ExportButtonsProps) {
  const [isExporting, setIsExporting] = useState<string | null>(null)
  const [showLegendOption, setShowLegendOption] = useState(includeLegend)

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  /**
   * Append legend to SVG content for publication-ready export
   */
  const appendLegendToSVG = (svg: string, items: LegendItem[]): string => {
    if (items.length === 0) return svg

    // Parse the SVG to get dimensions
    const parser = new DOMParser()
    const doc = parser.parseFromString(svg, 'image/svg+xml')
    const svgElement = doc.querySelector('svg')

    if (!svgElement) return svg

    // Get current dimensions
    const currentHeight = parseFloat(svgElement.getAttribute('height') || '200')

    // Calculate legend dimensions
    const columns = items.length > 8 ? 2 : 1
    const itemsPerColumn = Math.ceil(items.length / columns)
    const legendHeight = itemsPerColumn * 18 + 30  // 18px per item + title + padding

    // Create new SVG with extra space for legend
    const newHeight = currentHeight + legendHeight + 20
    svgElement.setAttribute('height', String(newHeight))

    // Update viewBox if present
    const viewBox = svgElement.getAttribute('viewBox')
    if (viewBox) {
      const parts = viewBox.split(' ')
      if (parts.length === 4) {
        parts[3] = String(newHeight)
        svgElement.setAttribute('viewBox', parts.join(' '))
      }
    }

    // Generate legend SVG elements
    const legendSVG = generateLegendSVG(items, {
      x: 40,
      y: currentHeight + 15,
      columns,
      columnWidth: 250,  // Match wider width for full domain names
      title: 'Protein Domains'
    })

    // Create a group for the legend
    const legendGroup = doc.createElementNS('http://www.w3.org/2000/svg', 'g')
    legendGroup.setAttribute('class', 'domain-legend')
    legendGroup.innerHTML = legendSVG

    svgElement.appendChild(legendGroup)

    // Serialize back to string
    const serializer = new XMLSerializer()
    return serializer.serializeToString(doc)
  }

  const handleExportSVG = async () => {
    if (!svgContent) return
    setIsExporting('svg')
    try {
      let finalSvg = svgContent

      // Add legend if enabled and items available
      if (showLegendOption && legendItems.length > 0) {
        finalSvg = appendLegendToSVG(svgContent, legendItems)
      }

      const blob = await exportSVG(finalSvg, fusionName)
      downloadBlob(blob, `${fusionName}.svg`)
    } catch (error) {
      // Fall back to client-side export
      let finalSvg = svgContent
      if (showLegendOption && legendItems.length > 0) {
        finalSvg = appendLegendToSVG(svgContent, legendItems)
      }
      const blob = new Blob([finalSvg], { type: 'image/svg+xml' })
      downloadBlob(blob, `${fusionName}.svg`)
    } finally {
      setIsExporting(null)
    }
  }

  /**
   * Convert SVG string to PNG blob using canvas (client-side)
   */
  const svgToPng = (svgString: string, width: number, height: number): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image()
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(svgBlob)

      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          URL.revokeObjectURL(url)
          reject(new Error('Failed to get canvas context'))
          return
        }

        // White background
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, width, height)
        ctx.drawImage(img, 0, 0, width, height)

        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url)
          if (blob) resolve(blob)
          else reject(new Error('Canvas toBlob failed'))
        }, 'image/png')
      }

      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('Failed to load SVG image'))
      }

      img.src = url
    })
  }

  /**
   * Ensure SVG has explicit width/height attributes for canvas rendering
   */
  const prepareSvgForCanvas = (svg: string, width: number, height: number): string => {
    const parser = new DOMParser()
    const doc = parser.parseFromString(svg, 'image/svg+xml')
    const svgElement = doc.querySelector('svg')

    if (!svgElement) return svg

    // Set explicit dimensions
    svgElement.setAttribute('width', String(width))
    svgElement.setAttribute('height', String(height))

    // Add xmlns if missing (required for img.src loading)
    if (!svgElement.getAttribute('xmlns')) {
      svgElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    }

    const serializer = new XMLSerializer()
    return serializer.serializeToString(doc)
  }

  const handleExportPNG = async () => {
    if (!svgContent) return
    setIsExporting('png')
    try {
      let finalSvg = svgContent

      // Add legend if enabled
      if (showLegendOption && legendItems.length > 0) {
        finalSvg = appendLegendToSVG(svgContent, legendItems)
      }

      // Calculate appropriate dimensions
      const heightBonus = showLegendOption && legendItems.length > 0
        ? Math.ceil(legendItems.length / 2) * 18 + 50
        : 0

      const width = 1200
      const height = 400 + heightBonus

      // Prepare SVG with explicit dimensions for canvas
      finalSvg = prepareSvgForCanvas(finalSvg, width, height)

      // Try client-side PNG conversion first
      try {
        const blob = await svgToPng(finalSvg, width, height)
        downloadBlob(blob, `${fusionName}.png`)
      } catch (clientError) {
        console.warn('Client-side PNG export failed, trying server:', clientError)
        // Fall back to server-side export
        const blob = await exportPNG(finalSvg, width, height, fusionName)
        downloadBlob(blob, `${fusionName}.png`)
      }
    } catch (error) {
      console.error('PNG export failed:', error)
      alert('PNG export failed. Please try SVG export instead.')
    } finally {
      setIsExporting(null)
    }
  }

  const handleExportFASTA = async () => {
    if (!sequence) return
    setIsExporting('fasta')
    try {
      const header = `${fusionName} fusion protein`
      const blob = await exportFASTA(sequence, header, fusionName)
      downloadBlob(blob, `${fusionName}.fasta`)
    } catch (error) {
      // Fall back to client-side export
      const lines = [
        `>${fusionName} fusion protein`,
        ...sequence.match(/.{1,60}/g) || [sequence]
      ]
      const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
      downloadBlob(blob, `${fusionName}.fasta`)
    } finally {
      setIsExporting(null)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Legend toggle (only show if legend items available) */}
      {legendItems.length > 0 && (
        <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 mr-2">
          <input
            type="checkbox"
            checked={showLegendOption}
            onChange={(e) => setShowLegendOption(e.target.checked)}
            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 h-3.5 w-3.5"
          />
          Include legend
        </label>
      )}

      <Button
        variant="secondary"
        size="sm"
        onClick={handleExportSVG}
        disabled={!svgContent || isExporting !== null}
      >
        {isExporting === 'svg' ? (
          <span className="flex items-center">
            <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Exporting...
          </span>
        ) : (
          <>
            <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            SVG
          </>
        )}
      </Button>

      <Button
        variant="secondary"
        size="sm"
        onClick={handleExportPNG}
        disabled={!svgContent || isExporting !== null}
      >
        {isExporting === 'png' ? (
          <span className="flex items-center">
            <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Exporting...
          </span>
        ) : (
          <>
            <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            PNG
          </>
        )}
      </Button>

      <Button
        variant="secondary"
        size="sm"
        onClick={handleExportFASTA}
        disabled={!sequence || isExporting !== null}
      >
        {isExporting === 'fasta' ? (
          <span className="flex items-center">
            <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Exporting...
          </span>
        ) : (
          <>
            <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            FASTA
          </>
        )}
      </Button>
    </div>
  )
}
