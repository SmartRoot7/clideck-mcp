export const networkConformanceFixture = {
  context: {
    vendor: 'cisco',
    model: 'catalyst-9300',
    operating_system: 'ios-xe',
    version: '17.15.5'
  },
  candidate: {
    stable_key: 'cisco.ios-xe.show-version',
    kind: 'command' as const,
    vendor_slug: 'cisco',
    platform_slug: 'catalyst-9300',
    operating_system_slug: 'ios-xe',
    version_min: '17.9.1',
    version_max: '17.15.5',
    title: 'Display IOS XE software and hardware details',
    summary: 'Read-only device identity and software information.',
    question_patterns: ['How do I show the IOS XE version?'],
    cli_mode: 'privileged EXEC',
    command: 'show version',
    procedure: [],
    prerequisites: ['Privileged EXEC access.'],
    risks: [],
    verification: ['Confirm the expected model and version are displayed.'],
    rollback: [],
    limitations: ['Output varies by IOS XE release.'],
    dangerous: false,
    risk_level: 'safe_read_only' as const,
    confidence: 0.98,
    quality_score: 0.97,
    confidence_reason: 'Project-authored regression fixture with exact syntax.',
    last_verified_at: '2026-07-18',
    provenance: [{
      url: 'https://mcp.clideck.com/demo-data/network-regression.json',
      document_type: 'project_fixture',
      title: 'CliDeck network regression fixture',
      verified_at: '2026-07-18',
      content_hash: `sha256:${'b'.repeat(64)}`,
      evidence_fragment: 'The read-only command is show version.',
      evidence_role: 'primary' as const
    }]
  }
}
