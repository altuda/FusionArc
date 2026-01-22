import re
from typing import List
from app.core.parsers.base import BaseFusionParser
from app.schemas.fusion import FusionCreate


class StarFusionParser(BaseFusionParser):
    """Parser for STAR-Fusion output files."""

    def parse(self, content: str) -> List[FusionCreate]:
        """
        Parse STAR-Fusion TSV output.

        Expected columns:
        #FusionName JunctionReadCount SpanningFragCount LeftGene LeftBreakpoint
        RightGene RightBreakpoint ...
        """
        fusions = []
        lines = content.strip().split("\n")

        # Find header line
        header_idx = 0
        for i, line in enumerate(lines):
            if line.startswith("#FusionName") or line.startswith("FusionName"):
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
            if len(cols) < 7:
                continue

            try:
                # Parse fusion name (GENE1--GENE2)
                fusion_name = cols[col_map.get("FusionName", 0)]
                gene_match = re.match(r"(\w+)--(\w+)", fusion_name)
                if not gene_match:
                    continue

                gene_a_symbol = gene_match.group(1)
                gene_b_symbol = gene_match.group(2)

                # Parse junction and spanning reads
                junction_reads = int(cols[col_map.get("JunctionReadCount", 1)])
                spanning_reads = int(cols[col_map.get("SpanningFragCount", 2)])

                # Parse breakpoints
                left_breakpoint = cols[col_map.get("LeftBreakpoint", 4)]
                right_breakpoint = cols[col_map.get("RightBreakpoint", 6)]

                chr_a, pos_a, strand_a = self.parse_breakpoint(left_breakpoint)
                chr_b, pos_b, strand_b = self.parse_breakpoint(right_breakpoint)

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
                # Skip malformed lines
                continue

        return fusions
