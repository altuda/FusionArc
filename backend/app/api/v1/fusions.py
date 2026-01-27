from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Body, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete, or_
from typing import List, Optional, Set
from pydantic import BaseModel
from app.database import get_db
from app.models import Session, Fusion, Protein, Domain
from app.schemas.fusion import (
    FusionManualInput,
    FusionResponse,
    FusionListResponse,
    FusionDetailResponse,
    SessionCreate,
    SessionResponse,
    VisualizationData,
    GeneVisualizationData,
    DomainInfo,
    ExonInfo,
    FusionTranscriptData,
    FusionExonInfo,
    MutationInfo,
    MutationResponse
)


class BatchCreateRequest(BaseModel):
    fusion_ids: List[str]
    batch_name: Optional[str] = None
from app.models import Transcript, Gene, Exon
from app.core.parsers import StarFusionParser, ArribaParser, ManualInputParser
from app.core.fusion_builder import FusionBuilder, normalize_source_name
from app.external.ensembl import get_ensembl_client
from app.external.interpro import get_interpro_client
from app.external.cbioportal import get_cbioportal_client
import logging

logger = logging.getLogger(__name__)

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
            import traceback
            logger.error(f"Error building fusion: {e}")
            logger.error(traceback.format_exc())

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
    session_id: Optional[str] = Query(None, description="Session ID to add fusion to"),
    db: AsyncSession = Depends(get_db)
):
    """Create a fusion from manual input.

    Args:
        input_data: The fusion input data
        session_id: Optional session ID to add fusion to. If provided, adds to existing session.
                   If not provided, creates a new session.
    """
    # Parse manual input
    fusion_data = ManualInputParser.parse_manual_input(input_data)

    # Use provided session or create new one
    session = None
    if session_id:
        result = await db.execute(
            select(Session).where(Session.id == session_id)
        )
        session = result.scalars().first()
        if not session:
            raise HTTPException(404, f"Session {session_id} not found")

    if not session:
        session = Session(name="Manual Input", source="manual")
        db.add(session)
        await db.commit()
        await db.refresh(session)

    # Build fusion with appropriate genome build
    genome_build = input_data.genome_build or "hg38"
    ensembl = get_ensembl_client(genome_build)
    builder = FusionBuilder(db, ensembl)
    fusion = await builder.build_fusion(fusion_data, session.id)

    return await _fusion_to_detail_response(fusion)


@router.post("/batch", response_model=SessionResponse)
async def create_batch_fusions(
    content: str = Body(..., media_type="text/plain"),
    session_id: Optional[str] = Query(None, description="Session ID to add fusions to"),
    db: AsyncSession = Depends(get_db)
):
    """Create multiple fusions from batch text input.

    Args:
        content: The batch input text with one fusion per line
        session_id: Optional session ID to add fusions to. If provided, adds to existing session.
                   If not provided, creates a new session.
    """
    parser = ManualInputParser()
    fusion_data_list = parser.parse(content)

    if not fusion_data_list:
        raise HTTPException(400, "No valid fusions found in input.")

    # Use provided session or create new one
    session = None
    if session_id:
        result = await db.execute(
            select(Session).where(Session.id == session_id)
        )
        session = result.scalars().first()
        if not session:
            raise HTTPException(404, f"Session {session_id} not found")

    if not session:
        session = Session(name="Batch Input", source="manual")
        db.add(session)
        await db.commit()
        await db.refresh(session)

    # Build fusions - use per-fusion genome build
    # Cache ensembl clients by genome build to avoid recreating
    ensembl_clients = {}

    for fusion_data in fusion_data_list:
        try:
            # Get the genome build for this fusion (default to hg38)
            genome_build = getattr(fusion_data, 'genome_build', None) or "hg38"

            # Get or create ensembl client for this genome build
            if genome_build not in ensembl_clients:
                ensembl_clients[genome_build] = get_ensembl_client(genome_build)

            ensembl = ensembl_clients[genome_build]
            builder = FusionBuilder(db, ensembl)
            await builder.build_fusion(fusion_data, session.id)
        except Exception as e:
            import traceback
            logger.error(f"Error building fusion: {e}")
            logger.error(traceback.format_exc())

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


