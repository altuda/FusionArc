from abc import ABC, abstractmethod
from typing import List
from app.schemas.fusion import FusionCreate


class BaseFusionParser(ABC):
    """Base class for fusion file parsers."""

    @abstractmethod
    def parse(self, content: str) -> List[FusionCreate]:
        """Parse file content and return list of fusion objects."""
        pass

    @staticmethod
    def parse_breakpoint(breakpoint_str: str) -> tuple[str, int, str]:
        """Parse breakpoint string in format chr:pos:strand."""
        parts = breakpoint_str.split(":")
        if len(parts) != 3:
            raise ValueError(f"Invalid breakpoint format: {breakpoint_str}")
        chromosome = parts[0].replace("chr", "")
        position = int(parts[1])
        strand = parts[2]
        return chromosome, position, strand
