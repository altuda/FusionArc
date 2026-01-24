import logging
from typing import Optional, List, Dict, Any, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.external.ensembl import EnsemblClient
from app.external.interpro import get_interpro_client
from app.core.mapping.genomic_to_protein import GenomicToProteinMapper
from app.models import Gene, Transcript, Protein, Domain, Fusion, Exon
from app.schemas.fusion import FusionCreate, DomainInfo
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


KINASE_KEYWORDS = ["kinase", "Kinase", "Pkinase", "TyrKc", "S_TKc", "STYKc"]
CACHE_EXPIRY_DAYS = 30

# Normalize source/database names to consistent capitalization
SOURCE_NAME_MAP = {
    "pfam": "Pfam",
    "smart": "SMART",
    "cdd": "CDD",
    "superfamily": "SuperFamily",
    "supfam": "SuperFamily",
    "gene3d": "Gene3D",
    "panther": "PANTHER",
    "prosite": "PROSITE",
    "prosite_profiles": "PROSITE",
    "prosite_patterns": "PROSITE",
    "prints": "PRINTS",
    "pirsf": "PIRSF",
    "hamap": "HAMAP",
    "tigrfams": "TIGRFAMs",
    "interpro": "InterPro",
    "uniprot": "UniProt",
    "mobidb": "MobiDB",
    "mobidb-lite": "MobiDB",
    "mobidblite": "MobiDB",
    "seg": "Seg",
    "coils": "Coils",
    "ncoils": "Coils",
    "signalp": "SignalP",
    "tmhmm": "TMHMM",
    "phobius": "Phobius",
    "alphafold": "AlphaFold",
    "sifts": "SIFTS",
    "cathgene3d": "Gene3D",
    "ssf": "SuperFamily",
    "profile": "PROSITE",
}


def normalize_source_name(source: str) -> str:
    """Normalize database/source names to consistent capitalization."""
    if not source:
        return "Unknown"
    # Check the map (case-insensitive)
    normalized = SOURCE_NAME_MAP.get(source.lower())
    if normalized:
        return normalized
    # If not in map, capitalize first letter
    return source.capitalize() if source.islower() else source