@router.post("/batch/create", response_model=SessionResponse)
async def create_batch_from_fusions(
    request: BatchCreateRequest,
    db: AsyncSession = Depends(get_db)
):
    """Create a new batch/session by copying selected fusions.

    This allows organizing the same fusion into multiple comparison groups.
    The original fusions remain in their original sessions.
    """
    if not request.fusion_ids:
        raise HTTPException(400, "No fusion IDs provided")

    if len(request.fusion_ids) < 2:
        raise HTTPException(400, "At least 2 fusions are required to create a batch")

    # Fetch the selected fusions from any session
    result = await db.execute(
        select(Fusion).where(Fusion.id.in_(request.fusion_ids))
    )
    source_fusions = result.scalars().all()

    if not source_fusions:
        raise HTTPException(404, "No fusions found with the provided IDs")

    if len(source_fusions) != len(request.fusion_ids):
        raise HTTPException(404, f"Some fusion IDs were not found. Found {len(source_fusions)} of {len(request.fusion_ids)}")

    # Create new session for the batch
    batch_name = request.batch_name or f"Batch ({len(source_fusions)} fusions)"
    session = Session(
        name=batch_name,
        source="batch"
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    # Copy fusions to the new session
    for source_fusion in source_fusions:
        new_fusion = Fusion(
            session_id=session.id,
            gene_a_symbol=source_fusion.gene_a_symbol,
            gene_a_id=source_fusion.gene_a_id,
            gene_a_chromosome=source_fusion.gene_a_chromosome,
            gene_a_breakpoint=source_fusion.gene_a_breakpoint,
            gene_a_strand=source_fusion.gene_a_strand,
            transcript_a_id=source_fusion.transcript_a_id,
            gene_b_symbol=source_fusion.gene_b_symbol,
            gene_b_id=source_fusion.gene_b_id,
            gene_b_chromosome=source_fusion.gene_b_chromosome,
            gene_b_breakpoint=source_fusion.gene_b_breakpoint,
            gene_b_strand=source_fusion.gene_b_strand,
            transcript_b_id=source_fusion.transcript_b_id,
            junction_reads=source_fusion.junction_reads,
            spanning_reads=source_fusion.spanning_reads,
            is_in_frame=source_fusion.is_in_frame,
            aa_breakpoint_a=source_fusion.aa_breakpoint_a,
            aa_breakpoint_b=source_fusion.aa_breakpoint_b,
            fusion_sequence=source_fusion.fusion_sequence,
            domains_a=source_fusion.domains_a,
            domains_b=source_fusion.domains_b,
            has_kinase_domain=source_fusion.has_kinase_domain,
            kinase_retained=source_fusion.kinase_retained,
            confidence=source_fusion.confidence,
            genome_build=source_fusion.genome_build,
            raw_data=source_fusion.raw_data
        )
        db.add(new_fusion)

    await db.commit()

    return SessionResponse(
        id=session.id,
        name=session.name,
        source=session.source,
        created_at=session.created_at,
        fusion_count=len(source_fusions)
    )


# ============ DEBUG ROUTES (must be before /{session_id} to not be captured) ============

@router.post("/debug/clear-all-cache")
async def clear_all_cache(db: AsyncSession = Depends(get_db)):
    """Clear ALL cached gene/transcript/exon/protein/domain data.

    Use this after schema changes to force complete re-fetch.
    """
    from app.models import Protein, Domain

    # Delete in reverse order of dependencies
    result1 = await db.execute(delete(Domain))
    result2 = await db.execute(delete(Exon))
    result3 = await db.execute(delete(Protein))
    result4 = await db.execute(delete(Transcript))
    result5 = await db.execute(delete(Gene))

    await db.commit()

    return {
        "message": "Cleared all cached data",
        "deleted": {
            "domains": result1.rowcount,
            "exons": result2.rowcount,
            "proteins": result3.rowcount,
            "transcripts": result4.rowcount,
            "genes": result5.rowcount
        }
    }


@router.post("/debug/clear-gene-cache/{gene_symbol}")
async def clear_gene_cache(
    gene_symbol: str,
    db: AsyncSession = Depends(get_db)
):
    """Clear cached gene/transcript/exon data to force re-fetch."""
    result = await db.execute(select(Gene).where(Gene.symbol == gene_symbol))
    gene = result.scalar_one_or_none()

    if not gene:
        return {"message": f"Gene {gene_symbol} not found in cache"}

    result = await db.execute(select(Transcript).where(Transcript.gene_id == gene.id))
    transcripts = result.scalars().all()

    deleted_exons = 0
    for transcript in transcripts:
        result = await db.execute(delete(Exon).where(Exon.transcript_id == transcript.id))
        deleted_exons += result.rowcount

    gene.cached_at = None
    await db.commit()

    return {
        "message": f"Cleared cache for {gene_symbol}",
        "transcripts": len(transcripts),
        "deleted_exons": deleted_exons
    }


@router.get("/debug/exons/{transcript_id}")
async def debug_exons(
    transcript_id: str,
    genome_build: str = "hg38",
    db: AsyncSession = Depends(get_db)
):
    """Debug endpoint to test exon fetching."""
    result = await db.execute(
        select(Exon).where(Exon.transcript_id == transcript_id)
    )
    db_exons = list(result.scalars().all())

    ensembl = get_ensembl_client(genome_build)
    trans_data = await ensembl.get_transcript(transcript_id)
    lookup_exons = trans_data.get("Exon", []) if trans_data else []
    overlap_exons = await ensembl.get_exons(transcript_id)

    def matches(exon):
        parent = exon.get("Parent")
        if not parent:
            return True
        if parent == transcript_id or parent.startswith(transcript_id + "."):
            return True
        base_parent = parent.split(".")[0]
        base_transcript = transcript_id.split(".")[0]
        return base_parent == base_transcript

    filtered_overlap = [e for e in overlap_exons if matches(e)]

    return {
        "transcript_id": transcript_id,
        "genome_build": genome_build,
        "db_exons_count": len(db_exons),
        "db_exons": [{"id": e.exon_id, "start": e.start, "end": e.end, "rank": e.rank} for e in db_exons[:5]],
        "lookup_exons_count": len(lookup_exons),
        "lookup_exons": [{"id": e.get("id"), "start": e.get("start"), "end": e.get("end")} for e in lookup_exons[:3]],
        "overlap_exons_total": len(overlap_exons),
        "overlap_exons_filtered": len(filtered_overlap),
        "filtered_sample": [{"id": e.get("id"), "start": e.get("start"), "rank": e.get("rank"), "Parent": e.get("Parent")} for e in filtered_overlap[:3]],
    }

# ============ END DEBUG ROUTES ============


@router.get("/sessions/batches", response_model=List[SessionResponse])
async def list_batch_sessions(
    db: AsyncSession = Depends(get_db)
):
    """List all batch sessions with their fusion counts."""
    result = await db.execute(
        select(Session)
        .where(Session.source == "batch")
        .order_by(Session.created_at.desc())
    )
    sessions = result.scalars().all()

    # Get fusion counts for each session
    responses = []
    for session in sessions:
        count_result = await db.execute(
            select(func.count(Fusion.id)).where(Fusion.session_id == session.id)
        )
        fusion_count = count_result.scalar() or 0

        responses.append(SessionResponse(
            id=session.id,
            name=session.name,
            source=session.source,
            created_at=session.created_at,
            fusion_count=fusion_count
        ))

    return responses


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Delete a session and all its fusions."""
    # Check if session exists
    result = await db.execute(
        select(Session).where(Session.id == session_id)
    )
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(404, "Session not found")

    # Delete all fusions in the session
    await db.execute(
        delete(Fusion).where(Fusion.session_id == session_id)
    )

    # Delete the session
    await db.execute(
        delete(Session).where(Session.id == session_id)
    )

    await db.commit()

    return {"message": "Session deleted", "session_id": session_id}


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


class SessionDomainInfo(BaseModel):
    name: str
    source: str
    status: str = "unknown"
    is_kinase: bool = False


@router.get("/{session_id}/domains", response_model=List[str])
async def get_session_domains(
    session_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get all unique domain names from all fusions in a session.

    Used for batch-consistent coloring across multiple fusions.
    """
    result = await db.execute(
        select(Fusion).where(Fusion.session_id == session_id)
    )
    fusions = result.scalars().all()

    # Collect all unique domain names
    domain_names = set()
    for fusion in fusions:
        for domain in (fusion.domains_a or []):
            if domain.get("name"):
                domain_names.add(domain["name"])
        for domain in (fusion.domains_b or []):
            if domain.get("name"):
                domain_names.add(domain["name"])

    return sorted(list(domain_names))


@router.get("/{session_id}/domains-info", response_model=List[SessionDomainInfo])
async def get_session_domains_info(
    session_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get all unique domains with full info from all fusions in a session.

    Used for batch legend with source filtering.
    """
    result = await db.execute(
        select(Fusion).where(Fusion.session_id == session_id)
    )
    fusions = result.scalars().all()

    # Collect all unique domains by name (keep first occurrence with full info)
    domains_by_name: dict = {}
    for fusion in fusions:
        for domain in (fusion.domains_a or []):
            name = domain.get("name")
            if name and name not in domains_by_name:
                domains_by_name[name] = SessionDomainInfo(
                    name=name,
                    source=domain.get("source", ""),
                    status=domain.get("status", "unknown"),
                    is_kinase=domain.get("is_kinase", False)
                )
        for domain in (fusion.domains_b or []):
            name = domain.get("name")
            if name and name not in domains_by_name:
                domains_by_name[name] = SessionDomainInfo(
                    name=name,
                    source=domain.get("source", ""),
                    status=domain.get("status", "unknown"),
                    is_kinase=domain.get("is_kinase", False)
                )

    return sorted(domains_by_name.values(), key=lambda d: d.name)


@router.get("/{session_id}/domain-sources", response_model=List[str])
async def get_session_domain_sources(
    session_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get all unique domain sources (databases) from all fusions in a session.

    Used for batch filtering by database.
    """
    result = await db.execute(
        select(Fusion).where(Fusion.session_id == session_id)
    )
    fusions = result.scalars().all()

    # Collect all unique domain sources
    sources = set()
    for fusion in fusions:
        for domain in (fusion.domains_a or []):
            if domain.get("source"):
                sources.add(domain["source"])
        for domain in (fusion.domains_b or []):
            if domain.get("source"):
                sources.add(domain["source"])

    return sorted(list(sources))


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

    logger.info(f"Visualization for {fusion.gene_a_symbol}--{fusion.gene_b_symbol}, genome_build={fusion.genome_build}")
    logger.info(f"  Transcript A: {fusion.transcript_a_id}, Transcript B: {fusion.transcript_b_id}")

    # Calculate protein lengths and junction position
    domains_a = [DomainInfo(**d) for d in (fusion.domains_a or [])]
    domains_b = [DomainInfo(**d) for d in (fusion.domains_b or [])]

    # Fetch actual protein lengths from database
    # This is important because domain data may be sparse/missing (especially for hg38)
    # but the actual protein length is stored when the transcript was fetched
    actual_protein_length_a = None
    actual_protein_length_b = None

    # Helper to get base transcript ID (strip genome build suffix)
    def get_base_transcript_id(tid: str) -> str:
        if tid and "_hg" in tid:
            return tid.rsplit("_", 1)[0]
        return tid

    if fusion.transcript_a_id:
        # Try exact match first, then base transcript ID match
        result = await db.execute(
            select(Protein.length).where(Protein.transcript_id == fusion.transcript_a_id)
        )
        actual_protein_length_a = result.scalar_one_or_none()

        # If not found, try matching by base transcript ID (without genome build suffix)
        if actual_protein_length_a is None:
            base_id = get_base_transcript_id(fusion.transcript_a_id)
            result = await db.execute(
                select(Protein.length).where(Protein.transcript_id.like(f"{base_id}%"))
            )
            actual_protein_length_a = result.scalar_one_or_none()

    if fusion.transcript_b_id:
        # Try exact match first, then base transcript ID match
        result = await db.execute(
            select(Protein.length).where(Protein.transcript_id == fusion.transcript_b_id)
        )
        actual_protein_length_b = result.scalar_one_or_none()

        # If not found, try matching by base transcript ID (without genome build suffix)
        if actual_protein_length_b is None:
            base_id = get_base_transcript_id(fusion.transcript_b_id)
            result = await db.execute(
                select(Protein.length).where(Protein.transcript_id.like(f"{base_id}%"))
            )
            actual_protein_length_b = result.scalar_one_or_none()

    # Use actual length first, fall back to domain-based estimate
    max_domain_end_a = max(d.end for d in domains_a) if domains_a else 0
    max_domain_end_b = max(d.end for d in domains_b) if domains_b else 0

    protein_length_a = max(
        actual_protein_length_a or 0,
        max_domain_end_a,
        fusion.aa_breakpoint_a or 0
    ) or 100  # Final fallback

    protein_length_b = max(
        actual_protein_length_b or 0,
        max_domain_end_b,
        fusion.aa_breakpoint_b or 0
    ) or 100  # Final fallback

    junction_position = fusion.aa_breakpoint_a or protein_length_a
    # Total fusion protein length = retained portion of gene A + retained portion of gene B
    retained_b = protein_length_b - (fusion.aa_breakpoint_b or 0)
    total_length = junction_position + retained_b

    # Fetch exon data for both transcripts
    genome_build = fusion.genome_build or "hg38"
    exons_a, gene_a_data, bp_exon_a, bp_loc_a = await _get_transcript_exons(db, fusion.transcript_a_id, fusion.gene_a_breakpoint, fusion.gene_a_strand, is_5prime=True, genome_build=genome_build)
    exons_b, gene_b_data, bp_exon_b, bp_loc_b = await _get_transcript_exons(db, fusion.transcript_b_id, fusion.gene_b_breakpoint, fusion.gene_b_strand, is_5prime=False, genome_build=genome_build)

    # Build fusion transcript data
    fusion_transcript = _build_fusion_transcript(
        exons_a, exons_b,
        fusion.gene_a_breakpoint, fusion.gene_b_breakpoint,
        fusion.gene_a_strand, fusion.gene_b_strand,
        gene_a_data, gene_b_data
    )

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
            exons=exons_a,
            transcript_id=fusion.transcript_a_id,
            gene_start=gene_a_data.get("start") if gene_a_data else None,
            gene_end=gene_a_data.get("end") if gene_a_data else None,
            cds_start=gene_a_data.get("cds_start") if gene_a_data else None,
            cds_end=gene_a_data.get("cds_end") if gene_a_data else None,
            color="#3B82F6",  # Blue
            breakpoint_exon=bp_exon_a,
            breakpoint_location=bp_loc_a
        ),
        gene_b=GeneVisualizationData(
            symbol=fusion.gene_b_symbol,
            chromosome=fusion.gene_b_chromosome,
            breakpoint=fusion.gene_b_breakpoint,
            strand=fusion.gene_b_strand,
            aa_breakpoint=fusion.aa_breakpoint_b,
            protein_length=protein_length_b,
            domains=domains_b,
            exons=exons_b,
            transcript_id=fusion.transcript_b_id,
            gene_start=gene_b_data.get("start") if gene_b_data else None,
            gene_end=gene_b_data.get("end") if gene_b_data else None,
            cds_start=gene_b_data.get("cds_start") if gene_b_data else None,
            cds_end=gene_b_data.get("cds_end") if gene_b_data else None,
            color="#10B981",  # Green
            breakpoint_exon=bp_exon_b,
            breakpoint_location=bp_loc_b
        ),
        junction_position=junction_position,
        is_in_frame=fusion.is_in_frame == 1 if fusion.is_in_frame != -1 else None,
        fusion_transcript=fusion_transcript
    )


