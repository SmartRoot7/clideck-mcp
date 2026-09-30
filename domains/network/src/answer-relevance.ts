// Distinct feature names are evidence constraints, not merely FTS ranking terms.
// Keep network-specific vocabulary inside the domain pack.
const features = [
  'evpn', 'ospf', 'bgp', 'isis', 'macsec', 'conntrack', 'seg6local', 'srv6',
  'mptcp', 'nftables', 'flowtable', 'cake', 'mdb', 'mwan3', 'sqm',
  'https-dns-proxy', 'udp_segment', 'udp_gro', 'rss', 'syslog', 'vlan', 'tftp',
  'rp_filter', 'xdp'
] as const

function hasTerm(text: string, term: string): boolean {
  text = text.replace(/\bospfv?[23]\b/gi, 'ospf').replace(/\bis-is\b/gi, 'isis')
    .replace(/\breverse[\s-]+path[\s-]+filter(?:ing)?\b|\brp[_-]?filter\b|\brpf\b/gi, 'rp_filter')
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const suffix = ['vlan','flowtable'].includes(term) ? 's?' : ''
  return new RegExp(`(?:^|[^a-z0-9])${escaped}${suffix}(?=$|[^a-z0-9])`, 'i').test(text)
}

export function networkDemandFeatureTerms(question: string): string[] {
  return features.filter((term) => hasTerm(question, term))
}

export function networkAnswerMatchesFeatures(question: string, evidence: string): boolean {
  return networkDemandFeatureTerms(question).every((term) => hasTerm(evidence, term))
}

export function networkDemandFeaturePatterns(question: string): string[] {
  return networkDemandFeatureTerms(question).map((term) => {
    const expression = term === 'ospf' ? 'ospf(v?[23])?' : term === 'isis' ? 'is-?is'
      : term === 'rp_filter' ? '(rp[_-]?filter|rpf|reverse[[:space:]-]+path[[:space:]-]+filter(ing)?)'
      : ['vlan','flowtable'].includes(term) ? `${term}s?` : term
    return `(^|[^a-z0-9])${expression}($|[^a-z0-9])`
  })
}
