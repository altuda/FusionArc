"""
InterPro API client for comprehensive protein domain annotations.

InterPro integrates domain data from multiple sources:
- Pfam
- SMART
- CDD (Conserved Domain Database)
- PROSITE
- Gene3D
- Superfamily
- PANTHER
- PRINTS
- HAMAP
- TIGRFAMs
"""

import httpx
import asyncio
from typing import Optional, List, Dict, Any
from tenacity import retry, stop_after_attempt, wait_exponential
import logging

logger = logging.getLogger(__name__)

INTERPRO_API_BASE = "https://www.ebi.ac.uk/interpro/api"


class InterProClient:
    """Async client for InterPro REST API."""

    def __init__(self):
        self._semaphore = asyncio.Semaphore(5)  # Rate limit

    async def _request(self, endpoint: str, params: Optional[Dict] = None) -> Any:
        """Make a rate-limited request to InterPro API."""
        async with self._semaphore:
            async with httpx.AsyncClient(timeout=60.0) as client:
                url = f"{INTERPRO_API_BASE}{endpoint}"
                headers = {"Accept": "application/json"}
                response = await client.get(url, params=params, headers=headers)
                response.raise_for_status()
                return response.json()

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def get_protein_entries(self, uniprot_id: str) -> List[Dict[str, Any]]:
        """
        Get all InterPro entries (domains) for a UniProt protein.

        Returns comprehensive domain annotations from all member databases.
        """
        try:
            # Get entries for the protein
            endpoint = f"/entry/all/protein/uniprot/{uniprot_id}"
            data = await self._request(endpoint)

            entries = []
            if "results" in data:
                for entry in data["results"]:
                    entry_info = entry.get("metadata", {})
                    proteins = entry.get("proteins", [])

                    # Get locations for this protein
                    for protein in proteins:
                        if protein.get("accession", "").upper() == uniprot_id.upper():
                            for location in protein.get("entry_protein_locations", []):
                                for fragment in location.get("fragments", []):
                                    entries.append({
                                        "interpro_id": entry_info.get("accession"),
                                        "name": entry_info.get("name"),
                                        "description": entry_info.get("description", {}).get("text", ""),
                                        "type": entry_info.get("type"),  # domain, family, repeat, etc.
                                        "source": entry_info.get("source_database", "InterPro"),
                                        "start": fragment.get("start"),
                                        "end": fragment.get("end"),
                                    })

            return entries
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                logger.warning(f"No InterPro entries found for {uniprot_id}")
                return []
            raise
        except Exception as e:
            logger.error(f"Error fetching InterPro entries for {uniprot_id}: {e}")
            return []

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def get_protein_by_gene(self, gene_symbol: str, species: str = "homo_sapiens") -> Optional[str]:
        """
        Search for UniProt ID by gene symbol.
        Returns the reviewed (SwissProt) entry if available.
        """
        try:
            # Search UniProt for the gene
            async with self._semaphore:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    # Use UniProt's search API
                    url = "https://rest.uniprot.org/uniprotkb/search"
                    params = {
                        "query": f"(gene:{gene_symbol}) AND (organism_id:9606) AND (reviewed:true)",
                        "format": "json",
                        "size": 1
                    }
                    response = await client.get(url, params=params)
                    response.raise_for_status()
                    data = response.json()

                    if data.get("results"):
                        return data["results"][0].get("primaryAccession")

                    # Try unreviewed if no reviewed entry
                    params["query"] = f"(gene:{gene_symbol}) AND (organism_id:9606)"
                    response = await client.get(url, params=params)
                    response.raise_for_status()
                    data = response.json()

                    if data.get("results"):
                        return data["results"][0].get("primaryAccession")

                    return None
        except Exception as e:
            logger.error(f"Error searching UniProt for {gene_symbol}: {e}")
            return None

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def get_uniprot_features(self, uniprot_id: str) -> List[Dict[str, Any]]:
        """
        Get protein features directly from UniProt.
        This includes domains, regions, sites, etc.
        """
        try:
            async with self._semaphore:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    url = f"https://rest.uniprot.org/uniprotkb/{uniprot_id}"
                    params = {"format": "json"}
                    response = await client.get(url, params=params)
                    response.raise_for_status()
                    data = response.json()

                    features = []
                    for feature in data.get("features", []):
                        feat_type = feature.get("type", "")

                        # Only include domain-like features
                        if feat_type in ["Domain", "Region", "Repeat", "Zinc finger",
                                        "DNA binding", "Motif", "Coiled coil",
                                        "Compositional bias", "Transmembrane"]:
                            location = feature.get("location", {})
                            start = location.get("start", {}).get("value")
                            end = location.get("end", {}).get("value")

                            if start and end:
                                features.append({
                                    "name": feature.get("description", feat_type),
                                    "type": feat_type,
                                    "source": "UniProt",
                                    "start": start,
                                    "end": end,
                                    "description": feature.get("description", "")
                                })

                    # Also get cross-references to domain databases
                    for xref in data.get("uniProtKBCrossReferences", []):
                        db = xref.get("database", "")
                        if db in ["Pfam", "SMART", "SUPFAM", "CDD", "Gene3D", "PROSITE"]:
                            properties = {p.get("key"): p.get("value")
                                        for p in xref.get("properties", [])}

                            # Parse entry count and positions if available
                            entry_name = properties.get("EntryName", xref.get("id", ""))
                            match_status = properties.get("MatchStatus", "")

                            features.append({
                                "name": entry_name,
                                "accession": xref.get("id"),
                                "type": "Domain",
                                "source": db,
                                "description": f"{db}: {entry_name}",
                                "match_status": match_status
                            })

                    return features
        except Exception as e:
            logger.error(f"Error fetching UniProt features for {uniprot_id}: {e}")
            return []

    async def get_comprehensive_domains(
        self,
        gene_symbol: str,
        protein_length: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Get comprehensive domain annotations for a gene from multiple sources.

        Combines:
        - InterPro (aggregates Pfam, SMART, CDD, etc.)
        - UniProt features

        Returns deduplicated, merged domain list.
        """
        domains = []

        # First, get UniProt ID
        uniprot_id = await self.get_protein_by_gene(gene_symbol)
        if not uniprot_id:
            logger.warning(f"No UniProt ID found for {gene_symbol}")
            return domains

        logger.info(f"Found UniProt ID {uniprot_id} for {gene_symbol}")

        # Fetch from both sources in parallel
        interpro_task = self.get_protein_entries(uniprot_id)
        uniprot_task = self.get_uniprot_features(uniprot_id)

        interpro_entries, uniprot_features = await asyncio.gather(
            interpro_task, uniprot_task, return_exceptions=True
        )

        # Process InterPro entries
        if isinstance(interpro_entries, list):
            for entry in interpro_entries:
                if entry.get("start") and entry.get("end"):
                    domains.append({
                        "name": entry.get("name", "Unknown"),
                        "description": entry.get("description"),
                        "source": entry.get("source", "InterPro"),
                        "accession": entry.get("interpro_id"),
                        "start": entry["start"],
                        "end": entry["end"],
                        "type": entry.get("type", "domain")
                    })

        # Process UniProt features
        if isinstance(uniprot_features, list):
            for feature in uniprot_features:
                if feature.get("start") and feature.get("end"):
                    domains.append({
                        "name": feature.get("name", "Unknown"),
                        "description": feature.get("description"),
                        "source": feature.get("source", "UniProt"),
                        "accession": feature.get("accession"),
                        "start": feature["start"],
                        "end": feature["end"],
                        "type": feature.get("type", "domain")
                    })

        # Deduplicate by name + position
        seen = set()
        unique_domains = []
        for d in domains:
            name = d.get("name") or "Unknown"
            key = (name.lower(), d["start"], d["end"])
            if key not in seen:
                seen.add(key)
                unique_domains.append(d)

        # Sort by start position
        unique_domains.sort(key=lambda x: (x["start"], x["end"]))

        logger.info(f"Found {len(unique_domains)} domains for {gene_symbol}")
        return unique_domains


# Singleton client
_interpro_client: Optional[InterProClient] = None


def get_interpro_client() -> InterProClient:
    """Get or create the InterPro client instance."""
    global _interpro_client
    if _interpro_client is None:
        _interpro_client = InterProClient()
    return _interpro_client
