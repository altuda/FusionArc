from fastapi import APIRouter
from app.api.v1 import fusions, genes, export

router = APIRouter()
router.include_router(fusions.router, prefix="/fusions", tags=["fusions"])
router.include_router(genes.router, prefix="/genes", tags=["genes"])
router.include_router(export.router, prefix="/export", tags=["export"])
