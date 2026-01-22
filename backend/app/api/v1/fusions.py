from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import List, Optional
from app.database import get_db
from app.models import Session, Fusion
from app.schemas.fusion import (
    FusionManualInput,
    FusionResponse,
    FusionListResponse,
    FusionDetailResponse,
    SessionCreate,
    SessionResponse,
    VisualizationData,
    GeneVisualizationData,
    DomainInfo
)
from app.core.parsers import StarFusionParser, ArribaParser, ManualInputParser
from app.core.fusion_builder import FusionBuilder
from app.external.ensembl import get_ensembl_client

router = APIRouter()


def detect_file_format(content: str) -> str:
    """Auto-detect fusion file format."""
    lines = content.strip().split("\n")
    for line in lines:
        if line.startswith("#FusionName") or "FusionName" in line:
            return "star_fusion"
        if line.startswith("#gene1") or "gene1\tgene2" in line:
            return "arriba"
    return "unknown"


@router.post("/upload", response_model=SessionResponse)
async def upload_fusion_file(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db)
):
    """Upload a STAR-Fusion or Arriba file."""
    content = await file.read()
    content_str = content.decode("utf-8")

    # Detect format
    file_format = detect_file_format(content_str)
    if file_format == "unknown":
        raise HTTPException(400, "Unknown file format. Expected STAR-Fusion or Arriba TSV.")

    # Parse file
    if file_format == "star_fusion":
        parser = StarFusionParser()
    else:
        parser = ArribaParser()

    fusion_data_list = parser.parse(content_str)

    if not fusion_data_list:
        raise HTTPException(400, "No fusions found in file.")

    # Create session
    session = Session(
        name=file.filename,
        source=file_format
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    # Build fusions
    ensembl = get_ensembl_client()
    builder = FusionBuilder(db, ensembl)

    for fusion_data in fusion_data_list:
        try:
            await builder.build_fusion(fusion_data, session.id)
        except Exception as e:
            # Log error but continue with other fusions
            print(f"Error building fusion: {e}")

    # Get fusion count
    result = await db.execute(
        select(func.count(Fusion.id)).where(Fusion.session_id == session.id)
    )
    fusion_count = result.scalar() or 0

    return SessionResponse(
        id=session.id,
        name=session.name,
        source=session.source,
        created_at=session.created_at,
        fusion_count=fusion_count
    )


@router.post("/manual", response_model=FusionDetailResponse)
async def create_manual_fusion(
    input_data: FusionManualInput,
    db: AsyncSession = Depends(get_db)
):
    """Create a fusion from manual input."""
    # Parse manual input
    fusion_data = ManualInputParser.parse_manual_input(input_data)

    # Create or get default session
    result = await db.execute(
        select(Session).where(Session.source == "manual").order_by(Session.created_at.desc())
    )
    session = result.scalars().first()

    if not session:
        session = Session(name="Manual Input", source="manual")
        db.add(session)
        await db.commit()
        await db.refresh(session)

    # Build fusion
    ensembl = get_ensembl_client()
    builder = FusionBuilder(db, ensembl)
    fusion = await builder.build_fusion(fusion_data, session.id)

    return await _fusion_to_detail_response(fusion)


@router.post("/batch", response_model=SessionResponse)
async def create_batch_fusions(
    content: str,
    db: AsyncSession = Depends(get_db)
):
    """Create multiple fusions from batch text input."""
    parser = ManualInputParser()
    fusion_data_list = parser.parse(content)

    if not fusion_data_list:
        raise HTTPException(400, "No valid fusions found in input.")

    # Create session
    session = Session(name="Batch Input", source="manual")
    db.add(session)
    await db.commit()
    await db.refresh(session)

    # Build fusions
    ensembl = get_ensembl_client()
    builder = FusionBuilder(db, ensembl)

    for fusion_data in fusion_data_list:
        try:
            await builder.build_fusion(fusion_data, session.id)
        except Exception as e:
            print(f"Error building fusion: {e}")

    result = await db.execute(
        select(func.count(Fusion.id)).where(Fusion.session_id == session.id)
    )
    fusion_count = result.scalar() or 0

    return SessionResponse(
        id=session.id,
        name=session.name,
        source=session.source,
        created_at=session.created_at,
        fusion_count=fusion_count
    )


@router.get("/{session_id}", response_model=FusionListResponse)
async def list_fusions(
    session_id: str,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db)
):
    """List all fusions in a session."""
    result = await db.execute(
        select(Fusion)
        .where(Fusion.session_id == session_id)
        .offset(skip)
        .limit(limit)
    )
    fusions = result.scalars().all()

    # Get total count
    count_result = await db.execute(
        select(func.count(Fusion.id)).where(Fusion.session_id == session_id)
    )
    total = count_result.scalar() or 0

    return FusionListResponse(
        fusions=[FusionResponse.model_validate(f) for f in fusions],
        total=total
    )


