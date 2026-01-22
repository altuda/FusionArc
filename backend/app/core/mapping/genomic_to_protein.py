from typing import Optional, List, Dict, Any, Tuple
from app.external.ensembl import EnsemblClient


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
        """Calculate CDS position from genomic position."""
        cds_position = 0
        is_negative_strand = strand == "-"

        # Sort exons by genomic position
        sorted_exons = sorted(exons, key=lambda e: e["start"])
        if is_negative_strand:
            sorted_exons = sorted(exons, key=lambda e: e["end"], reverse=True)

        for exon in sorted_exons:
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
                    # For negative strand, count from the end
                    position_in_exon = coding_end - genomic_pos
                else:
                    # For positive strand, count from the start
                    position_in_exon = genomic_pos - coding_start

                return cds_position + position_in_exon + 1

            # Add this exon's coding length to running total
            coding_length = coding_end - coding_start + 1
            cds_position += coding_length

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
            return None

        transcript = await self.ensembl.get_transcript(transcript_id)
        if not transcript:
            return None

        translation = transcript.get("Translation", {})
        cds_start = translation.get("start")
        cds_end = translation.get("end")

        # Calculate CDS position
        cds_pos = self._calculate_cds_position(
            position, strand,
            transcript.get("Exon", []),
            cds_start, cds_end
        )

        if cds_pos is None:
            return None

        # Frame is position modulo 3
        return (cds_pos - 1) % 3

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
        Determine if a fusion is in-frame.

        A fusion is in-frame if the combined reading frames result in
        continuation of the correct codon structure.
        """
        frame_a = await self.calculate_frame(breakpoint_a, strand_a, transcript_a)
        frame_b = await self.calculate_frame(breakpoint_b, strand_b, transcript_b)

        if frame_a is None or frame_b is None:
            return None

        # For in-frame fusion, phases must complement each other
        # Phase at gene A end + phase at gene B start should = 0 (mod 3)
        # This depends on the strand orientations
        return (frame_a + frame_b) % 3 == 0
