/** Generate URL to database entry based on source and accession. */
export function getDatabaseUrl(source: string, accession: string | undefined): string | null {
  if (!accession) return null
  const sourceLower = source.toLowerCase()
  const accLower = accession.toLowerCase()
  // Handle CDD-style accessions (pfam09606, smart00297, cd00001) - route to NCBI CDD
  if (accLower.startsWith('pfam') || accLower.startsWith('smart') || accLower.startsWith('cd')) {
    return `https://www.ncbi.nlm.nih.gov/Structure/cdd/cddsrv.cgi?acc=${accession}`
  }
  if (sourceLower === 'pfam') return `https://www.ebi.ac.uk/interpro/entry/pfam/${accession}/`
  if (sourceLower === 'smart') return `https://smart.embl.de/smart/do_annotation.pl?DOMAIN=${accession}`
  if (sourceLower === 'cdd') return `https://www.ncbi.nlm.nih.gov/Structure/cdd/cddsrv.cgi?acc=${accession}`
  if (sourceLower === 'superfamily' || sourceLower === 'supfam') return `https://supfam.org/SUPERFAMILY/cgi-bin/scop.cgi?sunid=${accession.replace('SSF', '')}`
  if (sourceLower === 'gene3d') return `https://www.cathdb.info/superfamily/${accession.replace('G3DSA:', '')}`
  if (sourceLower === 'panther') return `https://www.pantherdb.org/panther/family.do?clsAccession=${accession}`
  if (sourceLower === 'prosite' || sourceLower.includes('prosite')) return `https://prosite.expasy.org/${accession}`
  if (sourceLower === 'interpro') return `https://www.ebi.ac.uk/interpro/entry/InterPro/${accession}/`
  if (sourceLower === 'prints') return `https://www.ebi.ac.uk/interpro/entry/prints/${accession}/`
  if (sourceLower === 'uniprot') return `https://www.uniprot.org/uniprotkb/${accession}`
  return null
}
