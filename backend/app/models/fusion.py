from sqlalchemy import Column, String, Integer, Text, ForeignKey, DateTime, JSON, Float
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
from app.database import Base


def generate_uuid():
    return str(uuid.uuid4())


class Session(Base):
    __tablename__ = "sessions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    name = Column(String(255))
    source = Column(String(50))  # star_fusion, arriba, manual
    created_at = Column(DateTime, default=datetime.utcnow)

    fusions = relationship("Fusion", back_populates="session", cascade="all, delete-orphan")


class Fusion(Base):
    __tablename__ = "fusions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    session_id = Column(String(36), ForeignKey("sessions.id"), index=True)

    # Gene A info
    gene_a_symbol = Column(String(50))
    gene_a_id = Column(String(50))
    gene_a_chromosome = Column(String(10))
    gene_a_breakpoint = Column(Integer)
    gene_a_strand = Column(String(1))
    transcript_a_id = Column(String(50))

    # Gene B info
    gene_b_symbol = Column(String(50))
    gene_b_id = Column(String(50))
    gene_b_chromosome = Column(String(10))
    gene_b_breakpoint = Column(Integer)
    gene_b_strand = Column(String(1))
    transcript_b_id = Column(String(50))

    # Fusion analysis results
    junction_reads = Column(Integer)
    spanning_reads = Column(Integer)
    is_in_frame = Column(Integer)  # 1 = in-frame, 0 = out-of-frame, -1 = unknown

    # Amino acid positions
    aa_breakpoint_a = Column(Integer)
    aa_breakpoint_b = Column(Integer)

    # Fusion protein sequence
    fusion_sequence = Column(Text)

    # Domain analysis (JSON)
    domains_a = Column(JSON)  # List of domains with retention status
    domains_b = Column(JSON)

    # Flags
    has_kinase_domain = Column(Integer, default=0)
    kinase_retained = Column(Integer, default=-1)  # 1 = yes, 0 = no, -1 = N/A
    confidence = Column(String(20))  # high, medium, low

    # Raw data
    raw_data = Column(JSON)

    created_at = Column(DateTime, default=datetime.utcnow)

    session = relationship("Session", back_populates="fusions")
