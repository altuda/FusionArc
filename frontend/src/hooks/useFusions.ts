import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listFusions,
  getFusionDetail,
  getVisualizationData,
  createManualFusion,
  uploadFusionFile,
  getFusionMutations,
  FusionManualInput,
} from '../api/client'

export function useFusions(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['fusions', sessionId],
    queryFn: () => listFusions(sessionId!),
    enabled: !!sessionId,
  })
}

export function useFusionDetail(sessionId: string | undefined, fusionId: string | undefined) {
  return useQuery({
    queryKey: ['fusion', sessionId, fusionId],
    queryFn: () => getFusionDetail(sessionId!, fusionId!),
    enabled: !!sessionId && !!fusionId,
  })
}

export function useVisualizationData(sessionId: string | undefined, fusionId: string | undefined) {
  return useQuery({
    queryKey: ['visualization', sessionId, fusionId],
    queryFn: () => getVisualizationData(sessionId!, fusionId!),
    enabled: !!sessionId && !!fusionId,
  })
}

interface CreateManualFusionVariables {
  input: FusionManualInput
  sessionId?: string
}

export function useCreateManualFusion() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ input, sessionId }: CreateManualFusionVariables) =>
      createManualFusion(input, sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fusions'] })
    },
  })
}

export function useUploadFusion() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (file: File) => uploadFusionFile(file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fusions'] })
    },
  })
}

export function useFusionMutations(sessionId: string | undefined, fusionId: string | undefined) {
  return useQuery({
    queryKey: ['mutations', sessionId, fusionId],
    queryFn: () => getFusionMutations(sessionId!, fusionId!),
    enabled: !!sessionId && !!fusionId,
    staleTime: 1000 * 60 * 10, // Cache for 10 minutes (mutations don't change often)
  })
}
