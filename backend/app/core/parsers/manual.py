import re
from typing import List, Optional
from app.core.parsers.base import BaseFusionParser
from app.schemas.fusion import FusionCreate, FusionManualInput


class ManualInputParser(BaseFusionParser):
    """Parser for manual gene fusion input."""

    def parse(self, content: str) -> List[FusionCreate]:
        """
        Parse batch manual input.

        Supports multiple formats (one per line):

        Format 1 (space-separated):
        GENE_A chr:pos:strand GENE_B chr:pos:strand [junction_reads] [spanning_reads]

        Format 2 (tab-separated, from frontend batch):
        GENE_A::GENE_B\tchr:pos:strand\tchr:pos:strand\t[genome_build]

        Example:
        BCR chr22:23632600:+ ABL1 chr9:130854064:-
        EML4 chr2:42492091:+ ALK chr2:29446394:- 50 30
        BCR::ABL1\tchr22:23524427:+\tchr9:133729449:+\thg38
        """
        fusions = []
        lines = content.strip().split("\n")

        for line in lines:
            line = line.strip()
            if not line or line.startswith("#"):
                continue

            try:
                fusion = self._parse_line(line)
                if fusion:
                    fusions.append(fusion)
            except (ValueError, IndexError) as e:
                continue

        return fusions

    def _parse_line(self, line: str) -> FusionCreate:
        """Parse a single line of manual input."""
        # Check if tab-separated (frontend batch format)
        if "\t" in line:
            return self._parse_tab_separated(line)

        # Space-separated format
        parts = line.split()
        if len(parts) < 4:
            raise ValueError(f"Invalid format: {line}")

        gene_a_symbol = parts[0]
        breakpoint_a = parts[1]
        gene_b_symbol = parts[2]
        breakpoint_b = parts[3]

        chr_a, pos_a, strand_a = self.parse_breakpoint(breakpoint_a)
        chr_b, pos_b, strand_b = self.parse_breakpoint(breakpoint_b)

        junction_reads = int(parts[4]) if len(parts) > 4 else None
        spanning_reads = int(parts[5]) if len(parts) > 5 else None

        return FusionCreate(
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

    def _parse_tab_separated(self, line: str) -> FusionCreate:
        """Parse tab-separated format from frontend batch input."""
        parts = line.split("\t")
        if len(parts) < 3:
            raise ValueError(f"Invalid tab-separated format: {line}")

        # Parse gene names from GENE_A::GENE_B format
        gene_part = parts[0]
        if "::" in gene_part:
            gene_names = gene_part.split("::")
            gene_a_symbol = gene_names[0].strip()
            gene_b_symbol = gene_names[1].strip()
        else:
            raise ValueError(f"Invalid gene format: {gene_part}")

        breakpoint_a = parts[1]
        breakpoint_b = parts[2]

        chr_a, pos_a, strand_a = self.parse_breakpoint(breakpoint_a)
        chr_b, pos_b, strand_b = self.parse_breakpoint(breakpoint_b)

        # Optional genome build (parts[3])
        genome_build = parts[3].strip() if len(parts) > 3 else "hg38"

        return FusionCreate(
            gene_a_symbol=gene_a_symbol,
            gene_a_chromosome=chr_a,
            gene_a_breakpoint=pos_a,
            gene_a_strand=strand_a,
            gene_b_symbol=gene_b_symbol,
            gene_b_chromosome=chr_b,
            gene_b_breakpoint=pos_b,
            gene_b_strand=strand_b,
            junction_reads=None,
            spanning_reads=None,
            genome_build=genome_build
        )

    @staticmethod
    def parse_manual_input(input_data: FusionManualInput) -> FusionCreate:
        """Parse a single manual fusion input from the form."""
        # Parse breakpoint A
        parts_a = input_data.gene_a_breakpoint.split(":")
        if len(parts_a) != 3:
            raise ValueError(f"Invalid breakpoint A format: {input_data.gene_a_breakpoint}")
        chr_a = parts_a[0].replace("chr", "")
        pos_a = int(parts_a[1])
        strand_a = parts_a[2]

        # Parse breakpoint B
        parts_b = input_data.gene_b_breakpoint.split(":")
        if len(parts_b) != 3:
            raise ValueError(f"Invalid breakpoint B format: {input_data.gene_b_breakpoint}")
        chr_b = parts_b[0].replace("chr", "")
        pos_b = int(parts_b[1])
        strand_b = parts_b[2]

        return FusionCreate(
            gene_a_symbol=input_data.gene_a_symbol,
            gene_a_chromosome=chr_a,
            gene_a_breakpoint=pos_a,
            gene_a_strand=strand_a,
            gene_b_symbol=input_data.gene_b_symbol,
            gene_b_chromosome=chr_b,
            gene_b_breakpoint=pos_b,
            gene_b_strand=strand_b,
            transcript_a_id=input_data.transcript_a_id,
            transcript_b_id=input_data.transcript_b_id,
            junction_reads=input_data.junction_reads,
            spanning_reads=input_data.spanning_reads,
            genome_build=input_data.genome_build
        )
