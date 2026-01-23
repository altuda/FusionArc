import logging
from typing import Optional, List, Dict, Any, Tuple
from app.external.ensembl import EnsemblClient

logger = logging.getLogger(__name__)


class GenomicToProteinMapper:
    """Maps genomic coordinates to protein/amino acid positions."""

    def __init__(self, ensembl_client: EnsemblClient):
        self.ensembl = ensembl_client

    async def map_genomic_to_aa(
        self,
        chromosome: str,
        position: int,
        strand: str,
        transcript_id: str
    ) -> Optional[int]:
        """
        Map a genomic position to amino acid position.

        Args:
            chromosome: Chromosome name (e.g., "22" or "chr22")
            position: Genomic position (1-based)
            strand: Strand ("+" or "-")
            transcript_id: Ensembl transcript ID

        Returns:
            Amino acid position (1-based) or None if not in coding region
        """
        # Get transcript with exons
        transcript = await self.ensembl.get_transcript(transcript_id)
        if not transcript:
            return None

        # Get exons sorted by rank
        exons = sorted(
            transcript.get("Exon", []),
            key=lambda e: e.get("rank", 0)
        )
        if not exons:
            return None

        # Get CDS info
        translation = transcript.get("Translation", {})
        if not translation:
            return None

        cds_start = translation.get("start")
        cds_end = translation.get("end")

        if not cds_start or not cds_end:
            return None

        # Calculate CDS position
        cds_position = self._calculate_cds_position(
            position, strand, exons, cds_start, cds_end
        )

        if cds_position is None or cds_position < 1:
            return None

        # Convert CDS position to amino acid position
        aa_position = (cds_position - 1) // 3 + 1
        return aa_position

    def _calculate_cds_position(
        self,
        genomic_pos: int,
        strand: str,
        exons: List[Dict],
        cds_start: int,
        cds_end: int
    ) -> Optional[int]:
        """Calculate CDS position from genomic position.

        For intronic positions, returns the CDS position at the nearest exon boundary.
        """
        cds_position = 0
        is_negative_strand = strand == "-"

        # Sort exons by genomic position
        sorted_exons = sorted(exons, key=lambda e: e["start"])
        if is_negative_strand:
            sorted_exons = sorted(exons, key=lambda e: e["end"], reverse=True)

        prev_coding_end_pos = 0  # Track CDS position at end of previous exon

        for i, exon in enumerate(sorted_exons):
            exon_start = exon["start"]
            exon_end = exon["end"]

            # Determine coding portion of this exon
            coding_start = max(exon_start, cds_start)
            coding_end = min(exon_end, cds_end)

            if coding_start > coding_end:
                continue  # No coding region in this exon

            # Check if position falls within this exon's coding region
            if coding_start <= genomic_pos <= coding_end:
                if is_negative_strand:
                    position_in_exon = coding_end - genomic_pos
                else:
                    position_in_exon = genomic_pos - coding_start
                return cds_position + position_in_exon + 1

            # Check if position is in intron BEFORE this exon (for + strand)
            # or AFTER this exon (for - strand)
            if not is_negative_strand:
                if i > 0 and genomic_pos < coding_start:
                    # Position is in intron before this exon - use end of previous exon
                    prev_exon = sorted_exons[i - 1]
                    prev_coding_end = min(prev_exon["end"], cds_end)
                    if prev_coding_end >= cds_start and genomic_pos > prev_exon["end"]:
                        logger.debug(f"Intronic position {genomic_pos} mapped to exon boundary at CDS pos {prev_coding_end_pos}")
                        return prev_coding_end_pos
            else:
                if i > 0 and genomic_pos > coding_end:
                    # For negative strand, position after this exon
                    prev_exon = sorted_exons[i - 1]
                    prev_coding_start = max(prev_exon["start"], cds_start)
                    if prev_coding_start <= cds_end and genomic_pos < prev_exon["start"]:
                        logger.debug(f"Intronic position {genomic_pos} mapped to exon boundary at CDS pos {prev_coding_end_pos}")
                        return prev_coding_end_pos

            # Add this exon's coding length to running total
            coding_length = coding_end - coding_start + 1
            cds_position += coding_length
            prev_coding_end_pos = cds_position

        # If position is after all exons, return the last CDS position
        if prev_coding_end_pos > 0:
            if (not is_negative_strand and genomic_pos > cds_end) or \
               (is_negative_strand and genomic_pos < cds_start):
                return prev_coding_end_pos

        return None

    async def get_exon_at_position(
        self,
        position: int,
        transcript_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get the exon containing a genomic position."""
        transcript = await self.ensembl.get_transcript(transcript_id)
        if not transcript:
            return None

        for exon in transcript.get("Exon", []):
            if exon["start"] <= position <= exon["end"]:
                return exon
        return None

    async def calculate_frame(
        self,
        position: int,
        strand: str,
        transcript_id: str
    ) -> Optional[int]:
        """
        Calculate the reading frame phase at a genomic position.

        Returns:
            0, 1, or 2 indicating the codon phase, or None if not in CDS
        """
        aa_pos = await self.map_genomic_to_aa(
            "", position, strand, transcript_id
        )
        if aa_pos is None:
            logger.debug(f"calculate_frame: aa_pos is None for {transcript_id} at position {position}")
            return None

        transcript = await self.ensembl.get_transcript(transcript_id)
        if not transcript:
            logger.warning(f"calculate_frame: transcript not found for {transcript_id}")
            return None

        translation = transcript.get("Translation", {})
        if not translation:
            logger.warning(f"calculate_frame: no Translation data for {transcript_id}")
            return None

        cds_start = translation.get("start")
        cds_end = translation.get("end")

        logger.debug(f"calculate_frame: {transcript_id} CDS range: {cds_start}-{cds_end}, position: {position}")

        # Calculate CDS position
        cds_pos = self._calculate_cds_position(
            position, strand,
            transcript.get("Exon", []),
            cds_start, cds_end
        )

        if cds_pos is None:
            logger.debug(f"calculate_frame: cds_pos is None (breakpoint {position} outside CDS {cds_start}-{cds_end})")
            return None

        # Frame is position modulo 3
        frame = (cds_pos - 1) % 3
        logger.debug(f"calculate_frame: cds_pos={cds_pos}, frame={frame}")
        return frame

    async def is_in_frame_fusion(
        self,
        breakpoint_a: int,
        strand_a: str,
        transcript_a: str,
        breakpoint_b: int,
        strand_b: str,
        transcript_b: str
    ) -> Optional[bool]:
        """
        Determine if a fusion is in-frame using the AGFusion algorithm.

        A fusion is in-frame if:
        1. Both CDS lengths (5' up to breakpoint, 3' from breakpoint) are divisible by 3, OR
        2. The remainders when divided by 3 sum to 3 (complementary frames)
        """
        # Get CDS length for 5' partner (from start to breakpoint)
        cds_len_5prime = await self._get_cds_length_to_breakpoint(
            transcript_a, breakpoint_a, strand_a, is_5prime=True
        )

        # Get CDS length for 3' partner (from breakpoint to end)
        cds_len_3prime = await self._get_cds_length_to_breakpoint(
            transcript_b, breakpoint_b, strand_b, is_5prime=False
        )

        logger.info(f"is_in_frame_fusion: cds_len_5prime={cds_len_5prime}, cds_len_3prime={cds_len_3prime}")

        if cds_len_5prime is None or cds_len_3prime is None:
            logger.warning(f"is_in_frame_fusion: Cannot determine CDS lengths")
            return None

        # Check frame compatibility (AGFusion algorithm)
        remainder_5 = cds_len_5prime % 3
        remainder_3 = cds_len_3prime % 3

        # In-frame if both are divisible by 3
        if remainder_5 == 0 and remainder_3 == 0:
            logger.info(f"is_in_frame_fusion: Both divisible by 3 -> in-frame")
            return True

        # In-frame (with junction mutation) if remainders sum to 3
        if remainder_5 + remainder_3 == 3:
            logger.info(f"is_in_frame_fusion: Remainders {remainder_5}+{remainder_3}=3 -> in-frame (with mutation)")
            return True

        logger.info(f"is_in_frame_fusion: Remainders {remainder_5}+{remainder_3}={remainder_5+remainder_3} -> out-of-frame")
        return False

    async def _get_cds_length_to_breakpoint(
        self,
        transcript_id: str,
        breakpoint: int,
        strand: str,
        is_5prime: bool
    ) -> Optional[int]:
        """
        Calculate the CDS length from start to breakpoint (5' gene) or
        from breakpoint to end (3' gene).

        This handles intronic breakpoints by finding the nearest exon boundary.
        """
        transcript = await self.ensembl.get_transcript(transcript_id)
        if not transcript:
            logger.warning(f"_get_cds_length: transcript not found for {transcript_id}")
            return None

        translation = transcript.get("Translation", {})
        if not translation:
            logger.warning(f"_get_cds_length: no Translation for {transcript_id}")
            return None

        cds_start = translation.get("start")
        cds_end = translation.get("end")
        exons = transcript.get("Exon", [])

        if not exons or not cds_start or not cds_end:
            return None

        is_negative_strand = strand == "-"

        # Sort exons by genomic position
        sorted_exons = sorted(exons, key=lambda e: e["start"])

        # Calculate CDS length and find where breakpoint falls
        total_cds_length = 0
        cds_before_breakpoint = 0
        breakpoint_found = False

        for exon in sorted_exons:
            exon_start = exon["start"]
            exon_end = exon["end"]

            # Determine coding portion of this exon
            coding_start = max(exon_start, cds_start)
            coding_end = min(exon_end, cds_end)

            if coding_start > coding_end:
                continue  # No coding region in this exon

            coding_length = coding_end - coding_start + 1

            if not breakpoint_found:
                if breakpoint < coding_start:
                    # Breakpoint is before this exon (in upstream intron or UTR)
                    # For 5' gene: include nothing from this exon onwards
                    # For 3' gene: include from this exon onwards
                    breakpoint_found = True
                elif breakpoint <= coding_end:
                    # Breakpoint is within this exon
                    if is_negative_strand:
                        cds_before_breakpoint += coding_end - breakpoint + 1
                    else:
                        cds_before_breakpoint += breakpoint - coding_start + 1
                    breakpoint_found = True
                else:
                    # Breakpoint is after this exon, include full exon
                    cds_before_breakpoint += coding_length

            total_cds_length += coding_length

        # Handle breakpoint after all exons
        if not breakpoint_found:
            cds_before_breakpoint = total_cds_length

        # For negative strand, we need to invert
        if is_negative_strand:
            cds_before_breakpoint = total_cds_length - cds_before_breakpoint

        if is_5prime:
            # 5' gene: return CDS length from start to breakpoint
            result = cds_before_breakpoint
        else:
            # 3' gene: return CDS length from breakpoint to end
            result = total_cds_length - cds_before_breakpoint

        logger.debug(f"_get_cds_length: {transcript_id} breakpoint={breakpoint} is_5prime={is_5prime} -> {result}")
        return result
