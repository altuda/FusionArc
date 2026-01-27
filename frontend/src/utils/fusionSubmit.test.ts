import { describe, it, expect, vi } from 'vitest'
import { handleFusionSubmission } from './fusionSubmit'

describe('handleFusionSubmission', () => {
  describe('Dashboard create fusion function re-throws error on failure', () => {
    it('should re-throw error when submission fails', async () => {
      const error = new Error('API Error: Failed to create fusion')
      const failingSubmitFn = vi.fn().mockRejectedValue(error)
      const onSuccess = vi.fn()

      await expect(
        handleFusionSubmission(failingSubmitFn, onSuccess)
      ).rejects.toThrow('API Error: Failed to create fusion')

      expect(failingSubmitFn).toHaveBeenCalledTimes(1)
      expect(onSuccess).not.toHaveBeenCalled()
    })

    it('should not call onSuccess when submission fails', async () => {
      const failingSubmitFn = vi.fn().mockRejectedValue(new Error('Failed'))
      const onSuccess = vi.fn()

      try {
        await handleFusionSubmission(failingSubmitFn, onSuccess)
      } catch {
        // Expected to throw
      }

      expect(onSuccess).not.toHaveBeenCalled()
    })

    it('should call onSuccess with result when submission succeeds', async () => {
      const result = { id: '123', session_id: 'session-456' }
      const successfulSubmitFn = vi.fn().mockResolvedValue(result)
      const onSuccess = vi.fn()

      await handleFusionSubmission(successfulSubmitFn, onSuccess)

      expect(successfulSubmitFn).toHaveBeenCalledTimes(1)
      expect(onSuccess).toHaveBeenCalledWith(result)
    })

    it('should not throw when submission succeeds', async () => {
      const successfulSubmitFn = vi.fn().mockResolvedValue({ id: '123' })

      await expect(
        handleFusionSubmission(successfulSubmitFn)
      ).resolves.not.toThrow()
    })

    it('should preserve the original error type', async () => {
      class CustomAPIError extends Error {
        constructor(public statusCode: number, message: string) {
          super(message)
          this.name = 'CustomAPIError'
        }
      }

      const customError = new CustomAPIError(500, 'Internal server error')
      const failingSubmitFn = vi.fn().mockRejectedValue(customError)

      try {
        await handleFusionSubmission(failingSubmitFn)
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(CustomAPIError)
        expect((e as CustomAPIError).statusCode).toBe(500)
      }
    })
  })
})
