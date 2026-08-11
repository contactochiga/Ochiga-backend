# Office / Edge Separation Plan

This is a proposed extraction boundary based on local code evidence. No code has been moved in this audit phase.

## Current Mixed Repository

Repository: `/Users/ochigaidoko/oyi-edge-agent`

The repo currently combines:

- genuine Edge runtime responsibilities;
- Office/CRM/lead-agent services;
- static Office dashboard/widget assets;
- commercial knowledge/prompt packs;
- an older digital-twin demo surface.

The name `oyi-edge-agent` no longer describes the full contents. This makes deployment, secrets, ownership and future refactoring riskier than necessary.

## Responsibility Classification

### EDGE

Keep in Edge:

- `agent.js`
- `edge/camera/*`
- `scripts/edge-camera-common.js`
- `scripts/generate-go2rtc-config.js`
- `scripts/check-camera-runtime-readiness.js`
- `scripts/setup-camera-edge.js`
- `scripts/bench-camera-protocol-phase1.js`
- `scripts/camera-ai-processor.js` until camera AI ownership is decided
- Edge docs under `edge/camera/docs/*`
- Local queue/outbox behavior in `agent.js`
- Edge environment variables: `AGENT_ID`, `SITE_ID`, `CLOUD_URL`, `OYI_EDGE_AGENT_TOKEN`, `CAMERA_IP`, `ONVIF_*`, go2rtc/camera registry/local credential variables.

Edge responsibilities:

- local hardware discovery;
- camera/DVR/go2rtc registry and stream health;
- heartbeat/config pull/discovery push;
- local durable outbox;
- local credential references;
- offline/local execution where appropriate.

### OFFICE

Move or re-home into Office:

- `lead-agents-server.js`
- `src/lead-agents/*`
- `src/intelligence-core/index.js` if retained as transitional Office intelligence compatibility
- `db/lead-agents-schema.sql`
- `prompt-packs/*`
- `knowledge/*`
- `public/dashboard/*`
- `public/widget/*`
- `public/plan-studio/*`
- `docs/commercial/*`
- Office docs such as `OFFICE_OS_COMMERCIAL_OPERATIONS.md`, `lead-agents-v1.md`, `office-os-2-architecture.md`
- `scripts/build-office-assets.js`
- `scripts/run-lead-agents-evals.js`
- `scripts/test-lead-agents.js`
- `scripts/apply-supabase-schema.js` after confirming it only targets Office schema.

Office responsibilities:

- CRM intake and lead management;
- contacts, leads, opportunities, proposals, demos;
- OMA/OSA commercial agent workflow;
- corporate dashboards and commercial documents;
- Office user/admin auth;
- projections from Backend operational state, not canonical ownership of building truth.

### SHARED / NEEDS DECISION

Needs explicit boundary decision before moving:

- `src/intelligence-core/index.js`: explicitly says it is compatibility while Backend-owned Oyi Core is completed, but includes office, edge, camera, employee and executive scopes.
- `src/lead-agents/office-sync.js`: fetches Office projections from Backend/Facility/Consumer export endpoints and writes Office projection tables.
- `src/lead-agents/digital-twin.js`, `public/digital-twin/*`, `scripts/export-digital-twin-assets.js`: user says old standalone Digital Twin is not active. Treat as legacy/demo unless reactivated.
- Camera AI processor: can be Edge-local, Backend-owned camera intelligence, or Office demo depending on product direction.
- Shared commercial knowledge that may feed website copy, Office agents and sales material.

### LEGACY / LIKELY DEAD

Candidate legacy items:

- Digital twin demo routes/assets under lead-agent server and Vercel rewrites.
- Static `public/dashboard/dashboard.js` if Office UI has or will have a dedicated frontend repo.
- File-based CRM store if Supabase store is the production direction.

Do not delete these until imports, deployment rewrites and manual users are confirmed.

## What Prevents Clean Extraction Today

### Imports and module coupling

- `src/lead-agents/server.js` imports most Office modules directly and also imports `digital-twin`, `plan-studio`, realtime, storage, auth, email, QR, and Office sync.
- Edge root `agent.js` is mostly self-contained, which is good for extraction.
- Scripts and docs mix Office and Edge release validation under one package.

