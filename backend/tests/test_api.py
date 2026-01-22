import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch
import json


# Import these only when running tests
def get_client():
    from app.main import app
    return TestClient(app)


class TestHealthEndpoint:
    def test_health_check(self):
        client = get_client()
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "healthy"}


class TestFusionEndpoints:
    @pytest.fixture
    def mock_ensembl(self):
        with patch("app.external.ensembl.EnsemblClient") as mock:
            mock_instance = AsyncMock()
            mock_instance.search_gene.return_value = {
                "id": "ENSG00000186716",
                "display_name": "BCR",
                "description": "BCR activator of RhoGEF and GTPase",
                "seq_region_name": "22",
                "start": 23179704,
                "end": 23318037,
                "strand": 1,
                "biotype": "protein_coding",
                "Transcript": []
            }
            mock.return_value = mock_instance
            yield mock_instance

    def test_manual_fusion_validation(self):
        client = get_client()

        # Test with missing fields
        response = client.post("/api/v1/fusions/manual", json={
            "gene_a_symbol": "BCR"
        })
        assert response.status_code == 422  # Validation error

    def test_upload_invalid_file_format(self):
        client = get_client()

        # Test with invalid content
        files = {"file": ("test.tsv", "invalid content", "text/tab-separated-values")}
        response = client.post("/api/v1/fusions/upload", files=files)
        assert response.status_code == 400


class TestGeneEndpoints:
    def test_search_genes_short_query(self):
        client = get_client()
        response = client.get("/api/v1/genes/search?q=B")
        assert response.status_code == 400  # Query too short


class TestExportEndpoints:
    def test_export_svg(self):
        client = get_client()
        svg_content = '<svg><rect width="100" height="100"/></svg>'

        response = client.post("/api/v1/export/svg", json={
            "svg_content": svg_content,
            "filename": "test"
        })

        assert response.status_code == 200
        assert response.headers["content-type"] == "image/svg+xml"

    def test_export_fasta(self):
        client = get_client()

        response = client.post("/api/v1/export/fasta", json={
            "sequence": "MVLSPADKTNVKAAWGKVGAHAGEYGAEALERMFLSFPTTKTYFPHFDLSH",
            "header": "test_protein",
            "filename": "test"
        })

        assert response.status_code == 200
        assert response.headers["content-type"] == "text/plain; charset=utf-8"
        content = response.content.decode("utf-8")
        assert content.startswith(">test_protein")
