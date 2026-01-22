from pydantic import BaseModel
from typing import Optional, List


class GeneSearchResult(BaseModel):
    id: str
    symbol: str
    name: Optional[str] = None
    chromosome: Optional[str] = None

    class Config:
        from_attributes = True


class TranscriptInfo(BaseModel):
    id: str
    is_canonical: bool = False
    biotype: Optional[str] = None


class DomainResponse(BaseModel):
    name: str
    description: Optional[str] = None
    source: str
    accession: Optional[str] = None
    start: int
    end: int

    class Config:
        from_attributes = True


class ProteinDomainsResponse(BaseModel):
    protein_id: str
    transcript_id: str
    length: int
    domains: List[DomainResponse]
