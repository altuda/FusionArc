"""
ClinVar client module.

Provides the VCF-based ClinVar client (via clinvar_vcf module) for consistent
and reproducible variant counts.
"""

import logging

logger = logging.getLogger(__name__)

# Singleton client — uses VCF-based client for consistent results
_clinvar_client = None


def get_clinvar_client():
    """Get or create the ClinVar VCF-based client instance."""
    global _clinvar_client
    if _clinvar_client is None:
        from app.external.clinvar_vcf import ClinVarVCFClient, ClinVarVCFManager
        _clinvar_client = ClinVarVCFClient(ClinVarVCFManager())
    return _clinvar_client
