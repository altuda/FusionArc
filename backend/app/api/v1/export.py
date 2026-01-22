from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional
import io

router = APIRouter()


class SVGExportRequest(BaseModel):
    svg_content: str
    filename: Optional[str] = "fusion_diagram"


class PNGExportRequest(BaseModel):
    svg_content: str
    width: Optional[int] = 1200
    height: Optional[int] = 400
    filename: Optional[str] = "fusion_diagram"


class FASTAExportRequest(BaseModel):
    sequence: str
    header: str
    filename: Optional[str] = "fusion_protein"


@router.post("/svg")
async def export_svg(request: SVGExportRequest):
    """Export fusion diagram as SVG."""
    svg_bytes = request.svg_content.encode("utf-8")

    return Response(
        content=svg_bytes,
        media_type="image/svg+xml",
        headers={
            "Content-Disposition": f"attachment; filename={request.filename}.svg"
        }
    )


@router.post("/png")
async def export_png(request: PNGExportRequest):
    """Export fusion diagram as PNG."""
    try:
        import cairosvg

        png_bytes = cairosvg.svg2png(
            bytestring=request.svg_content.encode("utf-8"),
            output_width=request.width,
            output_height=request.height
        )

        return Response(
            content=png_bytes,
            media_type="image/png",
            headers={
                "Content-Disposition": f"attachment; filename={request.filename}.png"
            }
        )
    except ImportError:
        raise HTTPException(500, "CairoSVG not available for PNG export")
    except Exception as e:
        raise HTTPException(500, f"PNG export failed: {str(e)}")


@router.post("/fasta")
async def export_fasta(request: FASTAExportRequest):
    """Export fusion protein sequence as FASTA."""
    # Format sequence with line breaks every 60 characters
    seq_lines = [request.sequence[i:i+60] for i in range(0, len(request.sequence), 60)]
    fasta_content = f">{request.header}\n" + "\n".join(seq_lines)

    return Response(
        content=fasta_content.encode("utf-8"),
        media_type="text/plain",
        headers={
            "Content-Disposition": f"attachment; filename={request.filename}.fasta"
        }
    )
