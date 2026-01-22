import { useState } from 'react'
import Button from '../common/Button'
import { FusionManualInput } from '../../api/client'

interface ManualInputProps {
  onSubmit: (data: FusionManualInput) => void
  isLoading?: boolean
}

export default function ManualInput({ onSubmit, isLoading }: ManualInputProps) {
  const [formData, setFormData] = useState<FusionManualInput>({
    gene_a_symbol: '',
    gene_a_breakpoint: '',
    gene_b_symbol: '',
    gene_b_breakpoint: '',
    junction_reads: undefined,
    spanning_reads: undefined,
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

  const validateBreakpoint = (value: string): boolean => {
    const pattern = /^chr[\dXY]+:\d+:[+-]$/
    return pattern.test(value)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const newErrors: Record<string, string> = {}

    if (!formData.gene_a_symbol.trim()) {
      newErrors.gene_a_symbol = 'Gene A symbol is required'
    }
    if (!formData.gene_b_symbol.trim()) {
      newErrors.gene_b_symbol = 'Gene B symbol is required'
    }
    if (!validateBreakpoint(formData.gene_a_breakpoint)) {
      newErrors.gene_a_breakpoint = 'Invalid format. Use chr:pos:strand (e.g., chr22:23632600:+)'
    }
    if (!validateBreakpoint(formData.gene_b_breakpoint)) {
      newErrors.gene_b_breakpoint = 'Invalid format. Use chr:pos:strand (e.g., chr9:130854064:-)'
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    setErrors({})
    onSubmit(formData)
  }

  const handleChange = (field: keyof FusionManualInput, value: string | number | undefined) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors(prev => {
        const { [field]: _, ...rest } = prev
        return rest
      })
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
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
              onChange={(e) => handleChange('gene_a_symbol', e.target.value.toUpperCase())}
              placeholder="e.g., BCR"
              className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                ${errors.gene_a_symbol ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'}
                focus:outline-none focus:ring-2 focus:ring-primary-500`}
            />
            {errors.gene_a_symbol && (
              <p className="mt-1 text-sm text-red-500">{errors.gene_a_symbol}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Breakpoint
            </label>
            <input
              type="text"
              value={formData.gene_a_breakpoint}
              onChange={(e) => handleChange('gene_a_breakpoint', e.target.value)}
              placeholder="chr22:23632600:+"
              className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                ${errors.gene_a_breakpoint ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'}
                focus:outline-none focus:ring-2 focus:ring-primary-500`}
            />
            {errors.gene_a_breakpoint && (
              <p className="mt-1 text-sm text-red-500">{errors.gene_a_breakpoint}</p>
            )}
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
              onChange={(e) => handleChange('gene_b_symbol', e.target.value.toUpperCase())}
              placeholder="e.g., ABL1"
              className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                ${errors.gene_b_symbol ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'}
                focus:outline-none focus:ring-2 focus:ring-primary-500`}
            />
            {errors.gene_b_symbol && (
              <p className="mt-1 text-sm text-red-500">{errors.gene_b_symbol}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Breakpoint
            </label>
            <input
              type="text"
              value={formData.gene_b_breakpoint}
              onChange={(e) => handleChange('gene_b_breakpoint', e.target.value)}
              placeholder="chr9:130854064:-"
              className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                ${errors.gene_b_breakpoint ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'}
                focus:outline-none focus:ring-2 focus:ring-primary-500`}
            />
            {errors.gene_b_breakpoint && (
              <p className="mt-1 text-sm text-red-500">{errors.gene_b_breakpoint}</p>
            )}
          </div>
        </div>
      </div>

      {/* Optional Fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Junction Reads (optional)
          </label>
          <input
            type="number"
            value={formData.junction_reads || ''}
            onChange={(e) => handleChange('junction_reads', e.target.value ? parseInt(e.target.value) : undefined)}
            placeholder="e.g., 50"
            min="0"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Spanning Reads (optional)
          </label>
          <input
            type="number"
            value={formData.spanning_reads || ''}
            onChange={(e) => handleChange('spanning_reads', e.target.value ? parseInt(e.target.value) : undefined)}
            placeholder="e.g., 30"
            min="0"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={isLoading}>
          {isLoading ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Analyzing...
            </>
          ) : (
            'Analyze Fusion'
          )}
        </Button>
      </div>
    </form>
  )
}
