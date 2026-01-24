interface DatabaseFilterProps {
  sources: string[]
  selectedSources: string[]
  onToggle: (source: string) => void
}

export default function DatabaseFilter({ sources, selectedSources, onToggle }: DatabaseFilterProps) {
  if (sources.length <= 1) return null

  // Empty selectedSources means "show all"
  const isActive = (source: string) =>
    selectedSources.length === 0 || selectedSources.includes(source)

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-gray-200 dark:border-gray-700">
      <span className="text-xs text-gray-500 dark:text-gray-400 mr-1">Databases:</span>
      {sources.map((source) => (
        <button
          key={source}
          onClick={() => onToggle(source)}
          className={`px-2 py-0.5 text-xs rounded transition-colors ${
            isActive(source)
              ? 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300 border border-primary-300 dark:border-primary-700'
              : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500 border border-gray-300 dark:border-gray-600'
          }`}
        >
          {source}
        </button>
      ))}
    </div>
  )
}
