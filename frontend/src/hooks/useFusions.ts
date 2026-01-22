import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listFusions,
  getFusionDetail,
  getVisualizationData,
  createManualFusion,
  uploadFusionFile,
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

export function useCreateManualFusion() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: FusionManualInput) => createManualFusion(input),
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
