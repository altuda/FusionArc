from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class DomainInfo(BaseModel):
    name: str
    description: Optional[str] = None
    source: str  # Pfam, SMART, etc.
    accession: Optional[str] = None
    start: int
    end: int
    status: str  # retained, truncated, lost
    is_kinase: bool = False

    class Config:
        from_attributes = True


class FusionManualInput(BaseModel):
    gene_a_symbol: str = Field(..., description="Gene A symbol (e.g., BCR)")
    gene_a_breakpoint: str = Field(..., description="Breakpoint in format chr:pos:strand (e.g., chr22:23632600:+)")
    gene_b_symbol: str = Field(..., description="Gene B symbol (e.g., ABL1)")
    gene_b_breakpoint: str = Field(..., description="Breakpoint in format chr:pos:strand (e.g., chr9:130854064:-)")
    transcript_a_id: Optional[str] = None
    transcript_b_id: Optional[str] = None
    junction_reads: Optional[int] = None
    spanning_reads: Optional[int] = None


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
    created_at: datetime

    class Config:
        from_attributes = True


class FusionListResponse(BaseModel):
    fusions: List[FusionResponse]
    total: int


class GeneVisualizationData(BaseModel):
    symbol: str
    chromosome: Optional[str] = None
    breakpoint: Optional[int] = None
    strand: Optional[str] = None
    aa_breakpoint: Optional[int] = None
    protein_length: Optional[int] = None
    domains: List[DomainInfo] = []
    color: str


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
    created_at: datetime

    class Config:
        from_attributes = True


class VisualizationData(BaseModel):
    fusion_id: str
    fusion_name: str
    total_length: int
    gene_a: GeneVisualizationData
    gene_b: GeneVisualizationData
    junction_position: int
    is_in_frame: Optional[bool] = None


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
