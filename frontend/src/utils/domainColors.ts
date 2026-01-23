/**
 * Shared domain color utility for consistent coloring across all visualizations.
 * Uses a deterministic hash to assign colors to domain names, ensuring the same
 * domain (e.g., "DBL homology domain") always gets the same color.
 */

// Publication-quality color palette with good contrast
const DOMAIN_PALETTE = [
  '#3B82F6', // Blue
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#8B5CF6', // Violet
  '#EC4899', // Pink
  '#14B8A6', // Teal
  '#F97316', // Orange
  '#06B6D4', // Cyan
  '#84CC16', // Lime
  '#A855F7', // Purple
  '#0EA5E9', // Sky
  '#22C55E', // Green
  '#E11D48', // Rose
  '#6366F1', // Indigo
  '#64748B', // Slate
]

// Predefined colors for common domain types (for consistency)
const PREDEFINED_DOMAIN_COLORS: Record<string, string> = {
  // Kinase domains - always red
  'kinase': '#EF4444',
  'Protein kinase': '#EF4444',
  'Protein tyrosine kinase': '#EF4444',
  'Pkinase': '#EF4444',
  'Pkinase_Tyr': '#EF4444',
  'TyrKc': '#EF4444',
  'STKc': '#EF4444',
  'S_TKc': '#EF4444',

  // SH2/SH3 domains - purple shades
  'SH2': '#8B5CF6',
  'SH2 domain': '#8B5CF6',
  'SH3': '#A855F7',
  'SH3 domain': '#A855F7',

  // PH domains - teal
  'PH': '#14B8A6',
  'PH domain': '#14B8A6',
  'Pleckstrin homology': '#14B8A6',

  // DBL/RhoGEF - orange
  'DBL': '#F97316',
  'DBL homology': '#F97316',
  'DBL homology domain': '#F97316',
  'RhoGEF': '#F97316',

  // Zinc fingers - pink
  'Zinc finger': '#EC4899',
  'C2H2': '#EC4899',

  // EF-hand - cyan
  'EF-hand': '#06B6D4',
  'EF hand': '#06B6D4',

  // DNA binding - blue
  'DNA binding': '#3B82F6',
  'HTH': '#3B82F6',
  'Homeobox': '#3B82F6',

  // Transmembrane - slate
  'Transmembrane': '#64748B',
  'TM': '#64748B',

  // Coiled-coil - lime
  'Coiled-coil': '#84CC16',
  'Coiled coil': '#84CC16',

  // SAM domain - amber
  'SAM': '#F59E0B',
  'SAM domain': '#F59E0B',
}

/**
 * Simple hash function for strings
 */
function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash)
}

/**
 * Normalize domain name for consistent lookup
 */
function normalizeName(name: string): string {
  return name.toLowerCase().trim()
}

/**
 * Get color for a domain by name. Same domain name always returns same color.
 */
export function getDomainColor(domainName: string): string {
  // Check predefined colors first (case-insensitive partial match)
  const nameLower = domainName.toLowerCase()

  for (const [key, color] of Object.entries(PREDEFINED_DOMAIN_COLORS)) {
    if (nameLower.includes(key.toLowerCase())) {
      return color
    }
  }

  // Fall back to hash-based color assignment
  const hash = hashString(normalizeName(domainName))
  return DOMAIN_PALETTE[hash % DOMAIN_PALETTE.length]
}

/**
 * Domain color map class for caching colors across a visualization session.
 * Use this when you want to ensure consistent colors across multiple components.
 */
export class DomainColorMap {
  private colorMap: Map<string, string> = new Map()
  private usedColors: Set<string> = new Set()

  /**
   * Get or assign a color for a domain name
   */
  getColor(domainName: string): string {
    const normalizedName = normalizeName(domainName)

    // Return cached color if exists
    if (this.colorMap.has(normalizedName)) {
      return this.colorMap.get(normalizedName)!
    }

    // Check predefined colors
    const nameLower = domainName.toLowerCase()
    for (const [key, color] of Object.entries(PREDEFINED_DOMAIN_COLORS)) {
      if (nameLower.includes(key.toLowerCase())) {
        this.colorMap.set(normalizedName, color)
        this.usedColors.add(color)
        return color
      }
    }

    // Assign next available color from palette
    let color = getDomainColor(domainName)

    // If color already used, try to find an unused one
    if (this.usedColors.has(color)) {
      for (const paletteColor of DOMAIN_PALETTE) {
        if (!this.usedColors.has(paletteColor)) {
          color = paletteColor
          break
        }
      }
    }

    this.colorMap.set(normalizedName, color)
    this.usedColors.add(color)
    return color
  }

  /**
   * Pre-populate the color map with domain names from visualization data
   */
  preloadFromDomains(domains: { name: string }[]): void {
    domains.forEach(d => this.getColor(d.name))
  }

  /**
   * Get all assigned colors as a map
   */
  getColorMap(): Map<string, string> {
    return new Map(this.colorMap)
  }

  /**
   * Reset the color map
   */
  reset(): void {
    this.colorMap.clear()
    this.usedColors.clear()
  }
}

// Global instance for session-wide consistent colors
let globalColorMap: DomainColorMap | null = null

export function getGlobalDomainColorMap(): DomainColorMap {
  if (!globalColorMap) {
    globalColorMap = new DomainColorMap()
  }
  return globalColorMap
}

export function resetGlobalDomainColorMap(): void {
  globalColorMap = null
}

// Export palette for legend rendering
export { DOMAIN_PALETTE }
