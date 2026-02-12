"""
cBioPortal API client for fetching mutation data.

cBioPortal aggregates mutation data from multiple sources including:
- TCGA (The Cancer Genome Atlas)
- MSK-IMPACT
- Various cancer genomics studies
"""

import httpx
import asyncio
from typing import Optional, List, Dict, Any
from tenacity import retry, stop_after_attempt, wait_exponential
import logging

from app.external.protein_utils import (
    extract_protein_position,
    three_to_one_aa,
    normalize_mutation_type,
)

logger = logging.getLogger(__name__)

CBIOPORTAL_API_BASE = "https://www.cbioportal.org/api"

# Major studies with good mutation coverage
DEFAULT_STUDY_IDS = [
    "msk_impact_2017",
    "msk_met_2021",
    "tcga_pan_can_atlas_2018",
    "coadread_tcga_pan_can_atlas_2018",
    "brca_tcga_pan_can_atlas_2018",
    "luad_tcga_pan_can_atlas_2018",
    "prad_tcga_pan_can_atlas_2018",
    "ov_tcga_pan_can_atlas_2018",
    "laml_tcga_pan_can_atlas_2018",
    "aml_ohsu_2018",
    "all_phase2_target_2018_pub",
    "nbl_target_2018_pub",
    "pediatric_dkfz_2017",
]


