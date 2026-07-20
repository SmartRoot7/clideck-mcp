export function adviseNetworkUpgrade(input: {
  model: string
  operating_system: string
  current_version: string
  target_version: string
  enabled_features: string[]
}) {
  const model = input.model
    .toUpperCase()
    .replace(/^CISCO\s+/, '')
    .replace(/^CATALYST\s+/, '')
  const isC9300 = /^C9300(?:L|X|LM)?(?:-|$)/.test(model)
  const isIosXe = /IOS[\s-]?XE/i.test(input.operating_system)
  const supportedCurrent =
    /^17\.(?:9|12)\./.test(input.current_version)
  const supportedTarget = input.target_version === '17.15.5'

  if (!isC9300 || !isIosXe || !supportedCurrent || !supportedTarget) {
    return {
      status: 'unknown' as const,
      applicability: {
        vendor: 'Cisco',
        model: input.model,
        operating_system: input.operating_system,
        current_version: input.current_version,
        target_version: input.target_version
      },
      breaking_changes: [],
      security_advisories: [],
      prerequisites: [],
      procedure: [],
      verification: [],
      rollback: [],
      reload_expected: null,
      next_action: 'request_expert_answer' as const,
      assurance: {
        validation_level: 'documentation_reviewed' as const,
        last_verified_at: '2026-07-17',
        confidence: 0.5
      },
      limitations: [
        'Verified upgrade advice is currently limited to Catalyst 9300 IOS-XE 17.9.x or 17.12.x upgrading to 17.15.5.',
        'Do not infer compatibility from this unknown result.'
      ]
    }
  }

  const webUiEnabled = input.enabled_features.some((feature) =>
    /web\s*ui|http\s*server|https\s*server/i.test(feature),
  )

  return {
    status: 'supported_with_checks' as const,
    applicability: {
      vendor: 'Cisco',
      model: input.model,
      operating_system: 'Cisco IOS XE',
      current_version: input.current_version,
      target_version: input.target_version
    },
    breaking_changes: [
      'Legacy request platform software commands are deprecated; use the install command workflow.',
      'A device or stack reload is expected during activation.',
      'Bootloader or ROMMON components may be upgraded; do not interrupt power during that stage.'
    ],
    security_advisories: [
      {
        id: 'CVE-2023-20198',
        applicability: webUiEnabled
          ? 'Feature-dependent: the HTTP/HTTPS Web UI is declared enabled.'
          : 'Feature-dependent: verify whether the HTTP/HTTPS Web UI is enabled.',
        disposition:
          'The target release is newer than the vendor-published fixed IOS-XE rebuilds; confirm the exact image before installation.'
      },
      {
        id: 'CVE-2023-20273',
        applicability: webUiEnabled
          ? 'Feature-dependent: the HTTP/HTTPS Web UI is declared enabled.'
          : 'Feature-dependent: verify whether the HTTP/HTTPS Web UI is enabled.',
        disposition:
          'The target release is newer than the vendor-published fixed IOS-XE rebuilds; confirm the exact image before installation.'
      }
    ],
    prerequisites: [
      'Confirm the exact C9300 model and that IOS-XE 17.15.5 is available for that product entitlement.',
      'Verify install mode and that the switch boots from flash:packages.conf.',
      'Validate available flash space, stack member health, power stability, configuration backup, and console access.',
      'Record current licenses, boot variables, ROMMON versions, routing adjacencies, interface state, and stack state.'
    ],
    procedure: [
      'Copy the customer-authorized IOS-XE 17.15.5 image to device storage and verify its published checksum.',
      'Run the IOS-XE install add, activate, and commit workflow appropriate for the exact stack or standalone model.',
      'Observe every member through activation and reload; do not power-cycle during bootloader or ROMMON activity.'
    ],
    verification: [
      'Verify all members run IOS-XE 17.15.5 and the intended packages.conf is active.',
      'Compare stack, interface, routing, redundancy, logging, licensing, and application-specific checks with the recorded baseline.',
      'Confirm no unexpected install, crash, bootloader, or forwarding errors are present.'
    ],
    rollback: [
      'Use only the vendor-supported rollback path for the exact source release and install mode.',
      'Retain the previous image and packages metadata until post-change checks pass.',
      'If rollback prerequisites are not confirmed before the maintenance window, do not begin the upgrade.'
    ],
    reload_expected: true,
    next_action: 'use_advice' as const,
    assurance: {
      validation_level: 'documentation_reviewed' as const,
      last_verified_at: '2026-07-17',
      confidence: 0.94
    },
    limitations: [
      'Feature compatibility, licensing, field notices, and hardware-specific caveats still require exact-model review.',
      'CliDeck does not provide or download vendor software images.'
    ]
  }
}
