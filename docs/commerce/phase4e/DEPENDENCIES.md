# Stage 4E dependency evidence

Compatible npm audit fix only; no forced or major-version upgrade. Wallet financial source unchanged.

Before: {'info': 0, 'low': 0, 'moderate': 3, 'high': 9, 'critical': 1, 'total': 13}
After: {'info': 0, 'low': 0, 'moderate': 3, 'high': 5, 'critical': 0, 'total': 8}

|Package|Installed paths|Advisories|Disposition|
|---|---|---|---|
|aws-sdk|node_modules/aws-sdk|https://github.com/advisories/GHSA-j965-2qgj-vjmq|Remains; see assessment below|
|axios|node_modules/axios|https://github.com/advisories/GHSA-vh66-26gq-q6x8, https://github.com/advisories/GHSA-9fr6-4gfg-395g, https://github.com/advisories/GHSA-c29m-xwm3-cm6r, https://github.com/advisories/GHSA-mghh-pgcx-3jjj, https://github.com/advisories/GHSA-x97p-jq2g-jp4f, https://github.com/advisories/GHSA-3pq3-5fj3-cg6v, https://github.com/advisories/GHSA-542g-h47m-68v8, https://github.com/advisories/GHSA-j8rh-479h-cp32, https://github.com/advisories/GHSA-4hqw-qxg8-jxx2, https://github.com/advisories/GHSA-m8m8-qj5v-23w3, https://github.com/advisories/GHSA-44g4-m2mj-wpvx, https://github.com/advisories/GHSA-r4gj-5m52-g5wh|Compatible lockfile patch applied|
|body-parser|node_modules/body-parser|https://github.com/advisories/GHSA-27r3-jxmh-p828|Compatible lockfile patch applied|
|engine.io|node_modules/engine.io|https://github.com/advisories/GHSA-2gc4-cqfq-p2gv|Compatible lockfile patch applied|
|follow-redirects|node_modules/follow-redirects|https://github.com/advisories/GHSA-q3jh-wrc6-jgq8, https://github.com/advisories/GHSA-8r9p-f939-6h3c|Compatible lockfile patch applied|
|ip|node_modules/ip|https://github.com/advisories/GHSA-2p57-rm9w-gvfp|Remains; see assessment below|
|ip-address|node_modules/ip-address, node_modules/socks/node_modules/ip-address|https://github.com/advisories/GHSA-v2v4-37r5-5v8g, https://github.com/advisories/GHSA-mwp4-54f8-5fhr, https://github.com/advisories/GHSA-rpw4-54j3-4h4q, https://github.com/advisories/GHSA-j6r3-76f7-8jcv, https://github.com/advisories/GHSA-h3mg-xc3c-68pw, https://github.com/advisories/GHSA-rxp7-6hxx-x8q5|Remains; see assessment below|
|ip-cidr|node_modules/ip-cidr|Transitive dependency finding|Remains; see assessment below|
|node-ssdp|node_modules/node-ssdp|Transitive dependency finding|Remains; see assessment below|
|openai|node_modules/openai|Transitive dependency finding|Remains; see assessment below|
|proxy-addr|node_modules/proxy-addr|https://github.com/advisories/GHSA-jqcg-44mw-7w3h|Compatible lockfile patch applied|
|uuid|node_modules/uuid|https://github.com/advisories/GHSA-w5hq-g745-h8pq|Remains; see assessment below|
|zod|node_modules/zod|https://github.com/advisories/GHSA-mrhx-c7xc-m3w5|Remains; see assessment below|

## Reachability and compatibility
- axios/follow-redirects: server outbound provider/network calls; reachable transport patched. No change to wallet amounts or credit decisions.
- express → body-parser: public request decoding; patched.
- express → proxy-addr: request/proxy address handling; patched. app trust proxy is 1, not the vulnerable subnet configuration, but dependency is present in request path.
- socket.io → engine.io: reachable socket handshake; patched.
- aws-sdk v2 → uuid: S3 service imports SDK. Exact exploit conditions depend on region/configuration and UUID callers; no assertion of exploitation. npm’s offered AWS v1 downgrade is incompatible. AWS v3 migration needs separate storage regression review.
- node-ssdp → ip: discovery adapter uses SSDP; advisory concerns ip.isPublic classification. No direct isPublic call established in application. Suggested node-ssdp v1 downgrade rejected as incompatible.
- ip-cidr → ip-address and mqtt → socks → ip-address: network discovery/proxy parsing. No upstream compatible fix reported. Unbounded diagnostic/CIDR paths require focused discovery review; cannot certify unreachable.
- zod v3, also OpenAI peer: request-validation and automation routes are reachable. z.record(z.any()) remains an input-sensitive path. Zod v4/OpenAI major compatibility changes are not a safe lockfile-only fix; release blocker pending separate validation/AI regression assessment.

No remaining advisory is silently waived. Production release remains NO-GO.
