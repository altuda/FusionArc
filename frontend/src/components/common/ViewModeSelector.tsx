import { ViewMode } from '../visualization/ProteinSchematic'

interface ViewModeSelectorProps {
  value: ViewMode
  onChange: (mode: ViewMode) => void
}

const modes: { id: ViewMode; label: string }[] = [
  { id: 'fusion', label: 'Fusion Protein' },
  { id: 'full', label: 'Full Proteins' },
  { id: 'stacked', label: 'Stacked' },
]

export default function ViewModeSelector({ value, onChange }: ViewModeSelectorProps) {
  return (
    <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
      {modes.map((mode) => (
        <button
          key={mode.id}
          onClick={() => onChange(mode.id)}
          className={`px-3 py-1.5 text-sm font-medium transition-colors ${
            value === mode.id
              ? 'bg-primary-600 text-white'
              : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
        >
          {mode.label}
        </button>
      ))}
    </div>
  )
}
