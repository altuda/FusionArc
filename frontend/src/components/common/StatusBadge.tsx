export type BadgeStatus = 'positive' | 'negative' | 'unknown'

interface StatusBadgeProps {
  status: BadgeStatus
  label: string
}

const statusColors = {
  positive: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  negative: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  unknown: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
}

export default function StatusBadge({ status, label }: StatusBadgeProps) {
  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColors[status]}`}>
      {label}
    </span>
  )
}

// Helper to get frame status from fusion data
export function getFrameStatus(isInFrame: number | null | undefined): { status: BadgeStatus; label: string } {
  if (isInFrame === 1) return { status: 'positive', label: 'In-frame' }
  if (isInFrame === 0) return { status: 'negative', label: 'Out-of-frame' }
  return { status: 'unknown', label: 'Unknown' }
}

// Helper to get kinase status
export function getKinaseStatus(
  hasKinase: number | null | undefined,
  kinaseRetained: number | null | undefined
): { status: BadgeStatus; label: string } | null {
  if (hasKinase !== 1) return null

  if (kinaseRetained === 1) return { status: 'positive', label: 'Kinase retained' }
  if (kinaseRetained === 0) return { status: 'negative', label: 'Kinase lost' }
  return { status: 'unknown', label: 'Kinase ?' }
}
