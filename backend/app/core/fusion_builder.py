from typing import Optional, List, Dict, Any, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.external.ensembl import EnsemblClient
from app.core.mapping.genomic_to_protein import GenomicToProteinMapper
from app.models import Gene, Transcript, Protein, Domain, Fusion
from app.schemas.fusion import FusionCreate, DomainInfo
from datetime import datetime, timedelta


KINASE_KEYWORDS = ["kinase", "Kinase", "Pkinase", "TyrKc", "S_TKc", "STYKc"]
CACHE_EXPIRY_DAYS = 30


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
            is_in_frame = await self.mapper.is_in_frame_fusion(
                fusion_data.gene_a_breakpoint,
                fusion_data.gene_a_strand,
                transcript_a.id,
                fusion_data.gene_b_breakpoint,
                fusion_data.gene_b_strand,
                transcript_b.id
            )

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
            confidence=confidence
        )

        self.db.add(fusion)
        await self.db.commit()
        await self.db.refresh(fusion)

        return fusion

    async def _get_or_fetch_gene(self, symbol: str) -> Optional[Gene]:
        """Get gene from cache or fetch from Ensembl."""
        # Check cache
        result = await self.db.execute(
            select(Gene).where(Gene.symbol == symbol)
        )
        gene = result.scalar_one_or_none()

        # Check if cache is fresh
        if gene and gene.cached_at:
            if datetime.utcnow() - gene.cached_at < timedelta(days=CACHE_EXPIRY_DAYS):
                return gene

        # Fetch from Ensembl
        gene_data = await self.ensembl.search_gene(symbol)
        if not gene_data:
            return None

        # Create or update cache
        if not gene:
            gene = Gene(id=gene_data["id"])

        gene.symbol = gene_data.get("display_name", symbol)
        gene.name = gene_data.get("description", "")
        gene.chromosome = gene_data.get("seq_region_name", "")
        gene.start = gene_data.get("start")
        gene.end = gene_data.get("end")
        gene.strand = gene_data.get("strand")
        gene.biotype = gene_data.get("biotype")
        gene.cached_at = datetime.utcnow()

        self.db.add(gene)
        await self.db.commit()

        # Cache transcripts
        for trans_data in gene_data.get("Transcript", []):
            await self._cache_transcript(gene.id, trans_data)

        return gene

    async def _cache_transcript(self, gene_id: str, trans_data: Dict) -> Transcript:
        """Cache a transcript and its related data."""
        result = await self.db.execute(
            select(Transcript).where(Transcript.id == trans_data["id"])
        )
        transcript = result.scalar_one_or_none()

        if not transcript:
            transcript = Transcript(id=trans_data["id"])

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

            # Cache protein
            await self._cache_protein(transcript.id, trans)

        self.db.add(transcript)
        await self.db.commit()

        return transcript

    async def _cache_protein(self, transcript_id: str, trans_data: Dict) -> Optional[Protein]:
        """Cache protein and its domains."""
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

        # Fetch and cache domains
        features = await self.ensembl.get_protein_features(protein_id)
        for feat in features:
            await self._cache_domain(protein_id, feat)

        return protein

    async def _cache_domain(self, protein_id: str, feat_data: Dict) -> Domain:
        """Cache a protein domain."""
        domain = Domain(
            protein_id=protein_id,
            name=feat_data.get("description", feat_data.get("type", "Unknown")),
            description=feat_data.get("description"),
            source=feat_data.get("type", "Unknown"),
            accession=feat_data.get("id"),
            start=feat_data.get("start"),
            end=feat_data.get("end"),
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
        if transcript_id:
            result = await self.db.execute(
                select(Transcript).where(Transcript.id == transcript_id)
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
                source=domain.source or "Unknown",
                accession=domain.accession,
                start=domain.start or 0,
                end=domain.end or 0,
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
