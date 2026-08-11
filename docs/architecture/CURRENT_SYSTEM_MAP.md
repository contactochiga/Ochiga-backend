# Current System Map

Generated from local repository inspection on 2026-08-11. This document is an audit baseline, not a refactor plan execution.

## Active Local Repositories

| Repository | Local path | Remote | Branch / HEAD | Status | Apparent responsibility |
| --- | --- | --- | --- | --- | --- |
| Ochiga Backend | `/Users/ochigaidoko/Documents/Ochiga-backend` | `git@github.com:contactochiga/Ochiga-backend.git` | `main` at `7eaf5439c072dcb59e3d519f6560821d6da7fcf6` before audit branch | Dirty: protected `M .gitignore`, `?? opencode.json` | Canonical operational backend, Oyi Core, devices, homes/buildings, Facility/Consumer APIs, wallet/services, visitors, maintenance, conversations, events, notifications. |
| Oyi Edge / Office mixed repo | `/Users/ochigaidoko/oyi-edge-agent` | `https://github.com/contactochiga/oyi-edge-agent.git` | `main` at `5226af2c03d92f99f5cceed1099361f032d5e6e9` | Clean | Mixed local edge runtime plus Office/lead-agent/CRM surface. |
| Facility OS | `/Users/ochigaidoko/Documents/facility-oyi` | `git@github.com:contactochiga/facility-oyi.git` | `main` at `f34039273a7e2ae807a5c6f15ec212fe19b4308a` | Clean | Building/facility frontend consuming Backend APIs. |
| Consumer OS active code copy | `/Users/ochigaidoko/Documents/New project/Oyi-os-frontend` | Nested under parent `New project` repo, not its own git checkout | No local `.git` in this folder | Parent repo sees it as untracked | Active resident frontend code used by current validation; consumes Backend APIs. |
| Consumer OS stale checkout | `/Users/ochigaidoko/Oyi-os-frontend` | `https://github.com/contactochiga/Oyi-os-frontend.git` | `main` at `2547dfbde0341f12223435d7d5dc95395864b803`; `0/85` behind origin | Clean | Stale Consumer checkout; should not be treated as active without reconciliation. |
| Ochiga Website | `/Users/ochigaidoko/Documents/Ochiga-website` | `https://github.com/contactochiga/Ochiga-website.git` | `claude/phase4-cinematic-experience` at `dafaa7d9a220935bcd9f22150f0c3baab0761ee6` | Clean | Corporate website and public lead intake. |
| New project parent workspace | `/Users/ochigaidoko/Documents/New project` | `https://github.com/difusedosmosis-ship-it/zota-platform.git` | `main` at `16c0223d0217e8e1c14248395a69a2cd4444b982` | Dirty with tracked iOS/package-lock changes and multiple untracked Ochiga/Oyi repo copies | Workspace/container risk, not canonical Ochiga source of truth. |

## Runtime And Deployment Shape

### Backend

Backend is an Express/TypeScript service with Supabase integration. It mounts operational routes in `src/app.ts`, including:

- Auth and context: `/auth`, `/me`, `/home/members`, `/rooms`.
- Core resident/facility operations: `/devices`, `/visitors`, `/maintenance`, `/messages`, `/community`, `/wallets`, `/services`, `/scenes`, `/automations`.
- Oyi intelligence: `/ai`, `/oyi`, `/intelligence`, `/signals`, `/activity`.
- Facility and infrastructure: `/facility`, `/facility/maintenance`, `/facility/visitors`, `/cameras`, edge discovery routes.
- Office export: `/office`.

Deployment/config evidence:

- `Dockerfile`
- `supabase/config.toml`
- `supabase/migrations/*`
- `.env.example` contains only smoke/test variable names: `OYI_API_BASE`, `OYI_SMOKE_ESTATE_ID`, `OYI_SMOKE_HOME_ID`, `OYI_SMOKE_TOKEN`.

### Consumer

The active Consumer code is a Next/Capacitor app in `/Users/ochigaidoko/Documents/New project/Oyi-os-frontend`. It uses `src/services/api.ts` as the axios base client, with `X-Ochiga-Surface: consumer`, JWT attachment, active estate/home headers and Oyi contract version headers.

Important API clients and contracts:

- `src/services/oyiService.ts`: `/oyi/awareness`, `/oyi/runtime/conversation`, `/oyi/threads`, `/oyi/threads/:id/messages`.
- `src/services/deviceService.ts`: discovery, estate devices, state, commands, IR, smart access.
- `src/services/walletService.ts`, `servicesService.ts`, `visitorService.ts`, `maintenanceService.ts`, `messagesService.ts`, `communityService.ts`.
- `src/store/useActiveIntelligenceContextStore.ts`: active AI context that must remain hint-only.

Packaging risk:

- Next build warns that it selected `/Users/ochigaidoko/Documents/New project/package-lock.json` as workspace root because multiple lockfiles exist. This is caused by the active Consumer folder being nested inside another git/workspace repo.

### Facility

Facility is a Next/Capacitor app. It uses `services/api.ts` with `X-Ochiga-Surface: facility`, `NEXT_PUBLIC_API_URL`, and facility JWT. Conversation integration is in `services/oyiService.ts` and `store/useFacilityConversationStore.ts`.

