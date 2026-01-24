from sqlalchemy import Column, String, Integer, Text, ForeignKey, DateTime, Float
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base


class Gene(Base):
    __tablename__ = "genes"

    id = Column(String(50), primary_key=True)  # Ensembl gene ID
    symbol = Column(String(50), index=True)
    name = Column(String(255))
    chromosome = Column(String(10))
    start = Column(Integer)
    end = Column(Integer)
    strand = Column(Integer)
    biotype = Column(String(50))
    genome_build = Column(String(10), default="hg38")  # hg38 or hg19
    cached_at = Column(DateTime, default=datetime.utcnow)

    transcripts = relationship("Transcript", back_populates="gene", cascade="all, delete-orphan")


class Transcript(Base):
    __tablename__ = "transcripts"

    id = Column(String(50), primary_key=True)  # Ensembl transcript ID
    gene_id = Column(String(50), ForeignKey("genes.id"), index=True)
    is_canonical = Column(Integer, default=0)
    biotype = Column(String(50))
    start = Column(Integer)
    end = Column(Integer)
    cds_start = Column(Integer)
    cds_end = Column(Integer)
    cached_at = Column(DateTime, default=datetime.utcnow)

    gene = relationship("Gene", back_populates="transcripts")
    exons = relationship("Exon", back_populates="transcript", cascade="all, delete-orphan")
    protein = relationship("Protein", back_populates="transcript", uselist=False, cascade="all, delete-orphan")


class Exon(Base):
    __tablename__ = "exons"

    # Composite primary key: exon_id + transcript_id
    # Same exon can belong to multiple transcripts in Ensembl
    exon_id = Column(String(50), primary_key=True)  # Ensembl exon ID
    transcript_id = Column(String(50), ForeignKey("transcripts.id"), primary_key=True, index=True)
    rank = Column(Integer)
    start = Column(Integer)
    end = Column(Integer)
    phase = Column(Integer)
    end_phase = Column(Integer)
    cached_at = Column(DateTime, default=datetime.utcnow)

    transcript = relationship("Transcript", back_populates="exons")


class Protein(Base):
    __tablename__ = "proteins"

    id = Column(String(50), primary_key=True)  # Ensembl protein ID
    transcript_id = Column(String(50), ForeignKey("transcripts.id"), unique=True, index=True)
    sequence = Column(Text)
    length = Column(Integer)
    cached_at = Column(DateTime, default=datetime.utcnow)

    transcript = relationship("Transcript", back_populates="protein")
    domains = relationship("Domain", back_populates="protein", cascade="all, delete-orphan")


class Domain(Base):
    __tablename__ = "domains"

    id = Column(Integer, primary_key=True, autoincrement=True)
    protein_id = Column(String(50), ForeignKey("proteins.id"), index=True)
    name = Column(String(255))
    description = Column(Text)
    source = Column(String(50))  # Pfam, SMART, Superfamily
    accession = Column(String(50))
    start = Column(Integer)
    end = Column(Integer)
    score = Column(Float)  # E-value or hit score from domain prediction
    cached_at = Column(DateTime, default=datetime.utcnow)

    protein = relationship("Protein", back_populates="domains")
