import httpx
import asyncio
from typing import Optional, List, Dict, Any
from tenacity import retry, stop_after_attempt, wait_exponential
from app.config import get_settings


ENSEMBL_URLS = {
    "hg38": "https://rest.ensembl.org",
    "hg19": "https://grch37.rest.ensembl.org",
}


class EnsemblClient:
    """Async client for Ensembl REST API."""

    def __init__(self, genome_build: str = "hg38"):
        self.settings = get_settings()
        self.genome_build = genome_build
        self.base_url = ENSEMBL_URLS.get(genome_build, ENSEMBL_URLS["hg38"])
        self._semaphore = asyncio.Semaphore(self.settings.ensembl_rate_limit)

    async def _request(self, endpoint: str, params: Optional[Dict] = None) -> Dict[str, Any]:
        """Make a rate-limited request to Ensembl API."""
        async with self._semaphore:
            async with httpx.AsyncClient(timeout=30.0) as client:
                url = f"{self.base_url}{endpoint}"
                headers = {"Content-Type": "application/json"}
                response = await client.get(url, params=params, headers=headers)
                response.raise_for_status()
                return response.json()

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10))
    async def search_gene(self, symbol: str, species: str = "human") -> Optional[Dict[str, Any]]:
        """Search for a gene by symbol."""
        try:
            endpoint = f"/lookup/symbol/{species}/{symbol}"
            params = {"expand": 1}
            return await self._request(endpoint, params)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            raise

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10))
    async def get_gene_by_id(self, gene_id: str) -> Optional[Dict[str, Any]]:
        """Get gene information by Ensembl ID."""
        try:
            endpoint = f"/lookup/id/{gene_id}"
            params = {"expand": 1}
            return await self._request(endpoint, params)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            raise

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10))
    async def get_transcript(self, transcript_id: str) -> Optional[Dict[str, Any]]:
        """Get transcript information with exons."""
        try:
            endpoint = f"/lookup/id/{transcript_id}"
            params = {"expand": 1, "utr": 1}
            return await self._request(endpoint, params)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            raise

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10))
    async def get_exons(self, transcript_id: str) -> List[Dict[str, Any]]:
        """Get exon information for a transcript."""
        try:
            endpoint = f"/overlap/id/{transcript_id}"
            params = {"feature": "exon"}
            return await self._request(endpoint, params)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return []
            raise

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10))
    async def get_protein_sequence(self, protein_id: str) -> Optional[str]:
        """Get protein sequence."""
        try:
            endpoint = f"/sequence/id/{protein_id}"
            params = {"type": "protein"}
            async with self._semaphore:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    url = f"{self.base_url}{endpoint}"
                    headers = {"Content-Type": "text/plain"}
                    response = await client.get(url, params=params, headers=headers)
                    response.raise_for_status()
                    return response.text
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            raise

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10))
    async def get_protein_features(self, protein_id: str) -> List[Dict[str, Any]]:
        """Get protein features/domains from Ensembl."""
        try:
            endpoint = f"/overlap/translation/{protein_id}"
            params = {"feature": "protein_feature"}
            return await self._request(endpoint, params)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return []
            raise

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10))
    async def get_cds(self, transcript_id: str) -> Optional[Dict[str, Any]]:
        """Get CDS coordinates for a transcript."""
        try:
            endpoint = f"/lookup/id/{transcript_id}"
            params = {"expand": 1}
            data = await self._request(endpoint, params)

            # Extract CDS info from Translation
            if "Translation" in data:
                trans = data["Translation"]
                return {
                    "protein_id": trans.get("id"),
                    "start": trans.get("start"),
                    "end": trans.get("end"),
                    "length": trans.get("length")
                }
            return None
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            raise

    async def get_canonical_transcript(self, gene_symbol: str) -> Optional[Dict[str, Any]]:
        """Get the canonical transcript for a gene."""
        gene_data = await self.search_gene(gene_symbol)
        if not gene_data:
            return None

        # Find canonical transcript
        transcripts = gene_data.get("Transcript", [])
        for transcript in transcripts:
            if transcript.get("is_canonical") == 1:
                return transcript

        # Fall back to first coding transcript
        for transcript in transcripts:
            if transcript.get("biotype") == "protein_coding":
                return transcript

        return transcripts[0] if transcripts else None


# Client instances per genome build
_ensembl_clients: Dict[str, EnsemblClient] = {}


def get_ensembl_client(genome_build: str = "hg38") -> EnsemblClient:
    """Get or create an EnsemblClient for the specified genome build."""
    global _ensembl_clients
    if genome_build not in _ensembl_clients:
        _ensembl_clients[genome_build] = EnsemblClient(genome_build)
    return _ensembl_clients[genome_build]
