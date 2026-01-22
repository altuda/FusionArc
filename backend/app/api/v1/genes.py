from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
from app.database import get_db
from app.models import Gene, Protein, Domain
from app.schemas.gene import GeneSearchResult, ProteinDomainsResponse, DomainResponse
from app.external.ensembl import get_ensembl_client

router = APIRouter()


@router.get("/search", response_model=List[GeneSearchResult])
async def search_genes(
    q: str,
    limit: int = 10,
    db: AsyncSession = Depends(get_db)
):
    """Search genes by symbol."""
    if len(q) < 2:
        raise HTTPException(400, "Query must be at least 2 characters")

    # First check cache
    result = await db.execute(
        select(Gene)
        .where(Gene.symbol.ilike(f"%{q}%"))
        .limit(limit)
    )
    genes = result.scalars().all()

    if genes:
        return [GeneSearchResult.model_validate(g) for g in genes]

    # If not in cache, search Ensembl
    ensembl = get_ensembl_client()
    gene_data = await ensembl.search_gene(q)

    if gene_data:
        return [GeneSearchResult(
            id=gene_data.get("id", ""),
            symbol=gene_data.get("display_name", q),
            name=gene_data.get("description"),
            chromosome=gene_data.get("seq_region_name")
        )]

    return []


@router.get("/proteins/{protein_id}/domains", response_model=ProteinDomainsResponse)
async def get_protein_domains(
    protein_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get protein domains by protein ID."""
    # Check cache
    result = await db.execute(
        select(Protein).where(Protein.id == protein_id)
    )
    protein = result.scalar_one_or_none()

    if protein:
        domain_result = await db.execute(
            select(Domain).where(Domain.protein_id == protein_id)
        )
        domains = domain_result.scalars().all()

        return ProteinDomainsResponse(
            protein_id=protein.id,
            transcript_id=protein.transcript_id,
            length=protein.length or 0,
            domains=[DomainResponse.model_validate(d) for d in domains]
        )

    # Fetch from Ensembl
    ensembl = get_ensembl_client()
    features = await ensembl.get_protein_features(protein_id)

    if not features:
        raise HTTPException(404, "Protein not found")

    domains = []
    for feat in features:
        domains.append(DomainResponse(
            name=feat.get("description", feat.get("type", "Unknown")),
            description=feat.get("description"),
            source=feat.get("type", "Unknown"),
            accession=feat.get("id"),
            start=feat.get("start", 0),
            end=feat.get("end", 0)
        ))

    return ProteinDomainsResponse(
        protein_id=protein_id,
        transcript_id="",
        length=0,
        domains=domains
    )
