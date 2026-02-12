"""
Shared protein utility functions for position extraction, amino acid mapping,
and mutation type normalization. Used by cbioportal, clinvar_vcf, and gnomad modules.
"""

import re
from typing import Optional


def extract_protein_position(protein_change: str) -> Optional[int]:
    """
    Extract amino acid position from protein change notation.

    Handles formats like:
    - "p.Arg123Cys" or "p.R123C"
    - "V600E" (no prefix)
    - "p.Arg123_Lys125del"
    """
    if not protein_change:
        return None

    # Strip "p." prefix if present
    text = protein_change
    if text.startswith("p."):
        text = text[2:]

    # Match patterns with optional 3-letter AA code before digits
    match = re.search(r'([A-Z][a-z]{2})?(\d+)', text)
    if match:
        return int(match.group(2))

    # Fallback: any digits
    match = re.search(r'(\d+)', text)
    if match:
        return int(match.group(1))

    return None


def extract_position_from_hgvsc(hgvsc: str) -> Optional[int]:
    """
    Extract approximate protein position from HGVS coding notation.

    For intronic variants like:
    - c.213-259C>T -> near codon 213 -> protein pos ~71
    - c.212+11T>G -> near codon 212 -> protein pos ~71
    - c.781-7492C>G -> near codon 781 -> protein pos ~260
    """
    if not hgvsc:
        return None

    # Match patterns like "c.212+11T>G" or "c.781-7492C>G"
    match = re.search(r'c\.(\d+)[+-]', hgvsc)
    if match:
        codon_pos = int(match.group(1))
        return (codon_pos + 2) // 3

    # Match regular coding variants like "c.635G>A"
    match = re.search(r'c\.(\d+)', hgvsc)
    if match:
        codon_pos = int(match.group(1))
        return (codon_pos + 2) // 3

    return None


THREE_TO_ONE_MAP = {
    "Ala": "A", "Arg": "R", "Asn": "N", "Asp": "D",
    "Cys": "C", "Gln": "Q", "Glu": "E", "Gly": "G",
    "His": "H", "Ile": "I", "Leu": "L", "Lys": "K",
    "Met": "M", "Phe": "F", "Pro": "P", "Ser": "S",
    "Thr": "T", "Trp": "W", "Tyr": "Y", "Val": "V",
    "Ter": "*",
}


def three_to_one_aa(code: str) -> str:
    """Convert 3-letter amino acid code to 1-letter. Returns input if not found."""
    return THREE_TO_ONE_MAP.get(code, code)


def format_protein_change(hgvsp: str) -> str:
    """Format HGVS protein notation into readable 1-letter label."""
    if not hgvsp:
        return ""

    # Remove protein prefix
    text = hgvsp
    if text.startswith("p."):
        text = text[2:]

    # Convert 3-letter to 1-letter codes
    result = text
    for three, one in THREE_TO_ONE_MAP.items():
        result = result.replace(three, one)

    return result


def normalize_mutation_type(raw_type: str) -> str:
    """
    Normalize mutation type string to standard categories.

    Returns one of: missense, nonsense, frameshift, silent, splice, inframe_indel, other.
    """
    if not raw_type:
        return "other"

    mt = raw_type.lower()

    if "missense" in mt:
        return "missense"
    if "nonsense" in mt or "stop_gained" in mt or "stop" in mt:
        return "nonsense"
    if "frameshift" in mt or "frame_shift" in mt:
        return "frameshift"
    if "silent" in mt or "synonymous" in mt:
        return "silent"
    if "splice" in mt:
        return "splice"
    if "inframe" in mt or "in_frame" in mt:
        return "inframe_indel"
    if "insertion" in mt or "deletion" in mt:
        return "inframe_indel"

    return "other"
