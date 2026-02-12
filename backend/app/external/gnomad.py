"""
gnomAD API client for population variant frequency data.

gnomAD (Genome Aggregation Database) provides allele frequency data from
large-scale sequencing projects. Uses the public GraphQL API.

API Documentation: https://gnomad.broadinstitute.org/api
"""

import httpx
import asyncio
import re
from typing import Optional, List, Dict, Any
from tenacity import retry, stop_after_attempt, wait_exponential
import logging

from app.external.protein_utils import (
    extract_protein_position,
    extract_position_from_hgvsc,
    format_protein_change as _format_protein_change_util,
    normalize_mutation_type,
)

logger = logging.getLogger(__name__)

GNOMAD_API_URL = "https://gnomad.broadinstitute.org/api"


class GnomADClient:
    """Async client for gnomAD GraphQL API."""

    def __init__(self):
        """Initialize gnomAD client with rate limiting."""
        self._semaphore = asyncio.Semaphore(5)  # Rate limit
        self._cache: Dict[str, Any] = {}

    async def _graphql_request(self, query: str, variables: Dict = None) -> Dict:
        """Make a rate-limited GraphQL request to gnomAD."""
        async with self._semaphore:
            async with httpx.AsyncClient(timeout=60.0) as client:
                try:
                    response = await client.post(
                        GNOMAD_API_URL,
                        json={"query": query, "variables": variables or {}},
                        headers={"Content-Type": "application/json"}
                    )
                    response.raise_for_status()
                    result = response.json()

                    if "errors" in result:
                        logger.warning(f"gnomAD API errors: {result['errors']}")

                    return result.get("data", {})

                except httpx.HTTPStatusError as e:
                    logger.warning(f"gnomAD API error {e.response.status_code}")
                    raise
                except Exception as e:
                    logger.warning(f"gnomAD request failed: {e}")
                    raise

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def get_gene_variants(
        self,
        gene_symbol: str,
        dataset: str = "gnomad_r4",
        reference_genome: str = "GRCh38"
    ) -> List[Dict[str, Any]]:
        """
        Get variant frequencies for a gene from gnomAD.

        Args:
            gene_symbol: Gene symbol (e.g., 'BRCA1')
            dataset: gnomAD dataset version (gnomad_r4, gnomad_r3, gnomad_r2_1)
            reference_genome: Reference genome (GRCh38 or GRCh37)

        Returns:
            List of variants with allele frequencies (including intronic)
        """
        cache_key = f"{gene_symbol}_{dataset}_{reference_genome}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        # GraphQL query for gene variants - get ALL variants including intronic
        query = """
        query GeneVariants($geneSymbol: String!, $datasetId: DatasetId!, $referenceGenome: ReferenceGenomeId!) {
          gene(gene_symbol: $geneSymbol, reference_genome: $referenceGenome) {
            variants(dataset: $datasetId) {
              variant_id
              chrom
              pos
              ref
              alt
              exome {
                ac
                an
                af
                homozygote_count
              }
              genome {
                ac
                an
                af
                homozygote_count
              }
              hgvsp
              hgvsc
              consequence
              lof
              flags
            }
          }
        }
        """

        try:
            result = await self._graphql_request(
                query,
                {
                    "geneSymbol": gene_symbol,
                    "datasetId": dataset,
                    "referenceGenome": reference_genome
                }
            )

            gene_data = result.get("gene")
            if not gene_data:
                logger.info(f"No gnomAD data for gene {gene_symbol}")
                return []

            variants = gene_data.get("variants", []) or []

            # Parse ALL variants (not just coding)
            parsed_variants = []
            for v in variants:
                parsed = self._parse_variant(v)
                if parsed:
                    parsed_variants.append(parsed)

            self._cache[cache_key] = parsed_variants
            logger.info(f"Found {len(parsed_variants)} gnomAD variants for {gene_symbol}")
            return parsed_variants

        except Exception as e:
            logger.error(f"Error fetching gnomAD variants for {gene_symbol}: {e}")
            return []

    def _parse_variant(self, variant: Dict) -> Optional[Dict[str, Any]]:
        """Parse a gnomAD variant into a structured format."""
        try:
            # Get combined frequency - combine exome and genome if both available
            exome = variant.get("exome") or {}
            genome = variant.get("genome") or {}

            # Calculate combined AF if both are available
            exome_ac = exome.get("ac") or 0
            exome_an = exome.get("an") or 0
            genome_ac = genome.get("ac") or 0
            genome_an = genome.get("an") or 0

            total_ac = exome_ac + genome_ac
            total_an = exome_an + genome_an

            # Use combined AF, or individual if only one available
            if total_an > 0:
                af = total_ac / total_an
                ac = total_ac
                an = total_an
            elif exome.get("af") is not None:
                af = exome.get("af")
                ac = exome_ac
                an = exome_an
            elif genome.get("af") is not None:
                af = genome.get("af")
                ac = genome_ac
                an = genome_an
            else:
                af = None
                ac = None
                an = None

            # Skip variants without frequency
            if af is None:
                return None

            # Determine source
            source = []
            if exome_an > 0:
                source.append("exome")
            if genome_an > 0:
                source.append("genome")
            af_source = "+".join(source) if source else "unknown"

            # Parse position - use protein position if available, otherwise derive from hgvsc
            hgvsp = variant.get("hgvsp", "") or ""
            hgvsc = variant.get("hgvsc", "") or ""

            # Get protein position from hgvsp, or derive from hgvsc for intronic variants
            protein_position = self._extract_position(hgvsp)
            if protein_position is None and hgvsc:
                protein_position = self._extract_position_from_hgvsc(hgvsc)

            protein_change = self._format_protein_change(hgvsp)

            # For intronic/non-coding variants, use hgvsc as label
            if not protein_change and hgvsc:
                # Extract just the change part (e.g., "c.213-259C>T")
                if ":" in hgvsc:
                    protein_change = hgvsc.split(":")[-1]
                else:
                    protein_change = hgvsc

            # Create variant ID for lookup (chr-pos-ref-alt)
            variant_id = variant.get("variant_id", "")
            chrom = variant.get("chrom", "")
            pos = variant.get("pos")
            ref = variant.get("ref", "")
            alt = variant.get("alt", "")

            return {
                "variant_id": variant_id,
                "chrom": chrom,
                "genomic_pos": pos,
                "ref": ref,
                "alt": alt,
                "position": protein_position,  # Protein position (may be None for intronic)
                "protein_change": protein_change,
                "hgvsp": hgvsp,
                "hgvsc": hgvsc,
                "consequence": variant.get("consequence", ""),
                "af": af,
                "ac": ac,
                "an": an,
                "af_source": af_source,
                "lof": variant.get("lof"),
                "flags": variant.get("flags", []),
                "homozygote_count": (exome.get("homozygote_count") or 0) + (genome.get("homozygote_count") or 0)
            }

        except Exception as e:
            logger.debug(f"Error parsing gnomAD variant: {e}")
            return None

    def _extract_position(self, hgvsp: str) -> Optional[int]:
        """Extract amino acid position from HGVS protein notation."""
        return extract_protein_position(hgvsp)

    def _extract_position_from_hgvsc(self, hgvsc: str) -> Optional[int]:
        """Extract approximate protein position from HGVS coding notation."""
        return extract_position_from_hgvsc(hgvsc)

    def _format_protein_change(self, hgvsp: str) -> str:
        """Format HGVS protein notation into readable label."""
        return _format_protein_change_util(hgvsp)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def get_variant_by_position(
        self,
        gene_symbol: str,
        position: int,
        dataset: str = "gnomad_r4",
        reference_genome: str = "GRCh38"
    ) -> Optional[Dict[str, Any]]:
        """
        Get variant frequency for a specific position.

        Args:
            gene_symbol: Gene symbol
            position: Amino acid position
            dataset: gnomAD dataset version
            reference_genome: Reference genome

        Returns:
            Variant data if found, None otherwise
        """
        variants = await self.get_gene_variants(gene_symbol, dataset, reference_genome)

        for v in variants:
            if v.get("position") == position:
                return v

        return None

    async def get_variants_for_positions(
        self,
        gene_symbol: str,
        positions: List[int],
        dataset: str = "gnomad_r4",
        reference_genome: str = "GRCh38"
    ) -> Dict[int, Dict[str, Any]]:
        """
        Get variant frequencies for multiple positions.

        Args:
            gene_symbol: Gene symbol
            positions: List of amino acid positions
            dataset: gnomAD dataset version
            reference_genome: Reference genome

        Returns:
            Dict mapping position to variant data
        """
        variants = await self.get_gene_variants(gene_symbol, dataset, reference_genome)

        # Build position lookup
        position_set = set(positions)
        result = {}

        for v in variants:
            pos = v.get("position")
            if pos in position_set:
                # If multiple variants at same position, keep one with highest AF
                if pos not in result or (v.get("af") or 0) > (result[pos].get("af") or 0):
                    result[pos] = v

        return result

    def determine_mutation_type(self, consequence: str, lof: Optional[str] = None) -> str:
        """
        Determine mutation type from gnomAD consequence annotation.

        Args:
            consequence: gnomAD consequence term
            lof: Loss-of-function annotation

        Returns:
            Mutation type (missense, nonsense, frameshift, etc.)
        """
        if not consequence:
            return "other"

        consequence_lower = consequence.lower()

        # Check for loss-of-function
        if lof in ("HC", "LC"):  # High/Low confidence LoF
            if "frameshift" in consequence_lower:
                return "frameshift"
            if "stop_gained" in consequence_lower:
                return "nonsense"
            if "splice" in consequence_lower:
                return "splice"

        # Map consequence to mutation type
        if "missense" in consequence_lower:
            return "missense"
        if "stop_gained" in consequence_lower or "nonsense" in consequence_lower:
            return "nonsense"
        if "frameshift" in consequence_lower:
            return "frameshift"
        if "synonymous" in consequence_lower or "silent" in consequence_lower:
            return "silent"
        if "splice" in consequence_lower:
            return "splice"
        if "inframe" in consequence_lower:
            return "inframe_indel"

        return "other"

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def get_variant_by_id(
        self,
        variant_id: str,
        dataset: str = "gnomad_r4",
        reference_genome: str = "GRCh38"
    ) -> Optional[Dict[str, Any]]:
        """
        Get variant frequency by variant ID (chr-pos-ref-alt format).

        Args:
            variant_id: Variant ID in format "chr-pos-ref-alt" (e.g., "9-37015453-G-A")
            dataset: gnomAD dataset version
            reference_genome: Reference genome

        Returns:
            Variant data with AF if found
        """
        cache_key = f"variant_{variant_id}_{dataset}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        query = """
        query VariantById($variantId: String!, $datasetId: DatasetId!, $referenceGenome: ReferenceGenomeId!) {
          variant(variantId: $variantId, dataset: $datasetId) {
            variant_id
            chrom
            pos
            ref
            alt
            exome {
              ac
              an
              af
            }
            genome {
              ac
              an
              af
            }
          }
        }
        """

        try:
            result = await self._graphql_request(
                query,
                {
                    "variantId": variant_id,
                    "datasetId": dataset,
                    "referenceGenome": reference_genome
                }
            )

            variant = result.get("variant")
            if not variant:
                return None

            # Calculate combined AF
            exome = variant.get("exome") or {}
            genome = variant.get("genome") or {}

            exome_ac = exome.get("ac") or 0
            exome_an = exome.get("an") or 0
            genome_ac = genome.get("ac") or 0
            genome_an = genome.get("an") or 0

            total_ac = exome_ac + genome_ac
            total_an = exome_an + genome_an

            af = total_ac / total_an if total_an > 0 else None

            result_data = {
                "variant_id": variant_id,
                "af": af,
                "ac": total_ac,
                "an": total_an,
            }

            self._cache[cache_key] = result_data
            return result_data

        except Exception as e:
            logger.debug(f"Error fetching variant {variant_id}: {e}")
            return None

    def build_genomic_lookup(self, variants: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        """
        Build a lookup dictionary by genomic position for fast cross-referencing.

        Args:
            variants: List of parsed gnomAD variants

        Returns:
            Dict mapping "chr:pos:ref>alt" to variant data
        """
        lookup = {}
        for v in variants:
            chrom = v.get("chrom", "")
            pos = v.get("genomic_pos")
            ref = v.get("ref", "")
            alt = v.get("alt", "")

            if chrom and pos and ref and alt:
                # Create multiple key formats for flexible matching
                key1 = f"{chrom}:{pos}:{ref}>{alt}"
                key2 = f"chr{chrom}:{pos}:{ref}>{alt}"
                key3 = v.get("variant_id", "")  # chr-pos-ref-alt format

                for key in [key1, key2, key3]:
                    if key:
                        lookup[key] = v

        return lookup


# Singleton client
_gnomad_client: Optional[GnomADClient] = None


def get_gnomad_client() -> GnomADClient:
    """Get or create the gnomAD client instance."""
    global _gnomad_client
    if _gnomad_client is None:
        _gnomad_client = GnomADClient()
    return _gnomad_client