Facility still contains a local browser-side conversation runtime under `lib/conversationRuntime.ts` and runtime subscription helpers. This is useful for presentation/state orchestration, but must not become a second canonical Backend intelligence runtime.

### Edge / Office

`/Users/ochigaidoko/oyi-edge-agent` contains two active responsibility families:

- Edge runtime: root `agent.js`, `edge/camera/*`, `scripts/edge-camera-common.js`, `scripts/generate-go2rtc-config.js`, `scripts/check-camera-runtime-readiness.js`, local outbox, heartbeat, config pull, discovery push, go2rtc health.
- Office/CRM/lead-agent runtime: `lead-agents-server.js`, `src/lead-agents/*`, `src/intelligence-core/index.js`, `db/lead-agents-schema.sql`, `prompt-packs/*`, `knowledge/*`, `public/dashboard`, `public/widget`, `render.yaml`, `vercel.json`.

Deployment/config evidence:

- Render service `ochiga-lead-agents` starts `npm run lead-agents:start`.
- Vercel rewrites route `/api/lead-agents/*`, `/api/digital-twin/*`, `/api/plan-studio/*`, `/webhooks/*` to Render.
- Edge local `.env` names include agent/site/cloud/camera/ONVIF token variables.
- Office `.env.lead-agents.example` defines OpenAI, Supabase, Office export, webhook, WhatsApp/Meta/LinkedIn/Google, email, and storage variables.

Security note: `.env.lead-agents.local` is ignored by git but contains live-looking secrets in the local workspace. It must not be printed, committed, or copied into docs.

### Website

The website is a Next app with two public lead intake paths:

- `app/api/leads/route.ts`: newer structured lead API using Zod schemas, bot checks, email via Resend, and local fallback only when allowed.
- `app/api/deployments/route.ts`: older deployment-specific API that builds a lead payload and tries Office endpoint, webhook, hosted lead agent, then local fallback.

This means CRM ingestion is partly shaped already but not yet converged into one canonical intake adapter.

## Primary Data Stores And Schemas

Backend Supabase migrations include canonical operational tables for:

- Devices/runtime: `devices`, `device_states`, `device_events`, `device_runtime_sessions`, provider connections, IR virtual appliances, Smart Access.
- Conversations/intelligence: `oyi_conversation_threads`, `oyi_conversation_messages`, `ai_execution_ledger`, `operational_signals`, `operational_awareness`, `operational_insights`, `operational_recommendations`, `operational_delivery_outbox`.
- Facility/building: estates, homes, rooms, facility cameras/incidents, infrastructure onboarding.
- Consumer domains: visitors, maintenance, wallets, wallet transactions, services, community, messages, notifications.
- Organization/intelligence: `ochiga_organization_*`, `ochiga_intelligence_*`, `ochiga_workflow_events`.

Edge/Office has a separate SQL schema in `db/lead-agents-schema.sql`, with:

- CRM/lead tables: `leads`, `conversations`, `lead_channel_states`, `inbound_events`, `demos`, `proposals`, `lead_memories`, `traces`, `notifications`, `timeline_events`.
- Office operational projections: `office_packages`, `office_estates`, `office_buildings`, `office_homes`, `office_devices`, `office_wallets`, `office_analytics`, `office_support_mappings`, `office_documents`, `office_files`.
- Office users/audit: `admin_users`, `admin_invites`, `password_reset_tokens`, `audit_events`.

## Current Control Flow Summary

1. Consumer and Facility authenticate against Backend and attach surface/context headers.
2. Consumer/Facility call Backend operational routes directly for domain operations.
3. Consumer/Facility call `/oyi/runtime/conversation` for canonical Oyi conversation turns.
4. Backend `src/routes/oyiRoutes.ts` maps request bodies into conversation requests and calls `conversationOrchestrator.run`.
5. The Phase 1 orchestrator parses semantic frames, resolves turn authority, selects registered capabilities, and currently delegates unsupported paths to the legacy canonical runtime.
6. The legacy canonical runtime still owns most rich response building, persistence, target hydration, domain logic, and compatibility fallback.
7. Edge agent sends local heartbeat/discovery/camera health to Backend routes.
8. Office lead agents can call Office/Facility/Consumer export endpoints and maintain separate CRM/office projection tables.
9. Website sends leads through email/local fallback and in one route can forward to Office/webhook/lead-agent endpoints.

## Baseline Validation

See `PLATFORM_CLEANUP_ROADMAP.md` for full command results. Core outcome: all safe baseline checks run during this audit passed, with warnings called out rather than hidden.

## Implementation Update — 2026-08-11

Phase 1 boundary contracts are now represented in code by `src/contracts/platformBoundaries.ts` and guarded by `npm run smoke:platform-boundary-contract`.

Current source-of-truth decisions now enforced by contract:

- Ochiga Backend remains canonical for operational/building/platform state, Oyi Core intelligence and the canonical conversation runtime.
- Ochiga Office is the canonical owner for corporate CRM/commercial intake and relationship state.
- Oyi Edge Agent is scoped to local building runtime responsibilities: camera/device runtime, heartbeat, outbox, offline/local execution and Backend connectivity.
- Public website intake targets the Office CRM intake contract; email remains notification/fallback, not the CRM database.
- Consumer and Facility continue to consume Backend APIs; neither frontend becomes a canonical backend.
