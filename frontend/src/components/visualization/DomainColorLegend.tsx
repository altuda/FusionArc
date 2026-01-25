import { useMemo } from 'react'
import { DomainInfo } from '../../api/client'
import { DomainColorMap } from '../../utils/domainColors'

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

// Feature type colors (matching ProteinSchematic)
export const FEATURE_TYPE_COLORS: Record<string, { color: string; label: string }> = {
  'kinase': { color: '#EF4444', label: 'Kinase' },
  'domain': { color: '#3B82F6', label: 'Domain' },
  'family': { color: '#8B5CF6', label: 'Family' },
  'homologous_superfamily': { color: '#F59E0B', label: 'Homologous Superfamily' },
  'repeat': { color: '#10B981', label: 'Repeat' },
  'site': { color: '#EC4899', label: 'Site' },
  'signal_peptide': { color: '#F97316', label: 'Signal Peptide' },
  'transmembrane': { color: '#14B8A6', label: 'Transmembrane' },
  'coiled_coil': { color: '#0EA5E9', label: 'Coiled Coil' },
  'low_complexity': { color: '#78716C', label: 'Low Complexity' },
  'disorder': { color: '#64748B', label: 'Disorder' },
  'structure': { color: '#22C55E', label: 'Structure' },
}

// Infer feature type from domain name and source (matching ProteinSchematic logic)
export function inferFeatureType(name: string, source: string): string {
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

// Database source colors (matching ProteinSchematic)
export const SOURCE_COLORS: Record<string, { color: string; label: string }> = {
  'Pfam': { color: '#3B82F6', label: 'Pfam' },
  'SMART': { color: '#10B981', label: 'SMART' },
  'Superfamily': { color: '#F59E0B', label: 'Superfamily' },
  'CDD': { color: '#8B5CF6', label: 'CDD' },
  'PANTHER': { color: '#EC4899', label: 'PANTHER' },
  'Gene3D': { color: '#06B6D4', label: 'Gene3D' },
  'Prosite_profiles': { color: '#84CC16', label: 'PROSITE Profiles' },
  'Prosite_patterns': { color: '#84CC16', label: 'PROSITE Patterns' },
  'SignalP': { color: '#F97316', label: 'SignalP' },
  'Phobius': { color: '#14B8A6', label: 'Phobius' },
  'PRINTS': { color: '#A855F7', label: 'PRINTS' },
  'MobiDBLite': { color: '#64748B', label: 'MobiDB-lite' },
  'Seg': { color: '#78716C', label: 'SEG' },
  'ncoils': { color: '#0EA5E9', label: 'Ncoils' },
  'InterPro': { color: '#059669', label: 'InterPro' },
}

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
