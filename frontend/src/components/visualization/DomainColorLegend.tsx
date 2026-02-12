import { useMemo } from 'react'
import { DomainInfo } from '../../api/client'
import { DomainColorMap } from '../../utils/domainColors'
import { inferFeatureType } from '../../utils/featureType'
import { TYPE_COLORS, SOURCE_COLORS as SOURCE_COLOR_MAP } from '../../utils/colorConstants'

interface DomainColorLegendProps {
  domains: DomainInfo[]
  colorMap: DomainColorMap
  title?: string
  compact?: boolean
  sourceFilter?: string[]  // Filter by sources (empty = show all)
  showLost?: boolean  // Show lost domains (for stacked/full views)
}

export interface LegendItem {
  name: string
  color: string
  is_kinase: boolean
  is_lost?: boolean  // Domain was lost in the fusion
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
  sourceFilter = [],
  showLost = false
}: DomainColorLegendProps) {
  // Get unique domains by name, filtered by source
  const uniqueDomains = useMemo(() => {
    const seen = new Set<string>()
    const unique: LegendItem[] = []

    for (const domain of domains) {
      // Skip lost domains unless showLost is enabled
      const isLost = domain.status === 'lost'
      if (isLost && !showLost) continue

      // Apply source filter
      if (sourceFilter.length > 0 && !sourceFilter.includes(domain.source)) continue

      const normalizedName = domain.name.toLowerCase().trim()
      if (!seen.has(normalizedName)) {
        seen.add(normalizedName)
        unique.push({
          name: domain.name,
          color: domain.is_kinase ? '#EF4444' : colorMap.getColor(domain.name),
          is_kinase: domain.is_kinase,
          is_lost: isLost
        })
      }
    }

    // Sort: retained first, then lost; kinases first within each group
    return unique.sort((a, b) => {
      // Lost domains go to the end
      if (a.is_lost && !b.is_lost) return 1
      if (!a.is_lost && b.is_lost) return -1
      // Kinases first within retained/lost groups
      if (a.is_kinase && !b.is_kinase) return -1
      if (!a.is_kinase && b.is_kinase) return 1
      return a.name.localeCompare(b.name)
    })
  }, [domains, colorMap, sourceFilter, showLost])

  if (uniqueDomains.length === 0) return null

  if (compact) {
    return (
      <div className="flex flex-wrap gap-1">
        {uniqueDomains.map((domain) => {
          // Muted styling for lost domains
          const opacity = domain.is_lost ? 0.4 : 1
          const displayColor = domain.color
          return (
            <div
              key={domain.name + (domain.is_lost ? '-lost' : '')}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
              style={{
                backgroundColor: `${displayColor}${domain.is_lost ? '10' : '20'}`,
                border: `1px solid ${displayColor}`,
                color: displayColor,
                opacity
              }}
              title={domain.is_lost ? `${domain.name} (lost in fusion)` : domain.name}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: displayColor }}
              />
              <span className="truncate max-w-[100px]">
                {domain.name.length > 15 ? domain.name.slice(0, 15) + '...' : domain.name}
                {domain.is_lost && <span className="ml-1 opacity-70">(lost)</span>}
              </span>
            </div>
          )
        })}
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
            key={domain.name + (domain.is_lost ? '-lost' : '')}
            className="flex items-center gap-2"
            style={{ opacity: domain.is_lost ? 0.5 : 1 }}
            title={domain.is_lost ? `${domain.name} (lost in fusion)` : domain.name}
          >
            <span
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: domain.color }}
            />
            <span
              className="text-xs text-gray-600 dark:text-gray-400 truncate"
            >
              {domain.name}
              {domain.is_kinase && (
                <span className="text-red-500 ml-1">(kinase)</span>
              )}
              {domain.is_lost && (
                <span className="text-gray-400 ml-1">(lost)</span>
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
    columnWidth = 250,  // Increased to accommodate full domain names
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

    // Text - show full domain name without truncation for exports
    const displayName = item.name
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
  sourceFilter: string[] = [],
  showLost: boolean = false
): LegendItem[] {
  const seen = new Set<string>()
  const items: LegendItem[] = []

  for (const domain of domains) {
    const isLost = domain.status === 'lost'
    if (isLost && !showLost) continue
    if (sourceFilter.length > 0 && !sourceFilter.includes(domain.source)) continue

    const normalizedName = domain.name.toLowerCase().trim()
    if (!seen.has(normalizedName)) {
      seen.add(normalizedName)
      items.push({
        name: domain.name,
        color: domain.is_kinase ? '#EF4444' : colorMap.getColor(domain.name),
        is_kinase: domain.is_kinase,
        is_lost: isLost
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

// Interface for genomic location data used in exports
export interface GenomicLocationInfo {
  geneA: {
    symbol: string
    chromosome?: string
    breakpoint?: number
    strand?: string
    breakpointLocation?: string  // "exon 5", "intron 3"
  }
  geneB: {
    symbol: string
    chromosome?: string
    breakpoint?: number
    strand?: string
    breakpointLocation?: string
  }
  genomeBuild?: 'hg19' | 'hg38'
}

/**
 * Generate SVG markup for genomic coordinates header.
 * Shows genome build, and breakpoint info for both genes.
 */
export function generateGenomicLocationSVG(
  location: GenomicLocationInfo,
  options: {
    x?: number
    y?: number
    fontSize?: number
  } = {}
): { svg: string; height: number } {
  const {
    x = 10,
    y = 16,
    fontSize = 12
  } = options

  const lines: string[] = []
  let currentY = y

  // Gene colors matching the visualization
  const geneAColor = '#3B82F6'  // Blue for 5' gene
  const geneBColor = '#10B981'  // Green for 3' gene
  const labelColor = '#374151'

  // Title line with genome build
  const buildLabel = location.genomeBuild || 'hg38'
  lines.push(`<text x="${x}" y="${currentY}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold" fill="${labelColor}">Genomic Coordinates (${buildLabel})</text>`)
  currentY += fontSize + 6

  // Format breakpoint with commas
  const formatBreakpoint = (bp?: number) => bp ? bp.toLocaleString() : '?'

  // Gene A line (5' partner)
  const geneAInfo = location.geneA
  let geneAText = `5': ${geneAInfo.symbol}`
  if (geneAInfo.chromosome) {
    geneAText += ` chr${geneAInfo.chromosome}:${formatBreakpoint(geneAInfo.breakpoint)}`
  }
  if (geneAInfo.strand) {
    geneAText += ` (${geneAInfo.strand})`
  }
  if (geneAInfo.breakpointLocation) {
    geneAText += ` [${geneAInfo.breakpointLocation}]`
  }
  lines.push(`<text x="${x}" y="${currentY}" font-family="Arial, sans-serif" font-size="${fontSize}" fill="${geneAColor}">${escapeXml(geneAText)}</text>`)
  currentY += fontSize + 4

  // Gene B line (3' partner)
  const geneBInfo = location.geneB
  let geneBText = `3': ${geneBInfo.symbol}`
  if (geneBInfo.chromosome) {
    geneBText += ` chr${geneBInfo.chromosome}:${formatBreakpoint(geneBInfo.breakpoint)}`
  }
  if (geneBInfo.strand) {
    geneBText += ` (${geneBInfo.strand})`
  }
  if (geneBInfo.breakpointLocation) {
    geneBText += ` [${geneBInfo.breakpointLocation}]`
  }
  lines.push(`<text x="${x}" y="${currentY}" font-family="Arial, sans-serif" font-size="${fontSize}" fill="${geneBColor}">${escapeXml(geneBText)}</text>`)
  currentY += fontSize + 8  // Extra padding after the header

  return {
    svg: lines.join('\n'),
    height: currentY - y + 8  // Total height used
  }
}

// Feature type colors with labels, derived from shared TYPE_COLORS
const FEATURE_TYPE_LABELS: Record<string, string> = {
  'kinase': 'Kinase', 'domain': 'Domain', 'family': 'Family',
  'homologous_superfamily': 'Homologous Superfamily', 'repeat': 'Repeat',
  'site': 'Site', 'signal_peptide': 'Signal Peptide', 'transmembrane': 'Transmembrane',
  'coiled_coil': 'Coiled Coil', 'low_complexity': 'Low Complexity',
  'disorder': 'Disorder', 'structure': 'Structure',
}

export const FEATURE_TYPE_COLORS: Record<string, { color: string; label: string }> =
  Object.fromEntries(
    Object.entries(FEATURE_TYPE_LABELS).map(([key, label]) => [
      key,
      { color: TYPE_COLORS[key] || '#6366F1', label },
    ])
  )

// Database source colors with labels, derived from shared SOURCE_COLOR_MAP
const SOURCE_LABEL_MAP: Record<string, string> = {
  'Pfam': 'Pfam', 'SMART': 'SMART', 'Superfamily': 'Superfamily',
  'CDD': 'CDD', 'PANTHER': 'PANTHER', 'Gene3D': 'Gene3D',
  'Prosite_profiles': 'PROSITE Profiles', 'Prosite_patterns': 'PROSITE Patterns',
  'SignalP': 'SignalP', 'Phobius': 'Phobius', 'PRINTS': 'PRINTS',
  'MobiDBLite': 'MobiDB-lite', 'Seg': 'SEG', 'ncoils': 'Ncoils',
  'InterPro': 'InterPro',
}

export const SOURCE_COLORS: Record<string, { color: string; label: string }> =
  Object.fromEntries(
    Object.entries(SOURCE_LABEL_MAP).map(([key, label]) => [
      key,
      { color: SOURCE_COLOR_MAP[key] || '#6366F1', label },
    ])
  )

/**
 * Legend for feature type coloring mode.
 * Shows only the feature types present in the provided domains.
 */
export function FeatureTypeLegend({
  compact = false,
  domains = [],
  sourceFilter = []
}: {
  compact?: boolean
  domains?: DomainInfo[]
  sourceFilter?: string[]
}) {
  // Get unique feature types from the domains
  const presentTypes = useMemo(() => {
    const types = new Set<string>()
    for (const domain of domains) {
      // Apply source filter
      if (sourceFilter.length > 0 && !sourceFilter.includes(domain.source)) continue

      if (domain.is_kinase) {
        types.add('kinase')
      } else {
        const featureType = inferFeatureType(domain.name, domain.source)
        types.add(featureType)
      }
    }
    return types
  }, [domains, sourceFilter])

  // Filter to only show types that are present
  const items = Object.entries(FEATURE_TYPE_COLORS).filter(([key]) => presentTypes.has(key))

  if (items.length === 0) return null

  if (compact) {
    return (
      <div className="flex flex-wrap gap-1">
        {items.map(([key, { color, label }]) => (
          <div
            key={key}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
            style={{
              backgroundColor: `${color}20`,
              border: `1px solid ${color}`,
              color: color,
            }}
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
            <span>{label}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        Feature Types
      </h4>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        {items.map(([key, { color, label }]) => (
          <div key={key} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
            <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Legend for database source coloring mode.
 * Shows all database sources with their colors.
 */
export function SourceLegend({ compact = false, sources = [] }: { compact?: boolean; sources?: string[] }) {
  // If sources provided, only show those; otherwise show all
  const items = sources.length > 0
    ? sources.map(s => {
        const normalized = Object.keys(SOURCE_COLORS).find(k => k.toLowerCase() === s.toLowerCase())
        return normalized ? [normalized, SOURCE_COLORS[normalized]] as [string, { color: string; label: string }] : null
      }).filter((item): item is [string, { color: string; label: string }] => item !== null)
    : Object.entries(SOURCE_COLORS)

  if (items.length === 0) return null

  if (compact) {
    return (
      <div className="flex flex-wrap gap-1">
        {items.map(([key, { color, label }]) => (
          <div
            key={key}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
            style={{
              backgroundColor: `${color}20`,
              border: `1px solid ${color}`,
              color: color,
            }}
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
            <span>{label}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        Database Sources
      </h4>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        {items.map(([key, { color, label }]) => (
          <div key={key} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
            <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