### Deployment coupling

- `render.yaml` deploys Office/lead agents, not Edge.
- `vercel.json` points public rewrites to the Render lead-agent service.
- The package is named `oyi-edge-agent`, but production Render service is `ochiga-lead-agents`.

### Secrets and environment coupling

- Edge local `.env` and Office `.env.lead-agents.example` are separate in spirit but live in one repo.
- Local `.env.lead-agents.local` is gitignored but contains live-looking secrets. This is a critical local hygiene risk.
- Office integrations include OpenAI, Supabase service-role, webhook, WhatsApp/Meta/LinkedIn/Google, and Resend variables.

### Database coupling

- Office schema contains both CRM tables and Office operational projection tables.
- Backend also contains operational source-of-truth tables. Office projection refresh must remain one-way unless a specific corporate workflow requires writing back.

### Runtime assumptions

- `office-sync.js` expects Backend/Facility/Consumer export endpoints.
- Website deployment intake can call hosted lead-agent APIs.
- Vercel rewrites make public routes dependent on the mixed repo deployment.

## Proposed Extraction Boundary

Target two repos or packages:

1. `oyi-edge-agent`
   - Local hardware runtime only.
   - No CRM, proposal, sales, Office admin, public widget, or website lead handling.

2. `ochiga-office`
   - Office CRM/BFF/dashboard/lead agents.
   - Consumes Backend projections/events.
   - Owns corporate/commercial state.
   - Does not own canonical building/home/device truth.

## Extraction Sequence

1. Freeze and document public contracts.
   - Edge: heartbeat, register, config, discovery push, camera registry.
   - Office: lead intake, public widget, CRM tables, Office export imports.

2. Add package-level ownership markers.
   - `EDGE_OWNERSHIP.md`
   - `OFFICE_OWNERSHIP.md`
   - Environment templates split by runtime.

3. Establish tests before moves.
   - Edge: `npm run check`, `npm run edge:go2rtc:dry-run`, `npm run edge:camera:dry-run`, `npm run edge:bench:camera:dry-run`.
   - Office: `npm run lead-agents:test`, lead-agent API contract tests, Office sync tests.

4. Create Office repo or package.
   - Copy Office files with history if possible.
   - Preserve deployment rewrites until new Office deployment is verified.

5. Migrate deployments.
   - Render lead-agent service should point to Office repo/package.
   - Edge has local deployment docs/process, not Render Office service.

6. Remove cross-owned code from each repo only after the new deployment passes and rollback is available.

## Compatibility Strategy

- Keep existing Render URLs and Vercel rewrites until replacement is live.
- Maintain `/api/lead-agents/*`, `/widget.js`, `/api/plan-studio/*` if public website depends on them.
- Keep Backend `/office/export` stable while Office sync migrates.
- Do not change Edge backend endpoint payloads during repo separation.

## Test Gates

Before extraction:

- Edge `npm run validate:release` passes.
- Office lead-agent tests pass.
- Website build passes.
- Backend `/office/export` route remains available.

After extraction:

- Edge heartbeat/discovery dry-run passes with local config.
- Office public lead-agent health and public chat endpoints pass.
- Website form intake can reach the intended Office endpoint.
- No Edge local credential variables are required by Office deployment.
- No Office CRM variables are required by Edge runtime.

## Rollback Strategy

- Do not remove the original mixed repo deployment until new Office deployment has served live traffic safely.
- Keep old Render service as standby until DNS/rewrites are stable.
- Tag pre-extraction SHA `5226af2c03d92f99f5cceed1099361f032d5e6e9`.
- Roll back by restoring Vercel rewrites to the existing Render service and running the original mixed repo.

## Immediate Risks

- Critical: local ignored secret file exists and should be rotated or at least verified as non-production.
- High: public website routes can depend on the lead-agent Render deployment.
- High: Office operational projection tables duplicate canonical Backend concepts.
- Medium: digital-twin demo routes may be mistaken for active architecture.

