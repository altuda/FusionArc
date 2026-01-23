import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1'

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Types
export interface ExonInfo {
  rank: number
  start: number  // Genomic start
  end: number    // Genomic end
  cds_start?: number
  cds_end?: number
  is_coding: boolean
  status: string  // retained, partial, lost
}

export interface DomainInfo {
  name: string
  description?: string
  source: string
  accession?: string
  start: number
  end: number
  score?: number  // E-value or hit score (lower is more significant)
  status: string
  is_kinase: boolean
}

export interface FusionExonInfo {
  gene: 'A' | 'B'
  rank: number
  start: number  // Position in fusion transcript
  end: number
  length: number
  is_coding: boolean
  original_genomic_start: number
  original_genomic_end: number
}

export interface FusionTranscriptData {
  total_length: number
  cds_start?: number
  cds_end?: number
  junction_position: number
  exons: FusionExonInfo[]
}

export type MutationType =
  | 'missense'
  | 'nonsense'
  | 'frameshift'
  | 'silent'
  | 'splice'
  | 'inframe_indel'
  | 'other'

export interface MutationInfo {
  position: number  // Amino acid position
  ref_aa: string    // Reference amino acid
  alt_aa: string    // Alternate amino acid
  type: MutationType
  label: string     // e.g., "V600E"
  count?: number    // Frequency/count
  source?: string   // Data source (COSMIC, ClinVar, etc.)
  clinical_significance?: string
  gene?: string     // "A" or "B" - which gene this mutation is in
}

export interface MutationResponse {
  gene_a_symbol: string
  gene_b_symbol: string
  mutations_a: MutationInfo[]
  mutations_b: MutationInfo[]
  total_count: number
}

export type GenomeBuild = 'hg38' | 'hg19'

export interface FusionManualInput {
  gene_a_symbol: string
  gene_a_breakpoint: string
  gene_b_symbol: string
  gene_b_breakpoint: string
  transcript_a_id?: string
  transcript_b_id?: string
  junction_reads?: number
  spanning_reads?: number
  genome_build?: GenomeBuild
}

export interface FusionResponse {
  id: string
  gene_a_symbol: string
  gene_b_symbol: string
  gene_a_chromosome?: string
  gene_b_chromosome?: string
  gene_a_breakpoint?: number
  gene_b_breakpoint?: number
  junction_reads?: number
  spanning_reads?: number
  is_in_frame?: number
  has_kinase_domain: number
  kinase_retained: number
  confidence?: string
  created_at: string
}

export interface FusionDetailResponse extends FusionResponse {
  session_id: string
  gene_a_strand?: string
  gene_b_strand?: string
  transcript_a_id?: string
  transcript_b_id?: string
  aa_breakpoint_a?: number
  aa_breakpoint_b?: number
  fusion_sequence?: string
  domains_a?: DomainInfo[]
  domains_b?: DomainInfo[]
  genome_build?: GenomeBuild
}

export interface SessionResponse {
  id: string
  name?: string
  source: string
  created_at: string
  fusion_count: number
}

export interface GeneVisualizationData {
  symbol: string
  chromosome?: string
  breakpoint?: number  // Genomic breakpoint
  strand?: string
  aa_breakpoint?: number
  protein_length?: number
  domains: DomainInfo[]
  exons: ExonInfo[]
  transcript_id?: string
  gene_start?: number
  gene_end?: number
  cds_start?: number
  cds_end?: number
  color: string
  breakpoint_exon?: number  // Exon number at breakpoint
  breakpoint_location?: string  // "exon X" or "intron X"
}

export interface VisualizationData {
  fusion_id: string
  fusion_name: string
  total_length: number  // Protein length
  gene_a: GeneVisualizationData
  gene_b: GeneVisualizationData
  junction_position: number  // Protein junction
  is_in_frame?: boolean
  fusion_transcript?: FusionTranscriptData
}

// API functions
export async function uploadFusionFile(file: File): Promise<SessionResponse> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await apiClient.post<SessionResponse>('/fusions/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return response.data
}

export async function createManualFusion(input: FusionManualInput): Promise<FusionDetailResponse> {
  const response = await apiClient.post<FusionDetailResponse>('/fusions/manual', input)
  return response.data
}

export async function createBatchFusions(content: string): Promise<SessionResponse> {
  const response = await apiClient.post<SessionResponse>('/fusions/batch', content, {
    headers: { 'Content-Type': 'text/plain' },
  })
  return response.data
}

export async function listFusions(sessionId: string): Promise<{ fusions: FusionResponse[]; total: number }> {
  const response = await apiClient.get(`/fusions/${sessionId}`)
  return response.data
}

export async function getFusionDetail(sessionId: string, fusionId: string): Promise<FusionDetailResponse> {
  const response = await apiClient.get<FusionDetailResponse>(`/fusions/${sessionId}/${fusionId}`)
  return response.data
}

export async function getVisualizationData(sessionId: string, fusionId: string): Promise<VisualizationData> {
  const response = await apiClient.get<VisualizationData>(`/fusions/${sessionId}/${fusionId}/visualization`)
  return response.data
}

export async function exportSVG(svgContent: string, filename?: string): Promise<Blob> {
  const response = await apiClient.post('/export/svg', { svg_content: svgContent, filename }, {
    responseType: 'blob',
  })
  return response.data
}

export async function exportPNG(svgContent: string, width?: number, height?: number, filename?: string): Promise<Blob> {
  const response = await apiClient.post('/export/png', { svg_content: svgContent, width, height, filename }, {
    responseType: 'blob',
  })
  return response.data
}

export async function exportFASTA(sequence: string, header: string, filename?: string): Promise<Blob> {
  const response = await apiClient.post('/export/fasta', { sequence, header, filename }, {
    responseType: 'blob',
  })
  return response.data
}

export async function refreshFusionDomains(sessionId: string, fusionId: string): Promise<FusionDetailResponse> {
  const response = await apiClient.post<FusionDetailResponse>(`/fusions/${sessionId}/${fusionId}/refresh-domains`)
  return response.data
}

export async function getSessionDomains(sessionId: string): Promise<string[]> {
  const response = await apiClient.get<string[]>(`/fusions/${sessionId}/domains`)
  return response.data
}

export async function getFusionMutations(sessionId: string, fusionId: string): Promise<MutationResponse> {
  const response = await apiClient.get<MutationResponse>(`/fusions/${sessionId}/${fusionId}/mutations`)
  return response.data
}