@router.get("/{session_id}/{fusion_id}", response_model=FusionDetailResponse)
async def get_fusion_detail(
    session_id: str,
    fusion_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get detailed fusion information."""
    result = await db.execute(
        select(Fusion)
        .where(Fusion.session_id == session_id)
        .where(Fusion.id == fusion_id)
    )
    fusion = result.scalar_one_or_none()

    if not fusion:
        raise HTTPException(404, "Fusion not found")

    return await _fusion_to_detail_response(fusion)


@router.get("/{session_id}/{fusion_id}/visualization", response_model=VisualizationData)
async def get_visualization_data(
    session_id: str,
    fusion_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get D3-ready visualization data for a fusion."""
    result = await db.execute(
        select(Fusion)
        .where(Fusion.session_id == session_id)
        .where(Fusion.id == fusion_id)
    )
    fusion = result.scalar_one_or_none()

    if not fusion:
        raise HTTPException(404, "Fusion not found")

    # Calculate protein lengths and junction position
    domains_a = [DomainInfo(**d) for d in (fusion.domains_a or [])]
    domains_b = [DomainInfo(**d) for d in (fusion.domains_b or [])]

    # Estimate protein lengths from domains if not available
    protein_length_a = fusion.aa_breakpoint_a or (max(d.end for d in domains_a) if domains_a else 100)
    protein_length_b = (max(d.end for d in domains_b) if domains_b else 100) - (fusion.aa_breakpoint_b or 0)

    junction_position = fusion.aa_breakpoint_a or protein_length_a
    total_length = junction_position + protein_length_b

    return VisualizationData(
        fusion_id=fusion.id,
        fusion_name=f"{fusion.gene_a_symbol}--{fusion.gene_b_symbol}",
        total_length=total_length,
        gene_a=GeneVisualizationData(
            symbol=fusion.gene_a_symbol,
            chromosome=fusion.gene_a_chromosome,
            breakpoint=fusion.gene_a_breakpoint,
            strand=fusion.gene_a_strand,
            aa_breakpoint=fusion.aa_breakpoint_a,
            protein_length=protein_length_a,
            domains=domains_a,
            color="#3B82F6"  # Blue
        ),
        gene_b=GeneVisualizationData(
            symbol=fusion.gene_b_symbol,
            chromosome=fusion.gene_b_chromosome,
            breakpoint=fusion.gene_b_breakpoint,
            strand=fusion.gene_b_strand,
            aa_breakpoint=fusion.aa_breakpoint_b,
            protein_length=protein_length_b,
            domains=domains_b,
            color="#10B981"  # Green
        ),
        junction_position=junction_position,
        is_in_frame=fusion.is_in_frame == 1 if fusion.is_in_frame != -1 else None
    )


async def _fusion_to_detail_response(fusion: Fusion) -> FusionDetailResponse:
    """Convert Fusion model to detail response."""
    domains_a = [DomainInfo(**d) for d in (fusion.domains_a or [])]
    domains_b = [DomainInfo(**d) for d in (fusion.domains_b or [])]

    return FusionDetailResponse(
        id=fusion.id,
        session_id=fusion.session_id,
        gene_a_symbol=fusion.gene_a_symbol,
        gene_b_symbol=fusion.gene_b_symbol,
        gene_a_chromosome=fusion.gene_a_chromosome,
        gene_b_chromosome=fusion.gene_b_chromosome,
        gene_a_breakpoint=fusion.gene_a_breakpoint,
        gene_b_breakpoint=fusion.gene_b_breakpoint,
        gene_a_strand=fusion.gene_a_strand,
        gene_b_strand=fusion.gene_b_strand,
        transcript_a_id=fusion.transcript_a_id,
        transcript_b_id=fusion.transcript_b_id,
        junction_reads=fusion.junction_reads,
        spanning_reads=fusion.spanning_reads,
        is_in_frame=fusion.is_in_frame,
        aa_breakpoint_a=fusion.aa_breakpoint_a,
        aa_breakpoint_b=fusion.aa_breakpoint_b,
        fusion_sequence=fusion.fusion_sequence,
        domains_a=domains_a,
        domains_b=domains_b,
        has_kinase_domain=fusion.has_kinase_domain,
        kinase_retained=fusion.kinase_retained,
        confidence=fusion.confidence,
        created_at=fusion.created_at
    )
