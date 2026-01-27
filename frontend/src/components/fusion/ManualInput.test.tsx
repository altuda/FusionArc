import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '../../test/testUtils'
import userEvent from '@testing-library/user-event'
import ManualInput from './ManualInput'

// Mock the API client
vi.mock('../../api/client', () => ({
  createBatchFusions: vi.fn(),
}))

// Mock useNavigate
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

describe('ManualInput', () => {
  const mockOnSubmit = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const fillFormWithValidData = async (user: ReturnType<typeof userEvent.setup>) => {
    // Fill Gene A
    await user.type(screen.getByPlaceholderText('BCR'), 'BCR')
    await user.type(screen.getByPlaceholderText('chr22'), 'chr22')
    await user.type(screen.getByPlaceholderText('23524427'), '23524427')

    // Fill Gene B
    await user.type(screen.getByPlaceholderText('ABL1'), 'ABL1')
    await user.type(screen.getByPlaceholderText('chr9'), 'chr9')
    await user.type(screen.getByPlaceholderText('133729449'), '133729449')
  }

  describe('form clearing after successful submission', () => {
    it('should clear input fields after successful form submission', async () => {
      const user = userEvent.setup()
      mockOnSubmit.mockResolvedValueOnce(undefined)

      render(<ManualInput onSubmit={mockOnSubmit} />)

      await fillFormWithValidData(user)

      // Verify fields are filled
      expect(screen.getByPlaceholderText('BCR')).toHaveValue('BCR')
      expect(screen.getByPlaceholderText('chr22')).toHaveValue('chr22')
      expect(screen.getByPlaceholderText('23524427')).toHaveValue('23524427')

      // Submit the form
      await user.click(screen.getByRole('button', { name: /analyze fusion/i }))

      // Wait for async submission
      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledTimes(1)
      })

      // Verify fields are cleared
      await waitFor(() => {
        expect(screen.getByPlaceholderText('BCR')).toHaveValue('')
        expect(screen.getByPlaceholderText('chr22')).toHaveValue('')
        expect(screen.getByPlaceholderText('23524427')).toHaveValue('')
        expect(screen.getByPlaceholderText('ABL1')).toHaveValue('')
        expect(screen.getByPlaceholderText('chr9')).toHaveValue('')
        expect(screen.getByPlaceholderText('133729449')).toHaveValue('')
      })
    })

    it('should set form data to initial state after successful submission', async () => {
      const user = userEvent.setup()
      mockOnSubmit.mockResolvedValueOnce(undefined)

      render(<ManualInput onSubmit={mockOnSubmit} />)

      await fillFormWithValidData(user)

      // Change strand selection to verify it resets
      const strandSelects = screen.getAllByRole('combobox')
      await user.selectOptions(strandSelects[0], '-')

      expect(strandSelects[0]).toHaveValue('-')

      // Submit
      await user.click(screen.getByRole('button', { name: /analyze fusion/i }))

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalled()
      })

      // Verify strand resets to default '+'
      await waitFor(() => {
        expect(strandSelects[0]).toHaveValue('+')
        expect(strandSelects[1]).toHaveValue('+')
      })
    })
  })

  describe('error handling', () => {
    it('should handle onSubmit rejection without crashing', async () => {
      const user = userEvent.setup()
      const error = new Error('Submission failed')
      mockOnSubmit.mockRejectedValueOnce(error)

      render(<ManualInput onSubmit={mockOnSubmit} />)

      await fillFormWithValidData(user)

      // Submit should not throw
      await user.click(screen.getByRole('button', { name: /analyze fusion/i }))

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledTimes(1)
      })

      // Component should still be rendered (not crashed)
      expect(screen.getByRole('button', { name: /analyze fusion/i })).toBeInTheDocument()
    })

    it('should NOT clear form data when submission fails', async () => {
      const user = userEvent.setup()
      mockOnSubmit.mockRejectedValueOnce(new Error('Failed'))

      render(<ManualInput onSubmit={mockOnSubmit} />)

      await fillFormWithValidData(user)

      // Verify fields are filled
      const geneAInput = screen.getByPlaceholderText('BCR')
      expect(geneAInput).toHaveValue('BCR')

      // Submit (will fail)
      await user.click(screen.getByRole('button', { name: /analyze fusion/i }))

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalled()
      })

      // Fields should still contain the data (not cleared on error)
      expect(geneAInput).toHaveValue('BCR')
    })
  })

  describe('submission data', () => {
    it('should call onSubmit with correct FusionManualInput data', async () => {
      const user = userEvent.setup()
      mockOnSubmit.mockResolvedValueOnce(undefined)

      render(<ManualInput onSubmit={mockOnSubmit} />)

      await fillFormWithValidData(user)

      await user.click(screen.getByRole('button', { name: /analyze fusion/i }))

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith({
          gene_a_symbol: 'BCR',
          gene_a_breakpoint: 'chr22:23524427:+',
          gene_b_symbol: 'ABL1',
          gene_b_breakpoint: 'chr9:133729449:+',
          genome_build: 'hg38',
        })
      })
    })
  })
})
