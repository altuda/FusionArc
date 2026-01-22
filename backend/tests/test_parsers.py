import pytest
from app.core.parsers import StarFusionParser, ArribaParser, ManualInputParser
from app.schemas.fusion import FusionManualInput


class TestStarFusionParser:
    def test_parse_basic_file(self):
        content = """#FusionName\tJunctionReadCount\tSpanningFragCount\tLeftGene\tLeftBreakpoint\tRightGene\tRightBreakpoint
BCR--ABL1\t50\t30\tBCR^ENSG00000186716.19\tchr22:23632600:+\tABL1^ENSG00000097007.17\tchr9:130854064:-
EML4--ALK\t25\t15\tEML4^ENSG00000143924.20\tchr2:42492091:+\tALK^ENSG00000171094.16\tchr2:29446394:-"""

        parser = StarFusionParser()
        fusions = parser.parse(content)

        assert len(fusions) == 2

        # Check BCR-ABL1
        bcr_abl = fusions[0]
        assert bcr_abl.gene_a_symbol == "BCR"
        assert bcr_abl.gene_b_symbol == "ABL1"
        assert bcr_abl.gene_a_chromosome == "22"
        assert bcr_abl.gene_a_breakpoint == 23632600
        assert bcr_abl.gene_a_strand == "+"
        assert bcr_abl.gene_b_chromosome == "9"
        assert bcr_abl.gene_b_breakpoint == 130854064
        assert bcr_abl.gene_b_strand == "-"
        assert bcr_abl.junction_reads == 50
        assert bcr_abl.spanning_reads == 30

    def test_parse_empty_file(self):
        parser = StarFusionParser()
        fusions = parser.parse("")
        assert len(fusions) == 0

    def test_parse_malformed_line(self):
        content = """#FusionName\tJunctionReadCount\tSpanningFragCount
BCR--ABL1\tinvalid\t30"""

        parser = StarFusionParser()
        fusions = parser.parse(content)
        assert len(fusions) == 0


class TestArribaParser:
    def test_parse_basic_file(self):
        content = """#gene1\tgene2\tstrand1(gene/fusion)\tstrand2(gene/fusion)\tbreakpoint1\tbreakpoint2\tsite1\tsite2\ttype\tdirection\tsplit_reads1\tsplit_reads2\tdiscordant_mates
BCR\tABL1\t+/+\t-/-\tchr22:23632600\tchr9:130854064\tCDS\tCDS\ttranslocation\tdownstream\t25\t25\t30
EML4\tALK\t+/+\t-/-\tchr2:42492091\tchr2:29446394\tCDS\tCDS\tinversion\tdownstream\t15\t10\t20"""

        parser = ArribaParser()
        fusions = parser.parse(content)

        assert len(fusions) == 2

        bcr_abl = fusions[0]
        assert bcr_abl.gene_a_symbol == "BCR"
        assert bcr_abl.gene_b_symbol == "ABL1"
        assert bcr_abl.gene_a_chromosome == "22"
        assert bcr_abl.gene_a_breakpoint == 23632600
        assert bcr_abl.junction_reads == 50  # split_reads1 + split_reads2
        assert bcr_abl.spanning_reads == 30  # discordant_mates


class TestManualInputParser:
    def test_parse_batch_input(self):
        content = """BCR chr22:23632600:+ ABL1 chr9:130854064:-
EML4 chr2:42492091:+ ALK chr2:29446394:- 50 30"""

        parser = ManualInputParser()
        fusions = parser.parse(content)

        assert len(fusions) == 2

        bcr_abl = fusions[0]
        assert bcr_abl.gene_a_symbol == "BCR"
        assert bcr_abl.gene_b_symbol == "ABL1"
        assert bcr_abl.junction_reads is None

        eml4_alk = fusions[1]
        assert eml4_alk.gene_a_symbol == "EML4"
        assert eml4_alk.gene_b_symbol == "ALK"
        assert eml4_alk.junction_reads == 50
        assert eml4_alk.spanning_reads == 30

    def test_parse_manual_input(self):
        input_data = FusionManualInput(
            gene_a_symbol="BCR",
            gene_a_breakpoint="chr22:23632600:+",
            gene_b_symbol="ABL1",
            gene_b_breakpoint="chr9:130854064:-",
            junction_reads=50
        )

        fusion = ManualInputParser.parse_manual_input(input_data)

        assert fusion.gene_a_symbol == "BCR"
        assert fusion.gene_b_symbol == "ABL1"
        assert fusion.gene_a_chromosome == "22"
        assert fusion.gene_a_breakpoint == 23632600
        assert fusion.gene_a_strand == "+"
        assert fusion.junction_reads == 50

    def test_skip_comments(self):
        content = """# This is a comment
BCR chr22:23632600:+ ABL1 chr9:130854064:-"""

        parser = ManualInputParser()
        fusions = parser.parse(content)

        assert len(fusions) == 1