async def _get_transcript_exons(
    db: AsyncSession,
    transcript_id: Optional[str],
    breakpoint: Optional[int],
    strand: Optional[str],
    is_5prime: bool,
    genome_build: str = "hg38"
) -> tuple[List[ExonInfo], Optional[dict], Optional[int], Optional[str]]:
    """Fetch exon data for a transcript.

    Returns:
        - List of ExonInfo
        - Gene data dict
        - Breakpoint exon number (or preceding exon for intronic breakpoints)
        - Breakpoint location string (e.g., "exon 31" or "intron 6")
    """
    import logging
    logger = logging.getLogger(__name__)

    if not transcript_id:
        return [], None, None, None

    # Get transcript with CDS info
    result = await db.execute(
        select(Transcript).where(Transcript.id == transcript_id)
    )
    transcript = result.scalar_one_or_none()

    if not transcript:
        return [], None, None, None

    # Get exons from database
    result = await db.execute(
        select(Exon)
        .where(Exon.transcript_id == transcript_id)
        .order_by(Exon.rank, Exon.start)
    )
    exons = list(result.scalars().all())

    # If no exons in database, fetch from Ensembl API on-demand
    if not exons:
        logger.warning(f"No exons in database for {transcript_id}, fetching from Ensembl")
        ensembl = get_ensembl_client(genome_build)

        # Strip genome build suffix from composite ID if present (e.g., "ENST00000305877_hg38" -> "ENST00000305877")
        ensembl_transcript_id = transcript_id.rsplit("_", 1)[0] if "_hg" in transcript_id else transcript_id
        logger.info(f"Using Ensembl transcript ID: {ensembl_transcript_id}")

        # First try the transcript lookup endpoint
        trans_data = await ensembl.get_transcript(ensembl_transcript_id)
        exon_data_list = trans_data.get("Exon", []) if trans_data else []

        # If still no exons, try the overlap endpoint
        if not exon_data_list:
            exon_data_list = await ensembl.get_exons(ensembl_transcript_id)
            # Filter to only exons belonging to this transcript
            def matches_transcript(exon):
                parent = exon.get("Parent")
                if not parent:
                    return True
                if parent == ensembl_transcript_id or parent.startswith(ensembl_transcript_id + "."):
                    return True
                base_parent = parent.split(".")[0]
                base_transcript = ensembl_transcript_id.split(".")[0]
                return base_parent == base_transcript
            exon_data_list = [e for e in exon_data_list if matches_transcript(e)]

        logger.info(f"Fetched {len(exon_data_list)} exons for {transcript_id} from Ensembl")

        # Convert to ExonInfo-like objects for processing
        # Sort by position based on strand
        if strand == "-":
            exon_data_list = sorted(exon_data_list, key=lambda e: e.get("start", 0), reverse=True)
        else:
            exon_data_list = sorted(exon_data_list, key=lambda e: e.get("start", 0))

        # Create temporary exon objects for processing
        class TempExon:
            def __init__(self, data, rank):
                self.start = data.get("start")
                self.end = data.get("end")
                self.rank = data.get("rank") or rank

        exons = [TempExon(e, idx + 1) for idx, e in enumerate(exon_data_list)]

        # Try to cache them in database for future use (best effort)
        try:
            for idx, exon_data in enumerate(exon_data_list):
                exon_id = exon_data.get("id")
                if exon_id:
                    # Check if already exists
                    existing = await db.execute(
                        select(Exon).where(
                            Exon.exon_id == exon_id,
                            Exon.transcript_id == transcript_id
                        )
                    )
                    if not existing.scalar_one_or_none():
                        new_exon = Exon(
                            exon_id=exon_id,
                            transcript_id=transcript_id,
                            rank=exon_data.get("rank") or (idx + 1),
                            start=exon_data.get("start"),
                            end=exon_data.get("end"),
                            phase=exon_data.get("phase"),
                            end_phase=exon_data.get("end_phase")
                        )
                        db.add(new_exon)
            await db.commit()
            logger.info(f"Cached exons for {transcript_id}")
        except Exception as e:
            logger.warning(f"Failed to cache exons for {transcript_id}: {e}")
            await db.rollback()

    # If all exons have rank=0, we need to sort by position based on strand
    # Positive strand: low to high genomic coords
    # Negative strand: high to low genomic coords (first exon has highest start)
    if exons and all(not e.rank or e.rank == 0 for e in exons):
        if strand == "-":
            exons.sort(key=lambda e: e.start, reverse=True)
        else:
            exons.sort(key=lambda e: e.start)

    gene_data = {
        "start": transcript.start,
        "end": transcript.end,
        "cds_start": transcript.cds_start,
        "cds_end": transcript.cds_end
    }

    exon_infos = []
    for idx, exon in enumerate(exons):
        # Use exon.rank if valid (>0), otherwise use 1-based index
        exon_rank = exon.rank if exon.rank and exon.rank > 0 else idx + 1

        # Determine if exon contains coding sequence
        is_coding = False
        cds_start_in_exon = None
        cds_end_in_exon = None

        if transcript.cds_start and transcript.cds_end:
            # Check overlap with CDS
            if exon.start <= transcript.cds_end and exon.end >= transcript.cds_start:
                is_coding = True
                cds_start_in_exon = max(exon.start, transcript.cds_start)
                cds_end_in_exon = min(exon.end, transcript.cds_end)

        # Determine exon status based on breakpoint
        # For positive strand: low coords = 5' end, high coords = 3' end
        # For negative strand: high coords = 5' end, low coords = 3' end
        # Breakpoint within exon (inclusive) = partial
        status = "unknown"
        if breakpoint:
            # First check if breakpoint is within this exon (inclusive boundaries)
            breakpoint_in_exon = exon.start <= breakpoint <= exon.end

            if is_5prime:
                # For 5' gene: we keep the portion BEFORE the breakpoint (in transcription direction)
                if strand == "+":
                    # Positive strand: "before" means lower genomic coordinates
                    if breakpoint_in_exon:
                        status = "partial"  # Breakpoint is within this exon
                    elif exon.end < breakpoint:
                        status = "retained"  # Entire exon is before breakpoint
                    else:
                        status = "lost"  # Entire exon is after breakpoint
                else:  # negative strand
                    # Negative strand: "before" means higher genomic coordinates
                    if breakpoint_in_exon:
                        status = "partial"  # Breakpoint is within this exon
                    elif exon.start > breakpoint:
                        status = "retained"  # Entire exon is before breakpoint (higher coords)
                    else:
                        status = "lost"  # Entire exon is after breakpoint (lower coords)
            else:
                # For 3' gene: we keep the portion AFTER the breakpoint (in transcription direction)
                if strand == "+":
                    # Positive strand: "after" means higher genomic coordinates
                    if breakpoint_in_exon:
                        status = "partial"  # Breakpoint is within this exon
                    elif exon.start > breakpoint:
                        status = "retained"  # Entire exon is after breakpoint
                    else:
                        status = "lost"  # Entire exon is before breakpoint
                else:  # negative strand
                    # Negative strand: "after" means lower genomic coordinates
                    if breakpoint_in_exon:
                        status = "partial"  # Breakpoint is within this exon
                    elif exon.end < breakpoint:
                        status = "retained"  # Entire exon is after breakpoint (lower coords)
                    else:
                        status = "lost"  # Entire exon is before breakpoint (higher coords)

        exon_infos.append(ExonInfo(
            rank=exon_rank,
            start=exon.start,
            end=exon.end,
            cds_start=cds_start_in_exon,
            cds_end=cds_end_in_exon,
            is_coding=is_coding,
            status=status
        ))

    logger.info(f"Built {len(exon_infos)} ExonInfo objects for {transcript_id}")
    if exon_infos:
        logger.info(f"  First exon: rank={exon_infos[0].rank}, start={exon_infos[0].start}, end={exon_infos[0].end}")

    # Calculate breakpoint exon and location
    # The breakpoint location indicates where the genomic breakpoint falls:
    # - "exon X" if breakpoint is within exon X
    # - "intron X" if breakpoint is between exon X and exon X+1
    breakpoint_exon = None
    breakpoint_location = None

    if breakpoint and exon_infos:
        # Sort exons by genomic position for proper analysis
        # For positive strand: sort by start ascending
        # For negative strand: sort by start descending (first exon has highest coords)
        if strand == "-":
            sorted_by_pos = sorted(exon_infos, key=lambda e: e.start, reverse=True)
        else:
            sorted_by_pos = sorted(exon_infos, key=lambda e: e.start)

        # Find which exon or intron contains the breakpoint
        for i, exon in enumerate(sorted_by_pos):
            # Check if breakpoint is within this exon (inclusive boundaries)
            if exon.start <= breakpoint <= exon.end:
                breakpoint_exon = exon.rank
                breakpoint_location = f"exon {exon.rank}"
                break

            # Check if breakpoint is in the intron BEFORE this exon
            if i > 0:
                prev_exon = sorted_by_pos[i - 1]
                if strand == "-":
                    # Negative strand: intron is between higher and lower coords
                    if prev_exon.start > breakpoint > exon.end:
                        # Breakpoint is in intron between prev_exon and this exon
                        # Intron number is the lower-ranked exon
                        intron_num = min(prev_exon.rank, exon.rank)
                        breakpoint_exon = intron_num
                        breakpoint_location = f"intron {intron_num}"
                        break
                else:
                    # Positive strand: intron is between lower and higher coords
                    if prev_exon.end < breakpoint < exon.start:
                        # Breakpoint is in intron between prev_exon and this exon
                        intron_num = prev_exon.rank
                        breakpoint_exon = intron_num
                        breakpoint_location = f"intron {intron_num}"
                        break

        # Fallback: if still not found, use status-based detection
        if breakpoint_exon is None:
            sorted_by_rank = sorted(exon_infos, key=lambda e: e.rank)

            # Check for partial exon first
            for exon in sorted_by_rank:
                if exon.status == "partial":
                    breakpoint_exon = exon.rank
                    breakpoint_location = f"exon {exon.rank}"
                    break

            # If still not found, determine from retained/lost boundary
            if breakpoint_exon is None:
                if is_5prime:
                    # For 5' gene: last retained exon, breakpoint in intron after
                    retained = [e for e in sorted_by_rank if e.status == "retained"]
                    if retained:
                        breakpoint_exon = retained[-1].rank
                        breakpoint_location = f"intron {retained[-1].rank}"
                else:
                    # For 3' gene: first retained exon, breakpoint in intron before
                    retained = [e for e in sorted_by_rank if e.status == "retained"]
                    if retained:
                        intron_num = retained[0].rank - 1 if retained[0].rank > 1 else 1
                        breakpoint_exon = intron_num
                        breakpoint_location = f"intron {intron_num}"

    return exon_infos, gene_data, breakpoint_exon, breakpoint_location