class FusionBuilder:
    """Builds and analyzes gene fusion proteins."""

    def __init__(self, db: AsyncSession, ensembl: EnsemblClient):
        self.db = db
        self.ensembl = ensembl
        self.mapper = GenomicToProteinMapper(ensembl)

    async def build_fusion(self, fusion_data: FusionCreate, session_id: str) -> Fusion:
        """Build a complete fusion analysis from parsed input."""
        # Fetch/cache gene data
        gene_a = await self._get_or_fetch_gene(fusion_data.gene_a_symbol)
        gene_b = await self._get_or_fetch_gene(fusion_data.gene_b_symbol)

        # Get transcripts
        transcript_a = await self._get_transcript(
            gene_a, fusion_data.transcript_a_id
        ) if gene_a else None
        transcript_b = await self._get_transcript(
            gene_b, fusion_data.transcript_b_id
        ) if gene_b else None

        # Map breakpoints to amino acids
        aa_breakpoint_a = None
        aa_breakpoint_b = None

        if transcript_a:
            aa_breakpoint_a = await self.mapper.map_genomic_to_aa(
                fusion_data.gene_a_chromosome,
                fusion_data.gene_a_breakpoint,
                fusion_data.gene_a_strand,
                transcript_a.id
            )

        if transcript_b:
            aa_breakpoint_b = await self.mapper.map_genomic_to_aa(
                fusion_data.gene_b_chromosome,
                fusion_data.gene_b_breakpoint,
                fusion_data.gene_b_strand,
                transcript_b.id
            )

        # Determine in-frame status
        is_in_frame = None
        if transcript_a and transcript_b:
            logger.info(f"Calculating in-frame status for {fusion_data.gene_a_symbol}-{fusion_data.gene_b_symbol}")
            logger.info(f"  Transcript A: {transcript_a.id}, breakpoint: {fusion_data.gene_a_breakpoint}, strand: {fusion_data.gene_a_strand}")
            logger.info(f"  Transcript B: {transcript_b.id}, breakpoint: {fusion_data.gene_b_breakpoint}, strand: {fusion_data.gene_b_strand}")
            is_in_frame = await self.mapper.is_in_frame_fusion(
                fusion_data.gene_a_breakpoint,
                fusion_data.gene_a_strand,
                transcript_a.id,
                fusion_data.gene_b_breakpoint,
                fusion_data.gene_b_strand,
                transcript_b.id
            )
            logger.info(f"  Result: is_in_frame={is_in_frame}")
        else:
            logger.warning(f"Cannot calculate in-frame: transcript_a={transcript_a}, transcript_b={transcript_b}")

        # Get protein domains
        domains_a = await self._get_domains_with_status(
            transcript_a, aa_breakpoint_a, "5prime"
        ) if transcript_a else []

        domains_b = await self._get_domains_with_status(
            transcript_b, aa_breakpoint_b, "3prime"
        ) if transcript_b else []

        # Build fusion sequence
        fusion_sequence = await self._build_fusion_sequence(
            transcript_a, aa_breakpoint_a,
            transcript_b, aa_breakpoint_b
        )

        # Check for kinase domains
        has_kinase, kinase_retained = self._check_kinase_domains(domains_a, domains_b)

        # Calculate confidence
        confidence = self._calculate_confidence(
            fusion_data.junction_reads,
            fusion_data.spanning_reads,
            is_in_frame
        )

        # Create fusion record
        fusion = Fusion(
            session_id=session_id,
            gene_a_symbol=fusion_data.gene_a_symbol,
            gene_a_id=gene_a.id if gene_a else None,
            gene_a_chromosome=fusion_data.gene_a_chromosome,
            gene_a_breakpoint=fusion_data.gene_a_breakpoint,
            gene_a_strand=fusion_data.gene_a_strand,
            transcript_a_id=transcript_a.id if transcript_a else None,
            gene_b_symbol=fusion_data.gene_b_symbol,
            gene_b_id=gene_b.id if gene_b else None,
            gene_b_chromosome=fusion_data.gene_b_chromosome,
            gene_b_breakpoint=fusion_data.gene_b_breakpoint,
            gene_b_strand=fusion_data.gene_b_strand,
            transcript_b_id=transcript_b.id if transcript_b else None,
            junction_reads=fusion_data.junction_reads,
            spanning_reads=fusion_data.spanning_reads,
            is_in_frame=1 if is_in_frame else (0 if is_in_frame is False else -1),
            aa_breakpoint_a=aa_breakpoint_a,
            aa_breakpoint_b=aa_breakpoint_b,
            fusion_sequence=fusion_sequence,
            domains_a=[d.model_dump() for d in domains_a],
            domains_b=[d.model_dump() for d in domains_b],
            has_kinase_domain=1 if has_kinase else 0,
            kinase_retained=1 if kinase_retained else (0 if kinase_retained is False else -1),
            confidence=confidence,
            genome_build=fusion_data.genome_build
        )

        self.db.add(fusion)
        await self.db.commit()
        await self.db.refresh(fusion)

        return fusion

    async def _get_or_fetch_gene(self, symbol: str) -> Optional[Gene]:
        """Get gene from cache or fetch from Ensembl."""
        genome_build = self.ensembl.genome_build

        # Check cache - must match both symbol AND genome_build
        result = await self.db.execute(
            select(Gene).where(
                Gene.symbol == symbol,
                Gene.genome_build == genome_build
            )
        )
        gene = result.scalar_one_or_none()

        # Check if cache is fresh
        if gene and gene.cached_at:
            if datetime.utcnow() - gene.cached_at < timedelta(days=CACHE_EXPIRY_DAYS):
                logger.info(f"Using cached gene {symbol} for {genome_build}")
                return gene

        # Fetch from Ensembl
        logger.info(f"Fetching gene {symbol} from Ensembl ({genome_build})")
        gene_data = await self.ensembl.search_gene(symbol)
        if not gene_data:
            return None

        # Create or update cache
        # Use composite ID: gene_id + genome_build to allow same gene in different builds
        gene_id = f"{gene_data['id']}_{genome_build}"
        if not gene:
            gene = Gene(id=gene_id)

        gene.symbol = gene_data.get("display_name", symbol)
        gene.name = gene_data.get("description", "")
        gene.chromosome = gene_data.get("seq_region_name", "")
        gene.start = gene_data.get("start")
        gene.end = gene_data.get("end")
        gene.strand = gene_data.get("strand")
        gene.biotype = gene_data.get("biotype")
        gene.genome_build = genome_build
        gene.cached_at = datetime.utcnow()

        self.db.add(gene)
        await self.db.commit()

        # Cache transcripts (pass gene symbol for InterPro domain lookup)
        for trans_data in gene_data.get("Transcript", []):
            await self._cache_transcript(gene.id, trans_data, gene.symbol)

        return gene

    async def _cache_transcript(
        self,
        gene_id: str,
        trans_data: Dict,
        gene_symbol: Optional[str] = None
    ) -> Transcript:
        """Cache a transcript and its related data."""
        genome_build = self.ensembl.genome_build
        # Use composite ID: transcript_id + genome_build
        transcript_id = f"{trans_data['id']}_{genome_build}"

        result = await self.db.execute(
            select(Transcript).where(Transcript.id == transcript_id)
        )
        transcript = result.scalar_one_or_none()

        if not transcript:
            transcript = Transcript(id=transcript_id)

        transcript.gene_id = gene_id
        transcript.is_canonical = 1 if trans_data.get("is_canonical") else 0
        transcript.biotype = trans_data.get("biotype")
        transcript.start = trans_data.get("start")
        transcript.end = trans_data.get("end")
        transcript.cached_at = datetime.utcnow()

        # Get CDS info
        if "Translation" in trans_data:
            trans = trans_data["Translation"]
            transcript.cds_start = trans.get("start")
            transcript.cds_end = trans.get("end")

            # Cache protein with InterPro domains
            await self._cache_protein(transcript.id, trans, gene_symbol)

        self.db.add(transcript)
        await self.db.commit()

        # Cache exons - first try from trans_data, then fetch explicitly if needed
        exon_list = trans_data.get("Exon", [])
        logger.info(f"Transcript {transcript.id}: {len(exon_list)} exons from lookup")

        # If no exons in the lookup response, fetch them explicitly via overlap endpoint
        if not exon_list:
            exon_list = await self.ensembl.get_exons(transcript.id)
            logger.info(f"Transcript {transcript.id}: {len(exon_list)} exons from overlap endpoint")

        # If we have exons from lookup but they might be incomplete,
        # also fetch explicitly to get full data
        if len(exon_list) < 3:  # Likely incomplete if only 1-2 exons
            fetched_exons = await self.ensembl.get_exons(transcript.id)
            if len(fetched_exons) > len(exon_list):
                exon_list = fetched_exons
                logger.info(f"Transcript {transcript.id}: using {len(exon_list)} exons from overlap (more complete)")

        # If still no exons, try fetching transcript details directly
        if not exon_list:
            logger.warning(f"No exons found for {transcript.id}, fetching transcript details")
            trans_detail = await self.ensembl.get_transcript(transcript.id)
            if trans_detail:
                exon_list = trans_detail.get("Exon", [])
                logger.info(f"Transcript {transcript.id}: {len(exon_list)} exons from transcript lookup")

        # Filter to only exons belonging to this transcript (overlap endpoint returns all overlapping features)
        # Note: Parent field may include version (e.g., ENST00000305877.12) while transcript_id may not
        def matches_transcript(exon):
            parent = exon.get("Parent")
            if not parent:
                return True  # No Parent field, include it
            # Check if parent matches transcript_id (with or without version)
            if parent == transcript.id:
                return True
            if parent.startswith(transcript.id + "."):
                return True
            # Also check the base ID (strip version from both)
            base_parent = parent.split(".")[0]
            base_transcript = transcript.id.split(".")[0]
            return base_parent == base_transcript

        filtered_exons = [e for e in exon_list if matches_transcript(e)]
        logger.info(f"Transcript {transcript.id}: {len(filtered_exons)} exons after filtering (from {len(exon_list)})")
        exon_list = filtered_exons

        # Sort exons by position and assign ranks if not present
        # For positive strand: sort by start ascending
        # For negative strand: sort by start descending (first exon has highest coords)
        strand = trans_data.get("strand", 1)
        if strand == -1 or strand == "-":
            sorted_exons = sorted(exon_list, key=lambda e: e.get("start", 0), reverse=True)
        else:
            sorted_exons = sorted(exon_list, key=lambda e: e.get("start", 0))

        for idx, exon_data in enumerate(sorted_exons):
            # Assign rank if not present (1-based)
            rank = exon_data.get("rank") or (idx + 1)
            await self._cache_exon(transcript.id, exon_data, rank=rank)

        return transcript

    async def _cache_exon(self, transcript_id: str, exon_data: Dict, rank: int = 0) -> Exon:
        """Cache an exon.

        Uses composite key (exon_id, transcript_id) since the same exon
        can belong to multiple transcripts in Ensembl.
        """
        exon_id = exon_data.get("id")
        if not exon_id:
            return None

        # Check for existing exon with this composite key
        result = await self.db.execute(
            select(Exon).where(
                Exon.exon_id == exon_id,
                Exon.transcript_id == transcript_id
            )
        )
        exon = result.scalar_one_or_none()

        if not exon:
            exon = Exon(exon_id=exon_id, transcript_id=transcript_id)

        # Use provided rank, or from data, or default to 0
        exon.rank = exon_data.get("rank") or rank or 0
        exon.start = exon_data.get("start")
        exon.end = exon_data.get("end")
        exon.phase = exon_data.get("phase")
        exon.end_phase = exon_data.get("end_phase")
        exon.cached_at = datetime.utcnow()

        self.db.add(exon)
        await self.db.commit()

        return exon

    async def _cache_protein(
        self,
        transcript_id: str,
        trans_data: Dict,
        gene_symbol: Optional[str] = None
    ) -> Optional[Protein]:
        """Cache protein and its domains from multiple sources."""
        protein_id = trans_data.get("id")
        if not protein_id:
            return None

        result = await self.db.execute(
            select(Protein).where(Protein.id == protein_id)
        )
        protein = result.scalar_one_or_none()

        if not protein:
            protein = Protein(id=protein_id)

        protein.transcript_id = transcript_id
        protein.length = trans_data.get("length")

        # Fetch sequence
        seq = await self.ensembl.get_protein_sequence(protein_id)
        if seq:
            protein.sequence = seq

        protein.cached_at = datetime.utcnow()

        self.db.add(protein)
        await self.db.commit()

        # Fetch domains from Ensembl
        features = await self.ensembl.get_protein_features(protein_id)
        for feat in features:
            await self._cache_domain(protein_id, feat)

        # Also fetch comprehensive domains from InterPro/UniProt
        if gene_symbol:
            try:
                interpro_client = get_interpro_client()
                interpro_domains = await interpro_client.get_comprehensive_domains(
                    gene_symbol,
                    protein_length=protein.length
                )
                for domain in interpro_domains:
                    await self._cache_domain(protein_id, {
                        "description": domain.get("name"),
                        "type": domain.get("source", "InterPro"),
                        "id": domain.get("accession"),
                        "start": domain.get("start"),
                        "end": domain.get("end"),
                    })
                logger.info(f"Cached {len(interpro_domains)} InterPro domains for {gene_symbol}")
            except Exception as e:
                logger.warning(f"Failed to fetch InterPro domains for {gene_symbol}: {e}")

        return protein

    async def _cache_domain(self, protein_id: str, feat_data: Dict) -> Optional[Domain]:
        """Cache a protein domain with deduplication."""
        name = feat_data.get("description", feat_data.get("type", "Unknown"))
        start = feat_data.get("start")
        end = feat_data.get("end")
        raw_source = feat_data.get("type", "Unknown")
        source = normalize_source_name(raw_source)

        # Skip if missing required fields
        if not start or not end:
            return None

        # Check for duplicate (same position and similar name)
        result = await self.db.execute(
            select(Domain).where(
                Domain.protein_id == protein_id,
                Domain.start == start,
                Domain.end == end
            )
        )
        existing = result.scalars().all()

        # Check if we already have a domain at this position
        for d in existing:
            # Skip if we have an exact name match
            if d.name and name and d.name.lower() == name.lower():
                return d
            # Skip if same source (normalize both for comparison)
            if normalize_source_name(d.source or "") == source:
                return d

        domain = Domain(
            protein_id=protein_id,
            name=name,
            description=feat_data.get("description"),
            source=source,  # Use normalized source name
            accession=feat_data.get("id"),
            start=start,
            end=end,
            score=feat_data.get("score"),  # E-value or hit score
            cached_at=datetime.utcnow()
        )

        self.db.add(domain)
        await self.db.commit()
        return domain

    async def _get_transcript(
        self,
        gene: Gene,
        transcript_id: Optional[str] = None
    ) -> Optional[Transcript]:
        """Get specific or canonical transcript."""
        genome_build = self.ensembl.genome_build

        if transcript_id:
            # If user provided a transcript_id, convert to composite format
            # Handle both formats: "ENST00000305877" and "ENST00000305877_hg38"
            if "_hg" not in transcript_id:
                composite_id = f"{transcript_id}_{genome_build}"
            else:
                composite_id = transcript_id

            result = await self.db.execute(
                select(Transcript).where(Transcript.id == composite_id)
            )
            return result.scalar_one_or_none()

        # Get canonical transcript
        result = await self.db.execute(
            select(Transcript)
            .where(Transcript.gene_id == gene.id)
            .where(Transcript.is_canonical == 1)
        )
        transcript = result.scalar_one_or_none()

        if not transcript:
            # Fall back to any protein-coding transcript
            result = await self.db.execute(
                select(Transcript)
                .where(Transcript.gene_id == gene.id)
                .where(Transcript.biotype == "protein_coding")
            )
            transcript = result.scalars().first()

        return transcript

    async def _get_domains_with_status(
        self,
        transcript: Transcript,
        aa_breakpoint: Optional[int],
        position: str
    ) -> List[DomainInfo]:
        """Get domains with retention status."""
        if not transcript:
            return []

        # Get protein
        result = await self.db.execute(
            select(Protein).where(Protein.transcript_id == transcript.id)
        )
        protein = result.scalar_one_or_none()
        if not protein:
            return []

        # Get domains
        result = await self.db.execute(
            select(Domain).where(Domain.protein_id == protein.id)
        )
        domains = result.scalars().all()

        domain_infos = []
        for domain in domains:
            status = self._determine_domain_status(
                domain.start, domain.end, aa_breakpoint, position
            )

            is_kinase = any(kw in (domain.name or "") for kw in KINASE_KEYWORDS)

            domain_infos.append(DomainInfo(
                name=domain.name or "Unknown",
                description=domain.description,
                source=normalize_source_name(domain.source or "Unknown"),
                accession=domain.accession,
                start=domain.start or 0,
                end=domain.end or 0,
                score=domain.score,
                status=status,
                is_kinase=is_kinase
            ))

        return domain_infos

    def _determine_domain_status(
        self,
        domain_start: int,
        domain_end: int,
        breakpoint: Optional[int],
        position: str
    ) -> str:
        """Determine if a domain is retained, truncated, or lost."""
        if breakpoint is None:
            return "unknown"

        if position == "5prime":
            # For 5' gene, we keep everything before the breakpoint
            if domain_end <= breakpoint:
                return "retained"
            elif domain_start >= breakpoint:
                return "lost"
            else:
                return "truncated"
        else:
            # For 3' gene, we keep everything after the breakpoint
            if domain_start >= breakpoint:
                return "retained"
            elif domain_end <= breakpoint:
                return "lost"
            else:
                return "truncated"

    async def _build_fusion_sequence(
        self,
        transcript_a: Optional[Transcript],
        aa_breakpoint_a: Optional[int],
        transcript_b: Optional[Transcript],
        aa_breakpoint_b: Optional[int]
    ) -> Optional[str]:
        """Build the fusion protein sequence."""
        if not transcript_a or not transcript_b:
            return None

        # Get proteins
        result_a = await self.db.execute(
            select(Protein).where(Protein.transcript_id == transcript_a.id)
        )
        protein_a = result_a.scalar_one_or_none()

        result_b = await self.db.execute(
            select(Protein).where(Protein.transcript_id == transcript_b.id)
        )
        protein_b = result_b.scalar_one_or_none()

        if not protein_a or not protein_b:
            return None

        seq_a = protein_a.sequence or ""
        seq_b = protein_b.sequence or ""

        if not seq_a or not seq_b:
            return None

        # Truncate and join sequences
        if aa_breakpoint_a and aa_breakpoint_a <= len(seq_a):
            seq_a_part = seq_a[:aa_breakpoint_a]
        else:
            seq_a_part = seq_a

        if aa_breakpoint_b and aa_breakpoint_b <= len(seq_b):
            seq_b_part = seq_b[aa_breakpoint_b - 1:]
        else:
            seq_b_part = seq_b

        return seq_a_part + seq_b_part

    def _check_kinase_domains(
        self,
        domains_a: List[DomainInfo],
        domains_b: List[DomainInfo]
    ) -> Tuple[bool, Optional[bool]]:
        """Check if fusion has kinase domain and if it's retained."""
        has_kinase = False
        kinase_retained = None

        for domain in domains_a + domains_b:
            if domain.is_kinase:
                has_kinase = True
                if domain.status == "retained":
                    kinase_retained = True
                elif domain.status == "lost" and kinase_retained is None:
                    kinase_retained = False
                elif domain.status == "truncated":
                    kinase_retained = False

        return has_kinase, kinase_retained

    def _calculate_confidence(
        self,
        junction_reads: Optional[int],
        spanning_reads: Optional[int],
        is_in_frame: Optional[bool]
    ) -> str:
        """Calculate confidence level."""
        total_reads = (junction_reads or 0) + (spanning_reads or 0)

        if total_reads >= 10 and is_in_frame:
            return "high"
        elif total_reads >= 5:
            return "medium"
        else:
            return "low"
