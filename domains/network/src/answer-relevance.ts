// Distinct feature names are evidence constraints, not merely FTS ranking terms.
// Keep network-specific vocabulary inside the domain pack.
const features = [
  'evpn', 'ospf', 'bgp', 'isis', 'macsec', 'conntrack', 'seg6local', 'srv6',
  'mptcp', 'nftables', 'flowtable', 'cake', 'mdb', 'mwan3', 'sqm',
  'https-dns-proxy', 'udp_segment', 'udp_gro', 'rss', 'syslog', 'vlan', 'tftp'
] as const

function hasTerm(text: string, term: string): boolean {
  text = text.replace(/\bospfv?[23]\b/gi, 'ospf').replace(/\bis-is\b/gi, 'isis')
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^a-z0-9])${escaped}s?(?=$|[^a-z0-9])`, 'i').test(text)
}

export function networkDemandFeatureTerms(question: string): string[] {
  return features.filter((term) => hasTerm(question, term))
}

export function networkAnswerMatchesFeatures(question: string, evidence: string): boolean {
  return networkDemandFeatureTerms(question).every((term) => hasTerm(evidence, term))
}