def _build_fusion_transcript(
    exons_a: List[ExonInfo],
    exons_b: List[ExonInfo],
    breakpoint_a: Optional[int],
    breakpoint_b: Optional[int],
    strand_a: Optional[str],
    strand_b: Optional[str],
    gene_a_data: Optional[dict],
    gene_b_data: Optional[dict]
) -> Optional[FusionTranscriptData]:
    """
    Build the fusion transcript representation.

    This handles strand orientation correctly:
    - 5' gene (A): We take exons BEFORE the breakpoint (in transcription direction)
    - 3' gene (B): We take exons AFTER the breakpoint (in transcription direction)

    For positive strand: transcription goes low -> high genomic coords
    For negative strand: transcription goes high -> low genomic coords
    """
    if not exons_a and not exons_b:
        return None

    fusion_exons = []
    current_pos = 0

    # Process gene A exons (5' partner)
    # Sort exons by their position in the transcript (by rank)
    retained_exons_a = [e for e in exons_a if e.status in ["retained", "partial"]]

    # For 5' gene on negative strand, we need to process in rank order (rank 1 is 5' end)
    # Ensembl ranks exons in transcription order regardless of strand
    for exon in retained_exons_a:
        # Calculate the portion of the exon to include
        exon_length = exon.end - exon.start + 1

        if exon.status == "partial" and breakpoint_a:
            # The breakpoint is within this exon - calculate how much to keep
            if strand_a == "+":
                # Positive strand: keep from exon start to breakpoint
                # breakpoint is where we cut, so length = breakpoint - exon.start
                exon_length = max(0, breakpoint_a - exon.start)
            else:
                # Negative strand: keep from breakpoint to exon end
                # On negative strand, 5' direction is toward higher coordinates
                exon_length = max(0, exon.end - breakpoint_a)

        if exon_length > 0:
            fusion_exons.append(FusionExonInfo(
                gene="A",
                rank=exon.rank,
                start=current_pos,
                end=current_pos + exon_length,
                length=exon_length,
                is_coding=exon.is_coding,
                original_genomic_start=exon.start,
                original_genomic_end=exon.end
            ))
            current_pos += exon_length

    junction_pos = current_pos

    # Process gene B exons (3' partner)
    retained_exons_b = [e for e in exons_b if e.status in ["retained", "partial"]]

    for exon in retained_exons_b:
        exon_length = exon.end - exon.start + 1

        if exon.status == "partial" and breakpoint_b:
            # The breakpoint is within this exon - calculate how much to keep
            if strand_b == "+":
                # Positive strand: keep from breakpoint to exon end
                exon_length = max(0, exon.end - breakpoint_b)
            else:
                # Negative strand: keep from exon start to breakpoint
                exon_length = max(0, breakpoint_b - exon.start)

        if exon_length > 0:
            fusion_exons.append(FusionExonInfo(
                gene="B",
                rank=exon.rank,
                start=current_pos,
                end=current_pos + exon_length,
                length=exon_length,
                is_coding=exon.is_coding,
                original_genomic_start=exon.start,
                original_genomic_end=exon.end
            ))
            current_pos += exon_length

    # Calculate CDS boundaries in fusion
    cds_start = None
    cds_end = None
    for exon in fusion_exons:
        if exon.is_coding:
            if cds_start is None:
                cds_start = exon.start
            cds_end = exon.end

    return FusionTranscriptData(
        total_length=current_pos,
        cds_start=cds_start,
        cds_end=cds_end,
        junction_position=junction_pos,
        exons=fusion_exons
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
        genome_build=fusion.genome_build or "hg38",
        created_at=fusion.created_at
    )


