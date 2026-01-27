/**
 * Wraps a fusion submission handler to ensure errors are properly re-thrown.
 * This allows consuming components (like ManualInput) to know when submission failed.
 */
export async function handleFusionSubmission<T>(
  submitFn: () => Promise<T>,
  onSuccess?: (result: T) => void
): Promise<void> {
  try {
    const result = await submitFn()
    onSuccess?.(result)
  } catch (error) {
    console.error('Failed to create fusion:', error)
    throw error  // Re-throw so caller knows submission failed
  }
}
