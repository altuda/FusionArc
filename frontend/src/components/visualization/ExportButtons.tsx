import { useState } from 'react'
import Button from '../common/Button'
import { exportSVG, exportPNG, exportFASTA } from '../../api/client'

interface ExportButtonsProps {
  svgContent: string | null
  sequence: string | null
  fusionName: string
}

export default function ExportButtons({ svgContent, sequence, fusionName }: ExportButtonsProps) {
  const [isExporting, setIsExporting] = useState<string | null>(null)

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

  const handleExportSVG = async () => {
    if (!svgContent) return
    setIsExporting('svg')
    try {
      const blob = await exportSVG(svgContent, fusionName)
      downloadBlob(blob, `${fusionName}.svg`)
    } catch (error) {
      // Fall back to client-side export
      const blob = new Blob([svgContent], { type: 'image/svg+xml' })
      downloadBlob(blob, `${fusionName}.svg`)
    } finally {
      setIsExporting(null)
    }
  }

  const handleExportPNG = async () => {
    if (!svgContent) return
    setIsExporting('png')
    try {
      const blob = await exportPNG(svgContent, 1200, 400, fusionName)
      downloadBlob(blob, `${fusionName}.png`)
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
    <div className="flex flex-wrap gap-2">
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
