from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class ExonInfo(BaseModel):
    """Exon information for transcript visualization."""
    rank: int  # Exon number (1-based)
    start: int  # Genomic start
    end: int  # Genomic end
    cds_start: Optional[int] = None  # CDS start within exon (if coding)
    cds_end: Optional[int] = None  # CDS end within exon (if coding)
    is_coding: bool = False  # Whether this exon contains coding sequence
    status: str = "unknown"  # retained, partial, lost

    class Config:
        from_attributes = True


class DomainInfo(BaseModel):
    name: str
    description: Optional[str] = None
    source: str  # Pfam, SMART, etc.
    accession: Optional[str] = None
    start: int
    end: int
    score: Optional[float] = None  # E-value or hit score (lower is more significant)
    status: str  # retained, truncated, lost
    is_kinase: bool = False
    data_provider: Optional[str] = None  # InterPro, UniProt, or CDD

    class Config:
        from_attributes = True


class MutationInfo(BaseModel):
    """Mutation data for lollipop plot visualization."""
    position: int  # Amino acid position
    ref_aa: str = ""  # Reference amino acid
    alt_aa: str = ""  # Alternate amino acid
    type: str  # missense, nonsense, frameshift, silent, splice, inframe_indel, other
    label: str  # Display label (e.g., "V600E")
    count: int = 1  # Frequency/count
    source: str = "cBioPortal"  # Data source
    gene: str = ""  # Which gene this mutation is in (A or B)

    class Config:
        from_attributes = True


class MutationResponse(BaseModel):
    """Response containing mutations for both genes in a fusion."""
    gene_a_symbol: str
    gene_b_symbol: str
    mutations_a: List[MutationInfo] = []
    mutations_b: List[MutationInfo] = []
    total_count: int = 0


class FusionManualInput(BaseModel):
    gene_a_symbol: str = Field(..., description="Gene A symbol (e.g., BCR)")
    gene_a_breakpoint: str = Field(..., description="Breakpoint in format chr:pos:strand (e.g., chr22:23632600:+)")
    gene_b_symbol: str = Field(..., description="Gene B symbol (e.g., ABL1)")
    gene_b_breakpoint: str = Field(..., description="Breakpoint in format chr:pos:strand (e.g., chr9:130854064:-)")
    transcript_a_id: Optional[str] = None
    transcript_b_id: Optional[str] = None
    junction_reads: Optional[int] = None
    spanning_reads: Optional[int] = None
    genome_build: str = Field(default="hg38", description="Genome build: hg38 (GRCh38) or hg19 (GRCh37)")


class FusionCreate(BaseModel):
    gene_a_symbol: str
    gene_a_chromosome: str
    gene_a_breakpoint: int
    gene_a_strand: str
    gene_b_symbol: str
    gene_b_chromosome: str
    gene_b_breakpoint: int
    gene_b_strand: str
    junction_reads: Optional[int] = None
    spanning_reads: Optional[int] = None
    transcript_a_id: Optional[str] = None
    transcript_b_id: Optional[str] = None
    genome_build: str = "hg38"


class FusionResponse(BaseModel):
    id: str
    gene_a_symbol: str
    gene_b_symbol: str
    gene_a_chromosome: Optional[str] = None
    gene_b_chromosome: Optional[str] = None
    gene_a_breakpoint: Optional[int] = None
    gene_b_breakpoint: Optional[int] = None
    junction_reads: Optional[int] = None
    spanning_reads: Optional[int] = None
    is_in_frame: Optional[int] = None
    has_kinase_domain: int = 0
    kinase_retained: int = -1
    confidence: Optional[str] = None
    genome_build: str = "hg38"
    created_at: datetime

    class Config:
        from_attributes = True


class FusionListResponse(BaseModel):
    fusions: List[FusionResponse]
    total: int


class GeneVisualizationData(BaseModel):
    symbol: str
    chromosome: Optional[str] = None
    breakpoint: Optional[int] = None  # Genomic breakpoint
    strand: Optional[str] = None
    aa_breakpoint: Optional[int] = None  # Protein position
    protein_length: Optional[int] = None
    domains: List[DomainInfo] = []
    exons: List[ExonInfo] = []  # Exon data for transcript view
    transcript_id: Optional[str] = None
    gene_start: Optional[int] = None  # Genomic start of gene
    gene_end: Optional[int] = None  # Genomic end of gene
    cds_start: Optional[int] = None  # CDS start position
    cds_end: Optional[int] = None  # CDS end position
    color: str
    breakpoint_exon: Optional[int] = None  # Exon number at breakpoint (for display)
    breakpoint_location: Optional[str] = None  # "exon X" or "intron X" (for display)


class FusionDetailResponse(BaseModel):
    id: str
    session_id: str
    gene_a_symbol: str
    gene_b_symbol: str
    gene_a_chromosome: Optional[str] = None
    gene_b_chromosome: Optional[str] = None
    gene_a_breakpoint: Optional[int] = None
    gene_b_breakpoint: Optional[int] = None
    gene_a_strand: Optional[str] = None
    gene_b_strand: Optional[str] = None
    transcript_a_id: Optional[str] = None
    transcript_b_id: Optional[str] = None
    junction_reads: Optional[int] = None
    spanning_reads: Optional[int] = None
    is_in_frame: Optional[int] = None
    aa_breakpoint_a: Optional[int] = None
    aa_breakpoint_b: Optional[int] = None
    fusion_sequence: Optional[str] = None
    domains_a: Optional[List[DomainInfo]] = None
    domains_b: Optional[List[DomainInfo]] = None
    has_kinase_domain: int = 0
    kinase_retained: int = -1
    confidence: Optional[str] = None
    genome_build: str = "hg38"
    created_at: datetime

    class Config:
        from_attributes = True


class FusionExonInfo(BaseModel):
    """Exon in the fusion transcript."""
    gene: str  # "A" or "B"
    rank: int  # Original exon number
    start: int  # Position in fusion transcript (bp)
    end: int  # Position in fusion transcript (bp)
    length: int  # Length in bp
    is_coding: bool = False
    original_genomic_start: int
    original_genomic_end: int


class FusionTranscriptData(BaseModel):
    """Data for fusion transcript visualization."""
    total_length: int  # Total transcript length in bp
    cds_start: Optional[int] = None  # CDS start in fusion transcript
    cds_end: Optional[int] = None  # CDS end in fusion transcript
    junction_position: int  # Junction position in transcript (bp)
    exons: List[FusionExonInfo] = []


class VisualizationData(BaseModel):
    fusion_id: str
    fusion_name: str
    total_length: int  # Total protein length (AA)
    gene_a: GeneVisualizationData
    gene_b: GeneVisualizationData
    junction_position: int  # Protein junction position (AA)
    is_in_frame: Optional[bool] = None
    fusion_transcript: Optional[FusionTranscriptData] = None  # For transcript view


class SessionCreate(BaseModel):
    name: Optional[str] = None
    source: str = "manual"


class SessionResponse(BaseModel):
    id: str
    name: Optional[str] = None
    source: str
    created_at: datetime
    fusion_count: int = 0

    class Config:
        from_attributes = True
