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

Also includes direct NCBI CDD querying for RPS-BLAST hits not in curated databases.
"""

import httpx
import asyncio
import re
import json
from typing import Optional, List, Dict, Any, Set
from tenacity import retry, stop_after_attempt, wait_exponential
import logging

logger = logging.getLogger(__name__)

INTERPRO_API_BASE = "https://www.ebi.ac.uk/interpro/api"
NCBI_CDD_API = "https://www.ncbi.nlm.nih.gov/Structure/cdd/wrpsb.cgi"

# Map CDD accession prefixes to source names
CDD_SOURCE_MAP = {
    "pfam": "Pfam",
    "smart": "SMART",
    "cd": "CDD",
    "COG": "COG",
    "PRK": "PRK",
    "TIGR": "TIGRFAMs",
    "PHA": "CDD",  # Phage clusters
}


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
    async def get_cdd_domains(self, uniprot_id: str, evalue_threshold: float = 0.01) -> List[Dict[str, Any]]:
        """
        Get domain hits directly from NCBI CDD using RPS-BLAST.

        This returns sequence similarity-based domain hits that may not be in
        curated databases like UniProt/InterPro. Uses the same data source as
        ProteinPaint.

        Args:
            uniprot_id: UniProt accession (e.g., Q92793)
            evalue_threshold: E-value cutoff for domain hits (default 0.01)
        """
        try:
            async with self._semaphore:
                async with httpx.AsyncClient(timeout=60.0) as client:
                    # Query NCBI CDD with UniProt ID
                    params = {
                        "seqinput": uniprot_id,
                        "dmode": "rep",  # Representative domains
                        "db": "cdd"      # Full CDD database
                    }
                    response = await client.get(NCBI_CDD_API, params=params)
                    response.raise_for_status()

                    # Parse the JavaScript-style response
                    text = response.text
                    match = re.search(r'let initObj = ({.*?});', text, re.DOTALL)
                    if not match:
                        logger.warning(f"Could not parse CDD response for {uniprot_id}")
                        return []

                    data = json.loads(match.group(1))
                    seen_positions: Set[tuple] = set()

                    # First pass: collect pssmids and filter annotations
                    filtered_annots = []
                    pssmids = set()

                    for annot in data.get("annots", {}).get("allAligns", []):
                        acc = annot.get("acc", "")
                        evalue = annot.get("evalue", 1.0)

                        # Filter by e-value
                        if evalue > evalue_threshold:
                            continue

                        start = annot.get("from")
                        end = annot.get("to")

                        if not start or not end:
                            continue

                        # Deduplicate by accession + position
                        pos_key = (acc, start, end)
                        if pos_key in seen_positions:
                            continue
                        seen_positions.add(pos_key)

                        pssmid = annot.get("pssmid")
                        if pssmid:
                            pssmids.add(pssmid)

                        filtered_annots.append(annot)

                    # Fetch domain metadata from Entrez esummary API
                    pssmid_lookup = {}
                    if pssmids:
                        try:
                            ids_param = ",".join(str(p) for p in pssmids)
                            esummary_url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=cdd&id={ids_param}&retmode=json"
                            meta_response = await client.get(esummary_url, timeout=30.0)
                            if meta_response.status_code == 200:
                                meta_data = meta_response.json()
                                result = meta_data.get("result", {})
                                for uid in result.get("uids", []):
                                    info = result.get(uid, {})
                                    pssmid_lookup[int(uid)] = {
                                        "title": info.get("title"),  # Short name like "HAT_KAT11"
                                        "subtitle": info.get("subtitle"),  # Brief description
                                        "abstract": info.get("abstract")  # Full description
                                    }
                        except Exception as e:
                            logger.warning(f"Failed to fetch CDD metadata: {e}")

                    # Build domain list with metadata
                    domains = []
                    for annot in filtered_annots:
                        acc = annot.get("acc", "")
                        pssmid = annot.get("pssmid")

                        # Determine source from accession prefix
                        source = "CDD"
                        for prefix, src_name in CDD_SOURCE_MAP.items():
                            if acc.lower().startswith(prefix.lower()):
                                source = src_name
                                break

                        # Look up domain metadata
                        meta = pssmid_lookup.get(pssmid, {}) if pssmid else {}
                        name = meta.get("title") or acc
                        description = meta.get("subtitle") or meta.get("abstract") or f"CDD hit: {acc}"

                        domains.append({
                            "name": name,
                            "accession": acc,
                            "source": source,
                            "start": annot.get("from"),
                            "end": annot.get("to"),
                            "evalue": annot.get("evalue", 1.0),
                            "description": description,
                            "type": "domain"
                        })

                    logger.info(f"Found {len(domains)} CDD domains for {uniprot_id}")
                    return domains

        except Exception as e:
            logger.error(f"Error fetching CDD domains for {uniprot_id}: {e}")
            return []

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
        protein_length: Optional[int] = None,
        include_cdd: bool = True,
        cdd_evalue_threshold: float = 0.01
    ) -> List[Dict[str, Any]]:
        """
        Get comprehensive domain annotations for a gene from multiple sources.

        Combines:
        - InterPro (aggregates Pfam, SMART, CDD, etc.)
        - UniProt features
        - NCBI CDD RPS-BLAST hits (optional, for domains like ProteinPaint shows)

        Args:
            gene_symbol: Gene symbol (e.g., "CREBBP")
            protein_length: Optional protein length for validation
            include_cdd: Whether to include direct NCBI CDD hits (default True)
            cdd_evalue_threshold: E-value cutoff for CDD hits (default 0.01)

        Returns deduplicated, merged domain list.
        """
        domains = []

        # First, get UniProt ID
        uniprot_id = await self.get_protein_by_gene(gene_symbol)
        if not uniprot_id:
            logger.warning(f"No UniProt ID found for {gene_symbol}")
            return domains

        logger.info(f"Found UniProt ID {uniprot_id} for {gene_symbol}")

        # Fetch from all sources in parallel
        tasks = [
            self.get_protein_entries(uniprot_id),
            self.get_uniprot_features(uniprot_id),
        ]
        if include_cdd:
            tasks.append(self.get_cdd_domains(uniprot_id, cdd_evalue_threshold))

        results = await asyncio.gather(*tasks, return_exceptions=True)

        interpro_entries = results[0]
        uniprot_features = results[1]
        cdd_domains = results[2] if include_cdd and len(results) > 2 else []

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

        # Process CDD domains (RPS-BLAST hits)
        if isinstance(cdd_domains, list):
            for cdd in cdd_domains:
                if cdd.get("start") and cdd.get("end"):
                    domains.append({
                        "name": cdd.get("name", "Unknown"),
                        "description": cdd.get("description"),
                        "source": cdd.get("source", "CDD"),
                        "accession": cdd.get("accession"),
                        "start": cdd["start"],
                        "end": cdd["end"],
                        "type": cdd.get("type", "domain")
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

        logger.info(f"Found {len(unique_domains)} domains for {gene_symbol} (CDD: {include_cdd})")
        return unique_domains


# Singleton client
_interpro_client: Optional[InterProClient] = None


def get_interpro_client() -> InterProClient:
    """Get or create the InterPro client instance."""
    global _interpro_client
    if _interpro_client is None:
        _interpro_client = InterProClient()
    return _interpro_client
