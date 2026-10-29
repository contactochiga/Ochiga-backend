# Provider-validation dependency review — 26 October 2026

The original 5 High / 3 Moderate are eight affected-package entries, not eight distinct advisories. Fresh registry audit and installed source reviewed. Reachability below concerns the candidate source; no claim of live production exploit testing.

Before: {'info': 0, 'low': 0, 'moderate': 3, 'high': 5, 'critical': 0, 'total': 8}
After scoped UUID fix: {'info': 0, 'low': 1, 'moderate': 1, 'high': 5, 'critical': 0, 'total': 7}

|Original entry|Severity|Exact dependency path|Production reachability|Remediation|Regression implications|
|---|---|---|---|---|---|
|aws-sdk|moderate|Backend → aws-sdk 2.1693.0 → uuid 8.0.0 (now 11.1.1)|S3 uploads used by QR, messages and community; region comes from AWS_REGION/S3_REGION, not an HTTP field. Credential/malformed-region exploit not demonstrated.|UUID override applied; own region-validation advisory remains Low. Migrate to AWS v3 or validate configured region in a separate storage change. npm’s offered v1 downgrade is unsafe.|S3 auth, endpoint/region, upload ACL and returned URL contracts; v3 is a real migration.|
|ip|high|Backend → node-ssdp 4.0.1 → ip 1.1.9|SSDP adapter is registered. node-ssdp calls ip.address() with no name; ip.address bypasses isPublic in that mode. No application use of vulnerable isPublic established. UDP discovery is reachable but that does not prove advisory exploitability.|No fixed ip version reported. Do not downgrade node-ssdp to1.0.0. Replace/upgrade discovery dependency under focused compatibility tests.|Multicast interface binding and discovery behavior; no discovery changes in this commerce review.|
|ip-address|high|Backend → ip-cidr 3.1.0 → ip-address 7.1.0; mqtt → socks → ip-address 10.7.5 is already outside reported vulnerable ranges|cidrToIps imports ip-cidr, but repository source search found no callers. No HTML helpers, isLinkLocal or mixed-family policy use found in application. Parsing would be input-sensitive if helper is wired later. Production exploit path not established; package remains shipped.|Fixed ip-address 10.7.5 exists but ip-cidr3 relies on legacy bigInteger/fromBigInteger JSBN APIs; a forced major override is not compatible. Upgrade/replace ip-cidr with dedicated address-enumeration tests.|IPv4/IPv6 arithmetic, containment and enumeration semantics; current helper enumerates before clipping and also needs bounded enumeration review.|
|ip-cidr|moderate|Backend → ip-cidr 3.1.0 → ip-address 7.1.0|Inherited Moderate package finding; helper has no discovered callers. Not an independent advisory.|Same ip-address remediation; no compatible automatic fix reported.|JSBN/native BigInt conversion and network/broadcast behavior.|
|node-ssdp|high|Backend → node-ssdp 4.0.1 → ip 1.1.9|Inherited High from ip, not a second independent vulnerability. Adapter registration/discovery exists; affected classification call not demonstrated.|Same ip remediation; remains open.|Discovery/SSDP protocol and interface regression required.|
|openai|high|Backend → openai 4.104.0 → zod 3.25.76 peer|Inherited High from Zod, not a separate CVE. Existing AI services use OpenAI; vulnerable collection validation was not demonstrated through SDK callers.|Coordinate SDK/Zod compatibility upgrade; npm proposes OpenAI7.43.0 major. Remains open.|AI chat/response interfaces, structured-output parsing and existing orchestration regressions.|
|uuid|moderate|Backend → aws-sdk 2.1693.0 → uuid 8.0.0|AWS SDK source has one require of uuid, calling v4() with no arguments. Advisory concerns buffer-writing variants; affected path not demonstrated here.|Scoped aws-sdk override to uuid 11.1.1 applied after major-version compatibility assessment. No global override.|CommonJS loading and v4 return type checked; 1000 UUID calls and an offline S3 signed request pass. No actual S3 upload performed.|
|zod|high|Backend → zod 3.25.76|Used by authenticated devices.control automation validation. Current schemas use records/objects, not the advisory’s large failing array pattern. Prior report’s z.record observation alone did not establish this specific exploit. Repository imports found only validation.ts and automations.route.ts; cannot certify all future/dynamic consumers unreachable.|Patched upstream4.6.6+; latest3.x remains3.25.76. Zod4 requires adapting z.record signature and ZodError.errors consumers, then automation regression. No blind major update.|Schema acceptance/defaults, error response shape, AI-generated automations and OpenAI peer compatibility.|

## Underlying advisories (including inherited Low AWS finding)
- low: [JavaScript SDK v2 users should add validation to the region parameter value in or migrate to v3](https://github.com/advisories/GHSA-j965-2qgj-vjmq); affected range `>=2.0.0 <=3.0.0`.
- high: [ip SSRF improper categorization in isPublic](https://github.com/advisories/GHSA-2p57-rm9w-gvfp); affected range `<=2.0.1`.
- moderate: [ip-address has XSS in Address6 HTML-emitting methods](https://github.com/advisories/GHSA-v2v4-37r5-5v8g); affected range `<=10.1.0`.
- high: [ip-address: Address4 decodes leading-zero octets as decimal while resolvers decode them as octal, allowing SSRF and trust-boundary bypass](https://github.com/advisories/GHSA-mwp4-54f8-5fhr); affected range `<=10.3.0`.
- moderate: [ip-address: Address6.isLinkLocal() recognizes fe80::/64 rather than fe80::/10, allowing SSRF and trust-boundary bypass to on-link hosts](https://github.com/advisories/GHSA-rpw4-54j3-4h4q); affected range `<=10.5.0`.
- moderate: [ip-address: isInSubnet() and isHostInSubnet() compare addresses of different families as if they shared an address space, allowing an allowlist check to admit an address outside its range](https://github.com/advisories/GHSA-j6r3-76f7-8jcv); affected range `<=10.7.0`.
- moderate: [ip-address: Address6 builds a parse diagnostic proportional to the input with no length bound, allowing a single long string to stall or crash the process](https://github.com/advisories/GHSA-h3mg-xc3c-68pw); affected range `<=10.7.0`.
- moderate: [ip-address: Address6 matches a zone identifier in quadratic time ahead of its length limit, allowing a single long string to stall the process](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5); affected range `<=10.7.3`.
- moderate: [uuid: Missing buffer bounds check in v3/v5/v6 when buf is provided](https://github.com/advisories/GHSA-w5hq-g745-h8pq); affected range `<11.1.1`.
- high: [Zod can exhaust memory while validating oversized constrained collections](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5); affected range `<4.6.6`.

## Test evidence
- TypeScript build PASS. Payment validation18, wallet-boundary HTTP9, signed webhook HTTP6 PASS.
- Wallet funding/webhook/receipt/notification/return smoke23 PASS.
- 1000 AWS UUID validation/version/uniqueness checks and offline S3 request build PASS; no request sent.
- Legacy wallet controller and shared Paystack client unchanged.
- All five High findings remain open. None are waived based solely on lack of a demonstrated call path. Remaining Moderate ip-cidr and Low aws-sdk also remain open. No major validation/discovery/storage migration was attempted.
