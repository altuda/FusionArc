import { useMemo } from 'react'

interface SequenceViewProps {
  sequence: string
  junctionPosition: number
  geneAColor?: string
  geneBColor?: string
}

export default function SequenceView({
  sequence,
  junctionPosition,
  geneAColor = '#3B82F6',
  geneBColor = '#10B981',
}: SequenceViewProps) {
  const CHUNK_SIZE = 60
  const WINDOW_SIZE = 10 // Show 10 AA before and after junction

  const formattedSequence = useMemo(() => {
    const chunks: { text: string; position: number; hasJunction: boolean; junctionIdx: number }[] = []

    for (let i = 0; i < sequence.length; i += CHUNK_SIZE) {
      const chunk = sequence.slice(i, i + CHUNK_SIZE)
      const hasJunction = junctionPosition > i && junctionPosition <= i + CHUNK_SIZE
      const junctionIdx = hasJunction ? junctionPosition - i : -1

      chunks.push({
        text: chunk,
        position: i + 1,
        hasJunction,
        junctionIdx,
      })
    }

    return chunks
  }, [sequence, junctionPosition])

  const junctionContext = useMemo(() => {
    const start = Math.max(0, junctionPosition - WINDOW_SIZE)
    const end = Math.min(sequence.length, junctionPosition + WINDOW_SIZE)
    const beforeJunction = sequence.slice(start, junctionPosition)
    const afterJunction = sequence.slice(junctionPosition, end)

    return { beforeJunction, afterJunction, start: start + 1 }
  }, [sequence, junctionPosition])

  return (
    <div className="space-y-4">
      {/* Junction highlight */}
      <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Junction Region (position {junctionPosition})
        </h4>
        <div className="font-mono text-lg tracking-wider">
          <span className="text-gray-500 text-xs mr-2">{junctionContext.start}</span>
          <span style={{ color: geneAColor }}>{junctionContext.beforeJunction}</span>
          <span className="mx-1 text-red-500 font-bold">|</span>
          <span style={{ color: geneBColor }}>{junctionContext.afterJunction}</span>
        </div>
      </div>

      {/* Full sequence */}
      <div className="overflow-x-auto">
        <div className="font-mono text-sm leading-relaxed">
          {formattedSequence.map((chunk, idx) => (
            <div key={idx} className="flex">
              <span className="w-16 text-right text-gray-400 mr-4 select-none">
                {chunk.position}
              </span>
              <span className="flex-1">
                {chunk.hasJunction ? (
                  <>
                    <span style={{ color: geneAColor }}>
                      {chunk.text.slice(0, chunk.junctionIdx)}
                    </span>
                    <span className="text-red-500 font-bold">|</span>
                    <span style={{ color: geneBColor }}>
                      {chunk.text.slice(chunk.junctionIdx)}
                    </span>
                  </>
                ) : (
                  <span style={{ color: chunk.position <= junctionPosition ? geneAColor : geneBColor }}>
                    {chunk.text}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center space-x-6 text-sm text-gray-600 dark:text-gray-400">
        <div className="flex items-center">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: geneAColor }} />
          <span className="ml-2">Gene A sequence</span>
        </div>
        <div className="flex items-center">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: geneBColor }} />
          <span className="ml-2">Gene B sequence</span>
        </div>
        <div className="flex items-center">
          <span className="text-red-500 font-bold">|</span>
          <span className="ml-2">Junction</span>
        </div>
      </div>
    </div>
  )
}
