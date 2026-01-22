from typing import List
from app.core.parsers.base import BaseFusionParser
from app.schemas.fusion import FusionCreate


class ArribaParser(BaseFusionParser):
    """Parser for Arriba fusion output files."""

    def parse(self, content: str) -> List[FusionCreate]:
        """
        Parse Arriba TSV output.

        Expected columns:
        #gene1 gene2 strand1(gene/fusion) strand2(gene/fusion) breakpoint1 breakpoint2
        site1 site2 type direction split_reads1 split_reads2 discordant_mates ...
        """
        fusions = []
        lines = content.strip().split("\n")

        # Find header line
        header_idx = 0
        for i, line in enumerate(lines):
            if line.startswith("#gene1") or line.startswith("gene1"):
                header_idx = i
                break

        if header_idx >= len(lines) - 1:
            return fusions

        header = lines[header_idx].lstrip("#").split("\t")
        col_map = {col: i for i, col in enumerate(header)}

        for line in lines[header_idx + 1:]:
            if not line.strip() or line.startswith("#"):
                continue

            cols = line.split("\t")
            if len(cols) < 12:
                continue

            try:
                gene_a_symbol = cols[col_map.get("gene1", 0)]
                gene_b_symbol = cols[col_map.get("gene2", 1)]

                # Parse strands (Arriba format: strand1(gene/fusion))
                strand1_col = cols[col_map.get("strand1(gene/fusion)", 2)]
                strand2_col = cols[col_map.get("strand2(gene/fusion)", 3)]

                # Extract fusion strand (second value after /)
                strand_a = strand1_col.split("/")[1] if "/" in strand1_col else strand1_col
                strand_b = strand2_col.split("/")[1] if "/" in strand2_col else strand2_col

                # Parse breakpoints (format: chr:position)
                breakpoint1 = cols[col_map.get("breakpoint1", 4)]
                breakpoint2 = cols[col_map.get("breakpoint2", 5)]

                chr_a, pos_a = self._parse_arriba_breakpoint(breakpoint1)
                chr_b, pos_b = self._parse_arriba_breakpoint(breakpoint2)

                # Parse read counts
                split_reads1 = int(cols[col_map.get("split_reads1", 10)])
                split_reads2 = int(cols[col_map.get("split_reads2", 11)])
                discordant_mates = int(cols[col_map.get("discordant_mates", 12)])

                junction_reads = split_reads1 + split_reads2
                spanning_reads = discordant_mates

                fusion = FusionCreate(
                    gene_a_symbol=gene_a_symbol,
                    gene_a_chromosome=chr_a,
                    gene_a_breakpoint=pos_a,
                    gene_a_strand=strand_a,
                    gene_b_symbol=gene_b_symbol,
                    gene_b_chromosome=chr_b,
                    gene_b_breakpoint=pos_b,
                    gene_b_strand=strand_b,
                    junction_reads=junction_reads,
                    spanning_reads=spanning_reads
                )
                fusions.append(fusion)

            except (ValueError, IndexError, KeyError) as e:
                continue

        return fusions

    @staticmethod
    def _parse_arriba_breakpoint(breakpoint_str: str) -> tuple[str, int]:
        """Parse Arriba breakpoint format (chr:position)."""
        parts = breakpoint_str.split(":")
        if len(parts) != 2:
            raise ValueError(f"Invalid Arriba breakpoint format: {breakpoint_str}")
        chromosome = parts[0].replace("chr", "")
        position = int(parts[1])
        return chromosome, position