@router.post("/{session_id}/{fusion_id}/refresh-domains", response_model=FusionDetailResponse)
async def refresh_fusion_domains(
    session_id: str,
    fusion_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Refresh domains for a fusion from InterPro/UniProt.

    This endpoint fetches comprehensive domain data from multiple sources
    (InterPro, UniProt, Pfam, SMART, CDD, etc.) for proteins that may have
    been cached before InterPro integration was added.
    """
    # Get the fusion
    result = await db.execute(
        select(Fusion)
        .where(Fusion.session_id == session_id)
        .where(Fusion.id == fusion_id)
    )
    fusion = result.scalar_one_or_none()

    if not fusion:
        raise HTTPException(404, "Fusion not found")

    # Get InterPro client
    interpro_client = get_interpro_client()

    updated_domains_a = []
    updated_domains_b = []

    # Refresh domains for gene A
    if fusion.transcript_a_id:
        result = await db.execute(
            select(Protein).where(Protein.transcript_id == fusion.transcript_a_id)
        )
        protein_a = result.scalar_one_or_none()

        if protein_a:
            # Delete existing domains
            await db.execute(
                delete(Domain).where(Domain.protein_id == protein_a.id)
            )

            # Fetch from Ensembl
            ensembl = get_ensembl_client(fusion.genome_build or "hg38")
            features = await ensembl.get_protein_features(protein_a.id)
            for feat in features:
                domain = Domain(
                    protein_id=protein_a.id,
                    name=feat.get("description", feat.get("type", "Unknown")),
                    description=feat.get("description"),
                    source=normalize_source_name(feat.get("type", "Unknown")),
                    accession=feat.get("id"),
                    start=feat.get("start"),
                    end=feat.get("end"),
                    score=feat.get("score"),
                    data_provider="Ensembl"
                )
                db.add(domain)

            # Fetch from InterPro
            try:
                interpro_domains = await interpro_client.get_comprehensive_domains(
                    fusion.gene_a_symbol,
                    protein_length=protein_a.length
                )
                for d in interpro_domains:
                    if d.get("start") and d.get("end"):
                        domain = Domain(
                            protein_id=protein_a.id,
                            name=d.get("name", "Unknown"),
                            description=d.get("description"),
                            source=normalize_source_name(d.get("source", "InterPro")),
                            accession=d.get("accession"),
                            start=d.get("start"),
                            end=d.get("end"),
                            data_provider=d.get("data_provider", "InterPro")
                        )
                        db.add(domain)
            except Exception as e:
                print(f"Error fetching InterPro domains for {fusion.gene_a_symbol}: {e}")

            await db.commit()

            # Get updated domains
            result = await db.execute(
                select(Domain).where(Domain.protein_id == protein_a.id)
            )
            domains = result.scalars().all()

            for d in domains:
                status = _determine_domain_status(d.start, d.end, fusion.aa_breakpoint_a, "5prime")
                is_kinase = any(kw in (d.name or "") for kw in ["kinase", "Kinase", "Pkinase", "TyrKc", "S_TKc", "STYKc"])
                updated_domains_a.append({
                    "name": d.name or "Unknown",
                    "description": d.description,
                    "source": normalize_source_name(d.source or "Unknown"),
                    "accession": d.accession,
                    "start": d.start or 0,
                    "end": d.end or 0,
                    "score": d.score,
                    "status": status,
                    "is_kinase": is_kinase,
                    "data_provider": d.data_provider
                })

    # Refresh domains for gene B
    if fusion.transcript_b_id:
        result = await db.execute(
            select(Protein).where(Protein.transcript_id == fusion.transcript_b_id)
        )
        protein_b = result.scalar_one_or_none()

        if protein_b:
            # Delete existing domains
            await db.execute(
                delete(Domain).where(Domain.protein_id == protein_b.id)
            )

            # Fetch from Ensembl
            ensembl = get_ensembl_client(fusion.genome_build or "hg38")
            features = await ensembl.get_protein_features(protein_b.id)
            for feat in features:
                domain = Domain(
                    protein_id=protein_b.id,
                    name=feat.get("description", feat.get("type", "Unknown")),
                    description=feat.get("description"),
                    source=normalize_source_name(feat.get("type", "Unknown")),
                    accession=feat.get("id"),
                    start=feat.get("start"),
                    end=feat.get("end"),
                    score=feat.get("score"),
                    data_provider="Ensembl"
                )
                db.add(domain)

            # Fetch from InterPro
            try:
                interpro_domains = await interpro_client.get_comprehensive_domains(
                    fusion.gene_b_symbol,
                    protein_length=protein_b.length
                )
                for d in interpro_domains:
                    if d.get("start") and d.get("end"):
                        domain = Domain(
                            protein_id=protein_b.id,
                            name=d.get("name", "Unknown"),
                            description=d.get("description"),
                            source=normalize_source_name(d.get("source", "InterPro")),
                            accession=d.get("accession"),
                            start=d.get("start"),
                            end=d.get("end"),
                            data_provider=d.get("data_provider", "InterPro")
                        )
                        db.add(domain)
            except Exception as e:
                print(f"Error fetching InterPro domains for {fusion.gene_b_symbol}: {e}")

            await db.commit()

            # Get updated domains
            result = await db.execute(
                select(Domain).where(Domain.protein_id == protein_b.id)
            )
            domains = result.scalars().all()

            for d in domains:
                status = _determine_domain_status(d.start, d.end, fusion.aa_breakpoint_b, "3prime")
                is_kinase = any(kw in (d.name or "") for kw in ["kinase", "Kinase", "Pkinase", "TyrKc", "S_TKc", "STYKc"])
                updated_domains_b.append({
                    "name": d.name or "Unknown",
                    "description": d.description,
                    "source": normalize_source_name(d.source or "Unknown"),
                    "accession": d.accession,
                    "start": d.start or 0,
                    "end": d.end or 0,
                    "score": d.score,
                    "status": status,
                    "is_kinase": is_kinase,
                    "data_provider": d.data_provider
                })

    # Update fusion with new domains
    fusion.domains_a = updated_domains_a
    fusion.domains_b = updated_domains_b
    await db.commit()
    await db.refresh(fusion)

    return await _fusion_to_detail_response(fusion)


def _determine_domain_status(
    domain_start: int,
    domain_end: int,
    breakpoint: Optional[int],
    position: str
) -> str:
    """Determine if a domain is retained, truncated, or lost."""
    if breakpoint is None or domain_start is None or domain_end is None:
        return "unknown"

    if position == "5prime":
        if domain_end <= breakpoint:
            return "retained"
        elif domain_start >= breakpoint:
            return "lost"
        else:
            return "truncated"
    else:
        if domain_start >= breakpoint:
            return "retained"
        elif domain_end <= breakpoint:
            return "lost"
        else:
            return "truncated"


@router.get("/{session_id}/{fusion_id}/mutations", response_model=MutationResponse)
async def get_fusion_mutations(
    session_id: str,
    fusion_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get mutation data for both genes in a fusion from cBioPortal.

    Fetches real cancer mutation data from TCGA, MSK-IMPACT, and other studies.
    Returns mutations aggregated by position with counts.
    """
    import logging
    logger = logging.getLogger(__name__)

    # Get the fusion
    result = await db.execute(
        select(Fusion)
        .where(Fusion.session_id == session_id)
        .where(Fusion.id == fusion_id)
    )
    fusion = result.scalar_one_or_none()

    if not fusion:
        raise HTTPException(404, "Fusion not found")

    logger.info(f"Fetching mutations for {fusion.gene_a_symbol}--{fusion.gene_b_symbol}")
    logger.info(f"  AA breakpoints: A={fusion.aa_breakpoint_a}, B={fusion.aa_breakpoint_b}")

    # Get cBioPortal client
    cbioportal = get_cbioportal_client()

    # Fetch mutations for both genes in parallel
    import asyncio
    mutations_a_task = cbioportal.get_mutation_counts(fusion.gene_a_symbol)
    mutations_b_task = cbioportal.get_mutation_counts(fusion.gene_b_symbol)

    mutations_a_raw, mutations_b_raw = await asyncio.gather(
        mutations_a_task, mutations_b_task, return_exceptions=True
    )

    # Process gene A mutations
    mutations_a = []
    if isinstance(mutations_a_raw, list):
        for mut in mutations_a_raw:
            # For 5' gene, include mutations before breakpoint (retained in fusion)
            # If no breakpoint known, include all mutations
            if fusion.aa_breakpoint_a is None or mut["position"] <= fusion.aa_breakpoint_a:
                mutations_a.append(MutationInfo(
                    position=mut["position"],
                    ref_aa=mut.get("ref_aa", ""),
                    alt_aa=mut.get("alt_aa", ""),
                    type=mut["type"],
                    label=mut["label"],
                    count=mut["count"],
                    source=mut.get("source", "cBioPortal"),
                    gene="A"
                ))

    # Process gene B mutations
    mutations_b = []
    if isinstance(mutations_b_raw, list):
        for mut in mutations_b_raw:
            # For 3' gene, include mutations after breakpoint (retained in fusion)
            # If no breakpoint known, include all mutations
            if fusion.aa_breakpoint_b is None or mut["position"] >= fusion.aa_breakpoint_b:
                mutations_b.append(MutationInfo(
                    position=mut["position"],
                    ref_aa=mut.get("ref_aa", ""),
                    alt_aa=mut.get("alt_aa", ""),
                    type=mut["type"],
                    label=mut["label"],
                    count=mut["count"],
                    source=mut.get("source", "cBioPortal"),
                    gene="B"
                ))

    logger.info(f"  Raw mutations: A={len(mutations_a_raw) if isinstance(mutations_a_raw, list) else 'error'}, "
                f"B={len(mutations_b_raw) if isinstance(mutations_b_raw, list) else 'error'}")
    logger.info(f"  Filtered mutations: A={len(mutations_a)}, B={len(mutations_b)}")

    return MutationResponse(
        gene_a_symbol=fusion.gene_a_symbol,
        gene_b_symbol=fusion.gene_b_symbol,
        mutations_a=mutations_a,
        mutations_b=mutations_b,
        total_count=len(mutations_a) + len(mutations_b)
    )