class CBioPortalClient:
    """Async client for cBioPortal REST API."""

    def __init__(self):
        self._semaphore = asyncio.Semaphore(5)  # Rate limit
        self._study_profiles_cache: Dict[str, Optional[str]] = {}

    async def _request(
        self,
        method: str,
        endpoint: str,
        params: Optional[Dict] = None,
        json_data: Optional[Any] = None
    ) -> Any:
        """Make a rate-limited request to cBioPortal API."""
        async with self._semaphore:
            async with httpx.AsyncClient(timeout=60.0) as client:
                url = f"{CBIOPORTAL_API_BASE}{endpoint}"
                headers = {"Accept": "application/json"}

                try:
                    if method == "GET":
                        response = await client.get(url, params=params, headers=headers)
                    else:
                        headers["Content-Type"] = "application/json"
                        response = await client.post(url, params=params, json=json_data, headers=headers)

                    response.raise_for_status()
                    return response.json()
                except httpx.HTTPStatusError as e:
                    logger.warning(f"cBioPortal API error {e.response.status_code} for {endpoint}")
                    raise
                except Exception as e:
                    logger.warning(f"cBioPortal request failed for {endpoint}: {e}")
                    raise

    async def _get_mutation_profile_id(self, study_id: str) -> Optional[str]:
        """Get the mutation molecular profile ID for a study."""
        if study_id in self._study_profiles_cache:
            return self._study_profiles_cache[study_id]

        try:
            profiles = await self._request(
                "GET",
                f"/studies/{study_id}/molecular-profiles"
            )

            for profile in profiles:
                if profile.get("molecularAlterationType") == "MUTATION_EXTENDED":
                    profile_id = profile.get("molecularProfileId")
                    self._study_profiles_cache[study_id] = profile_id
                    return profile_id

            self._study_profiles_cache[study_id] = None
            return None

        except Exception:
            self._study_profiles_cache[study_id] = None
            return None

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def get_gene_mutations(
        self,
        gene_symbol: str,
        study_ids: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """
        Get mutations for a gene across cancer studies.

        Returns list of mutations with position, amino acid change, type, and frequency.
        """
        try:
            # First, get the gene's Entrez ID using the search endpoint
            # The /genes/{symbol} endpoint doesn't exist - must use /genes?keyword=SYMBOL
            genes = await self._request("GET", "/genes", params={"keyword": gene_symbol})
            if not genes or len(genes) == 0:
                logger.warning(f"Gene {gene_symbol} not found in cBioPortal")
                return []

            gene_info = genes[0]  # Take first match
            entrez_id = gene_info.get("entrezGeneId")
            if not entrez_id:
                logger.warning(f"No Entrez ID for {gene_symbol}")
                return []

            logger.info(f"Found {gene_symbol} with Entrez ID {entrez_id}")

            # Use default studies if none specified
            if not study_ids:
                study_ids = DEFAULT_STUDY_IDS

            # Get mutation profiles for all studies in parallel
            profile_tasks = [self._get_mutation_profile_id(study_id) for study_id in study_ids]
            profile_results = await asyncio.gather(*profile_tasks, return_exceptions=True)

            # Collect valid profile IDs
            valid_profiles = []
            for study_id, result in zip(study_ids, profile_results):
                if isinstance(result, str) and result:
                    valid_profiles.append(result)

            if not valid_profiles:
                logger.warning(f"No mutation profiles found for studies")
                return []

            logger.info(f"Querying {len(valid_profiles)} mutation profiles for {gene_symbol}")

            # Query mutations using the bulk endpoint
            all_mutations = []

            # Query each profile (cBioPortal doesn't support bulk gene queries well)
            mutation_tasks = []
            for profile_id in valid_profiles:
                mutation_tasks.append(
                    self._fetch_mutations_for_profile(profile_id, entrez_id)
                )

            mutation_results = await asyncio.gather(*mutation_tasks, return_exceptions=True)

            for result in mutation_results:
                if isinstance(result, list):
                    all_mutations.extend(result)

            logger.info(f"Found {len(all_mutations)} total mutations for {gene_symbol}")
            return all_mutations

        except Exception as e:
            logger.error(f"Error fetching mutations for {gene_symbol}: {e}")
            return []

    async def _fetch_mutations_for_profile(
        self,
        profile_id: str,
        entrez_id: int
    ) -> List[Dict[str, Any]]:
        """Fetch mutations for a gene in a specific molecular profile."""
        try:
            mutations = await self._request(
                "GET",
                f"/molecular-profiles/{profile_id}/mutations",
                params={"entrezGeneId": entrez_id}
            )

            result = []
            for mut in mutations:
                protein_change = mut.get("proteinChange", "")
                aa_position = self._parse_protein_position(protein_change)

                if aa_position:
                    result.append({
                        "position": aa_position,
                        "protein_change": protein_change,
                        "mutation_type": mut.get("mutationType", "unknown"),
                        "variant_type": mut.get("variantType", ""),
                        "study_id": profile_id,
                        "sample_id": mut.get("sampleId"),
                        "ref_aa": self._extract_ref_aa(protein_change),
                        "alt_aa": self._extract_alt_aa(protein_change),
                    })

            return result

        except Exception as e:
            logger.debug(f"Error fetching from {profile_id}: {e}")
            return []

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def get_mutation_counts(
        self,
        gene_symbol: str,
        protein_length: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Get aggregated mutation counts by position for a gene.

        Returns mutations with count/frequency data suitable for lollipop plot.
        """
        mutations = await self.get_gene_mutations(gene_symbol)

        if not mutations:
            logger.warning(f"No mutations found for {gene_symbol}")
            return []

        # Aggregate by position and amino acid change
        position_counts: Dict[str, Dict] = {}

        for mut in mutations:
            key = f"{mut['position']}_{mut['protein_change']}"

            if key not in position_counts:
                position_counts[key] = {
                    "position": mut["position"],
                    "ref_aa": mut["ref_aa"],
                    "alt_aa": mut["alt_aa"],
                    "label": mut["protein_change"],
                    "type": self._normalize_mutation_type(mut["mutation_type"]),
                    "count": 0,
                    "source": "cBioPortal",
                }

            position_counts[key]["count"] += 1

        # Convert to list and sort by count (most frequent first), then position
        result = list(position_counts.values())
        result.sort(key=lambda x: (-x["count"], x["position"]))

        logger.info(f"Aggregated to {len(result)} unique mutations for {gene_symbol}")
        return result

    def _parse_protein_position(self, protein_change: str) -> Optional[int]:
        """Extract amino acid position from protein change string (e.g., 'V600E' -> 600)."""
        return extract_protein_position(protein_change)

    def _extract_ref_aa(self, protein_change: str) -> str:
        """Extract reference amino acid from protein change."""
        if not protein_change:
            return ""

        if protein_change.startswith("p."):
            protein_change = protein_change[2:]

        # First character(s) before the number
        import re
        match = re.match(r'^([A-Z][a-z]{0,2})', protein_change)
        if match:
            aa = match.group(1)
            # Convert 3-letter to 1-letter if needed
            return self._three_to_one(aa)

        return ""

    def _extract_alt_aa(self, protein_change: str) -> str:
        """Extract alternate amino acid from protein change."""
        if not protein_change:
            return ""

        if protein_change.startswith("p."):
            protein_change = protein_change[2:]

        # Last character(s) after the number
        import re
        match = re.search(r'\d+([A-Z][a-z]{0,2}|\*|fs|del|ins|dup)$', protein_change)
        if match:
            aa = match.group(1)
            if aa == "*":
                return "*"
            if aa in ["fs", "del", "ins", "dup"]:
                return aa
            return self._three_to_one(aa)

        return ""

    def _three_to_one(self, aa: str) -> str:
        """Convert 3-letter amino acid code to 1-letter."""
        return three_to_one_aa(aa)

    def _normalize_mutation_type(self, mutation_type: str) -> str:
        """Normalize mutation type to standard categories."""
        return normalize_mutation_type(mutation_type)


# Singleton client
_cbioportal_client: Optional[CBioPortalClient] = None


def get_cbioportal_client() -> CBioPortalClient:
    """Get or create the cBioPortal client instance."""
    global _cbioportal_client
    if _cbioportal_client is None:
        _cbioportal_client = CBioPortalClient()
    return _cbioportal_client
