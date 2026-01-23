import { useMemo } from 'react'
import { DomainInfo } from '../../api/client'
import { DomainColorMap } from '../../utils/domainColors'

interface DomainColorLegendProps {
  domains: DomainInfo[]
  colorMap: DomainColorMap
  title?: string
  compact?: boolean
  sourceFilter?: string[]  // Filter by sources (empty = show all)
}

export interface LegendItem {
  name: string
  color: string
  is_kinase: boolean
}

/**
 * Displays a legend of domain colors for reference across visualizations.
 * Shows all unique domains with their assigned colors.
 * Reacts to source filter changes.
 */
export default function DomainColorLegend({
  domains,
  colorMap,
  title = 'Domain Colors',
  compact = false,
  sourceFilter = []
}: DomainColorLegendProps) {
  // Get unique domains by name, filtered by source
  const uniqueDomains = useMemo(() => {
    const seen = new Set<string>()
    const unique: LegendItem[] = []

    for (const domain of domains) {
      // Skip lost domains
      if (domain.status === 'lost') continue

      // Apply source filter
      if (sourceFilter.length > 0 && !sourceFilter.includes(domain.source)) continue

      const normalizedName = domain.name.toLowerCase().trim()
      if (!seen.has(normalizedName)) {
        seen.add(normalizedName)
        unique.push({
          name: domain.name,
          color: domain.is_kinase ? '#EF4444' : colorMap.getColor(domain.name),
          is_kinase: domain.is_kinase
        })
      }
    }

    // Sort by name, but kinases first
    return unique.sort((a, b) => {
      if (a.is_kinase && !b.is_kinase) return -1
      if (!a.is_kinase && b.is_kinase) return 1
      return a.name.localeCompare(b.name)
    })
  }, [domains, colorMap, sourceFilter])

  if (uniqueDomains.length === 0) return null

  if (compact) {
    return (
      <div className="flex flex-wrap gap-1">
        {uniqueDomains.map((domain) => (
          <div
            key={domain.name}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
            style={{
              backgroundColor: `${domain.color}20`,
              border: `1px solid ${domain.color}`,
              color: domain.color
            }}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: domain.color }}
            />
            <span className="truncate max-w-[100px]" title={domain.name}>
              {domain.name.length > 15 ? domain.name.slice(0, 15) + '...' : domain.name}
            </span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        {title}
      </h4>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        {uniqueDomains.map((domain) => (
          <div
            key={domain.name}
            className="flex items-center gap-2"
          >
            <span
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: domain.color }}
            />
            <span
              className="text-xs text-gray-600 dark:text-gray-400 truncate"
              title={domain.name}
            >
              {domain.name}
              {domain.is_kinase && (
                <span className="text-red-500 ml-1">(kinase)</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Generate SVG markup for a publication-ready legend.
 * Simple colored circles with domain names - standard for scientific figures.
 */
export function generateLegendSVG(
  legendItems: LegendItem[],
  options: {
    x?: number
    y?: number
    itemHeight?: number
    circleRadius?: number
    fontSize?: number
    columns?: number
    columnWidth?: number
    title?: string
  } = {}
): string {
  const {
    x = 10,
    y = 10,
    itemHeight = 18,
    circleRadius = 5,
    fontSize = 11,
    columns = 1,
    columnWidth = 180,
    title
  } = options

  const items = legendItems.filter(item => item.name && item.color)

  if (items.length === 0) return ''

  const lines: string[] = []
  let currentY = y

  // Add title if provided
  if (title) {
    lines.push(`<text x="${x}" y="${currentY}" font-family="Arial, sans-serif" font-size="${fontSize + 1}" font-weight="bold" fill="#374151">${title}</text>`)
    currentY += itemHeight + 4
  }

  // Calculate items per column
  const itemsPerColumn = Math.ceil(items.length / columns)

  items.forEach((item, index) => {
    const column = Math.floor(index / itemsPerColumn)
    const row = index % itemsPerColumn

    const itemX = x + (column * columnWidth)
    const itemY = currentY + (row * itemHeight)

    // Circle
    lines.push(`<circle cx="${itemX + circleRadius}" cy="${itemY}" r="${circleRadius}" fill="${item.color}"/>`)

    // Text
    const displayName = item.name.length > 25 ? item.name.slice(0, 25) + '...' : item.name
    const textX = itemX + circleRadius * 2 + 6
    lines.push(`<text x="${textX}" y="${itemY + 4}" font-family="Arial, sans-serif" font-size="${fontSize}" fill="#374151">${escapeXml(displayName)}</text>`)
  })

  return lines.join('\n')
}

/**
 * Get legend items from domains using the color map.
 * Use this to extract legend data for export.
 */
export function getLegendItems(
  domains: DomainInfo[],
  colorMap: DomainColorMap,
  sourceFilter: string[] = []
): LegendItem[] {
  const seen = new Set<string>()
  const items: LegendItem[] = []

  for (const domain of domains) {
    if (domain.status === 'lost') continue
    if (sourceFilter.length > 0 && !sourceFilter.includes(domain.source)) continue

    const normalizedName = domain.name.toLowerCase().trim()
    if (!seen.has(normalizedName)) {
      seen.add(normalizedName)
      items.push({
        name: domain.name,
        color: domain.is_kinase ? '#EF4444' : colorMap.getColor(domain.name),
        is_kinase: domain.is_kinase
      })
    }
  }

  return items.sort((a, b) => {
    if (a.is_kinase && !b.is_kinase) return -1
    if (!a.is_kinase && b.is_kinase) return 1
    return a.name.localeCompare(b.name)
  })
}

// Helper to escape XML special characters
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
