import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../common/Button'
import { FusionManualInput, GenomeBuild, createBatchFusions } from '../../api/client'

interface ManualInputProps {
  onSubmit: (data: FusionManualInput) => void
  isLoading?: boolean
}

type InputMode = 'form' | 'text'  // 'text' mode handles both single and batch input

// Unified format uses commas: chr22,23524427,+
// One-liner format: BCR,chr22,23524427,+::ABL1,chr9,133729449,+
// Batch format: multiple one-liners, one per line

export default function ManualInput({ onSubmit, isLoading }: ManualInputProps) {
  const navigate = useNavigate()
  const [inputMode, setInputMode] = useState<InputMode>('form')
  const [textInput, setTextInput] = useState('')
  const [genomeBuild, setGenomeBuild] = useState<GenomeBuild>('hg38')
  const [textLoading, setTextLoading] = useState(false)
  const [textError, setTextError] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    gene_a_symbol: '',
    gene_a_chr: '',
    gene_a_pos: '',
    gene_a_strand: '+',
    gene_b_symbol: '',
    gene_b_chr: '',
    gene_b_pos: '',
    gene_b_strand: '+',
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

  // Convert form data to one-liner
  const formToOneliner = () => {
    const { gene_a_symbol, gene_a_chr, gene_a_pos, gene_a_strand,
            gene_b_symbol, gene_b_chr, gene_b_pos, gene_b_strand } = formData

    if (gene_a_symbol && gene_a_chr && gene_a_pos && gene_b_symbol && gene_b_chr && gene_b_pos) {
      return `${gene_a_symbol},${gene_a_chr},${gene_a_pos},${gene_a_strand}::${gene_b_symbol},${gene_b_chr},${gene_b_pos},${gene_b_strand}`
    }
    return ''
  }

  // Parse one-liner to form data
  const parseOneliner = (value: string) => {
    // Format: BCR,chr22,23524427,+::ABL1,chr9,133729449,+
    const parts = value.split('::')
    if (parts.length !== 2) return null

    const parseGene = (part: string) => {
      const fields = part.split(',')
      if (fields.length !== 4) return null
      return {
        symbol: fields[0].trim().toUpperCase(),
        chr: fields[1].trim(),
        pos: fields[2].trim(),
        strand: fields[3].trim() as '+' | '-'
      }
    }

    const geneA = parseGene(parts[0])
    const geneB = parseGene(parts[1])

    if (!geneA || !geneB) return null

    return {
      gene_a_symbol: geneA.symbol,
      gene_a_chr: geneA.chr,
      gene_a_pos: geneA.pos,
      gene_a_strand: geneA.strand,
      gene_b_symbol: geneB.symbol,
      gene_b_chr: geneB.chr,
      gene_b_pos: geneB.pos,
      gene_b_strand: geneB.strand,
    }
  }

  // Parse text input to count valid fusions (handles single or multiple lines)
  const parseTextInput = (value: string) => {
    const lines = value.trim().split('\n').filter(line => line.trim())
    const validFusions: string[] = []

    for (const line of lines) {
      if (parseOneliner(line.trim())) {
        validFusions.push(line.trim())
      }
    }

    return validFusions
  }

  // Sync form to text input when form changes
  useEffect(() => {
    if (inputMode === 'form') {
      const oneliner = formToOneliner()
      if (oneliner) {
        setTextInput(oneliner)
      }
    }
  }, [formData, inputMode])

  const validateForm = () => {
    const newErrors: Record<string, string> = {}

    if (!formData.gene_a_symbol.trim()) {
      newErrors.gene_a_symbol = 'Required'
    }
    if (!formData.gene_a_chr.trim() || !formData.gene_a_chr.startsWith('chr')) {
      newErrors.gene_a_chr = 'Use format: chr22'
    }
    if (!formData.gene_a_pos.trim() || !/^\d+$/.test(formData.gene_a_pos)) {
      newErrors.gene_a_pos = 'Must be a number'
    }
    if (!formData.gene_b_symbol.trim()) {
      newErrors.gene_b_symbol = 'Required'
    }
    if (!formData.gene_b_chr.trim() || !formData.gene_b_chr.startsWith('chr')) {
      newErrors.gene_b_chr = 'Use format: chr9'
    }
    if (!formData.gene_b_pos.trim() || !/^\d+$/.test(formData.gene_b_pos)) {
      newErrors.gene_b_pos = 'Must be a number'
    }

    return newErrors
  }

  const validateTextInput = (): Record<string, string> => {
    const validFusions = parseTextInput(textInput)
    if (validFusions.length === 0) {
      return { text: 'No valid fusions found. Format: GENE,chr,pos,strand::GENE,chr,pos,strand' }
    }
    return {}
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (inputMode === 'text') {
      const newErrors = validateTextInput()
      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors)
        return
      }

      // Handle text submission (single or multiple fusions)
      setTextLoading(true)
      setTextError(null)
      try {
        const validFusions = parseTextInput(textInput)
        const batchContent = validFusions.map(line => {
          const parsed = parseOneliner(line)!
          return `${parsed.gene_a_symbol}::${parsed.gene_b_symbol}\t${parsed.gene_a_chr}:${parsed.gene_a_pos}:${parsed.gene_a_strand}\t${parsed.gene_b_chr}:${parsed.gene_b_pos}:${parsed.gene_b_strand}\t${genomeBuild}`
        }).join('\n')

        const session = await createBatchFusions(batchContent)
        navigate(`/session/${session.id}`)
      } catch (error) {
        setTextError(error instanceof Error ? error.message : 'Failed to create fusions')
      } finally {
        setTextLoading(false)
      }
      return
    }

    // Form mode
    const newErrors = validateForm()
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    // Build the submission data with unified format (using colons for backend compatibility)
    const data: FusionManualInput = {
      gene_a_symbol: formData.gene_a_symbol,
      gene_a_breakpoint: `${formData.gene_a_chr}:${formData.gene_a_pos}:${formData.gene_a_strand}`,
      gene_b_symbol: formData.gene_b_symbol,
      gene_b_breakpoint: `${formData.gene_b_chr}:${formData.gene_b_pos}:${formData.gene_b_strand}`,
      genome_build: genomeBuild,
    }

    setErrors({})
    onSubmit(data)
  }

  const handleFormChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors(prev => {
        const { [field]: _, ...rest } = prev
        return rest
      })
    }
  }

  const loadExample = () => {
    if (inputMode === 'text') {
      setTextInput(`BCR,chr22,23524427,+::ABL1,chr9,133729449,+
EML4,chr2,42522654,+::ALK,chr2,29446394,-
TMPRSS2,chr21,41498118,-::ERG,chr21,38380027,-`)
      setErrors({})
      setTextError(null)
    } else {
      const exampleData = {
        gene_a_symbol: 'BCR',
        gene_a_chr: 'chr22',
        gene_a_pos: '23524427',
        gene_a_strand: '+',
        gene_b_symbol: 'ABL1',
        gene_b_chr: 'chr9',
        gene_b_pos: '133729449',
        gene_b_strand: '+',
      }
      setFormData(exampleData)
      setTextInput('BCR,chr22,23524427,+::ABL1,chr9,133729449,+')
      setErrors({})
    }
  }

  const validFusionCount = parseTextInput(textInput).length

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Mode Toggle & Example */}
      <div className="flex items-center justify-between">
        <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
          <button
            type="button"
            onClick={() => setInputMode('form')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              inputMode === 'form'
                ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            Form
          </button>
          <button
            type="button"
            onClick={() => setInputMode('text')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              inputMode === 'text'
                ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            Text
          </button>
        </div>
        <button
          type="button"
          onClick={loadExample}
          className="text-sm text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
        >
          {inputMode === 'text' ? 'Load examples (3 fusions)' : 'Load example (BCR-ABL1)'}
        </button>
      </div>

      {/* Text Input Mode (single or multiple fusions) */}
      {inputMode === 'text' && (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Fusion(s) - one per line
          </label>
          <textarea
            value={textInput}
            onChange={(e) => {
              setTextInput(e.target.value)
              setErrors({})
              setTextError(null)
            }}
            placeholder={`BCR,chr22,23524427,+::ABL1,chr9,133729449,+
EML4,chr2,42522654,+::ALK,chr2,29446394,-
TMPRSS2,chr21,41498118,-::ERG,chr21,38380027,-`}
            rows={4}
            className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-sm
              ${errors.text ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'}
              focus:outline-none focus:ring-2 focus:ring-primary-500`}
          />
          {errors.text && (
            <p className="text-sm text-red-500">{errors.text}</p>
          )}
          {textError && (
            <p className="text-sm text-red-500">{textError}</p>
          )}
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>Format: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">GENE,chr,pos,strand::GENE,chr,pos,strand</code></span>
            {validFusionCount > 0 && (
              <span className="text-green-600 dark:text-green-400">
                {validFusionCount} valid fusion{validFusionCount !== 1 ? 's' : ''} detected
              </span>
            )}
          </div>
        </div>
      )}

      {/* Form Input Mode */}
      {inputMode === 'form' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Gene A Section */}
          <div className="space-y-4">
            <h4 className="font-medium text-gray-900 dark:text-white flex items-center">
              <span className="w-3 h-3 rounded-full bg-blue-500 mr-2"></span>
              Gene A (5' partner)
            </h4>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Gene Symbol
              </label>
              <input
                type="text"
                value={formData.gene_a_symbol}
                onChange={(e) => handleFormChange('gene_a_symbol', e.target.value.toUpperCase())}
                placeholder="BCR"
                className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                  ${errors.gene_a_symbol ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'}
                  focus:outline-none focus:ring-2 focus:ring-primary-500`}
              />
              {errors.gene_a_symbol && (
                <p className="mt-1 text-sm text-red-500">{errors.gene_a_symbol}</p>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Chromosome
                </label>
                <input
                  type="text"
                  value={formData.gene_a_chr}
                  onChange={(e) => handleFormChange('gene_a_chr', e.target.value.toLowerCase())}
                  placeholder="chr22"
                  className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                    ${errors.gene_a_chr ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'}
                    focus:outline-none focus:ring-2 focus:ring-primary-500`}
                />
              </div>
              <div className="col-span-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Position
                </label>
                <input
                  type="text"
                  value={formData.gene_a_pos}
                  onChange={(e) => handleFormChange('gene_a_pos', e.target.value.replace(/\D/g, ''))}
                  placeholder="23524427"
                  className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                    ${errors.gene_a_pos ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'}
                    focus:outline-none focus:ring-2 focus:ring-primary-500`}
                />
              </div>
              <div className="col-span-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Strand
                </label>
                <select
                  value={formData.gene_a_strand}
                  onChange={(e) => handleFormChange('gene_a_strand', e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="+">+</option>
                  <option value="-">-</option>
                </select>
              </div>
            </div>
          </div>

          {/* Gene B Section */}
          <div className="space-y-4">
            <h4 className="font-medium text-gray-900 dark:text-white flex items-center">
              <span className="w-3 h-3 rounded-full bg-green-500 mr-2"></span>
              Gene B (3' partner)
            </h4>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Gene Symbol
              </label>
              <input
                type="text"
                value={formData.gene_b_symbol}
                onChange={(e) => handleFormChange('gene_b_symbol', e.target.value.toUpperCase())}
                placeholder="ABL1"
                className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                  ${errors.gene_b_symbol ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'}
                  focus:outline-none focus:ring-2 focus:ring-primary-500`}
              />
              {errors.gene_b_symbol && (
                <p className="mt-1 text-sm text-red-500">{errors.gene_b_symbol}</p>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Chromosome
                </label>
                <input
                  type="text"
                  value={formData.gene_b_chr}
                  onChange={(e) => handleFormChange('gene_b_chr', e.target.value.toLowerCase())}
                  placeholder="chr9"
                  className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                    ${errors.gene_b_chr ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'}
                    focus:outline-none focus:ring-2 focus:ring-primary-500`}
                />
              </div>
              <div className="col-span-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Position
                </label>
                <input
                  type="text"
                  value={formData.gene_b_pos}
                  onChange={(e) => handleFormChange('gene_b_pos', e.target.value.replace(/\D/g, ''))}
                  placeholder="133729449"
                  className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                    ${errors.gene_b_pos ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'}
                    focus:outline-none focus:ring-2 focus:ring-primary-500`}
                />
              </div>
              <div className="col-span-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Strand
                </label>
                <select
                  value={formData.gene_b_strand}
                  onChange={(e) => handleFormChange('gene_b_strand', e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="+">+</option>
                  <option value="-">-</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* One-liner preview when in form mode */}
      {inputMode === 'form' && formToOneliner() && (
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">One-liner format:</p>
          <code className="text-sm text-gray-700 dark:text-gray-300 font-mono break-all">
            {formToOneliner()}
          </code>
        </div>
      )}

      {/* Genome Build */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Genome Build
        </label>
        <div className="flex items-center space-x-4">
          <label className="flex items-center">
            <input
              type="radio"
              name="genome_build"
              value="hg38"
              checked={genomeBuild === 'hg38'}
              onChange={(e) => setGenomeBuild(e.target.value as GenomeBuild)}
              className="mr-2 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              hg38 <span className="text-gray-500">(GRCh38)</span>
            </span>
          </label>
          <label className="flex items-center">
            <input
              type="radio"
              name="genome_build"
              value="hg19"
              checked={genomeBuild === 'hg19'}
              onChange={(e) => setGenomeBuild(e.target.value as GenomeBuild)}
              className="mr-2 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              hg19 <span className="text-gray-500">(GRCh37)</span>
            </span>
          </label>
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={isLoading || textLoading}>
          {(isLoading || textLoading) ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Analyzing...
            </>
          ) : inputMode === 'text' && validFusionCount > 1 ? (
            `Analyze ${validFusionCount} Fusions`
          ) : (
            'Analyze Fusion'
          )}
        </Button>
      </div>
    </form>
  )
}
