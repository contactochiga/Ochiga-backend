# CRM Ingestion Plan

This plan is based on the current website and Office/lead-agent code. It describes the target flow but does not implement it in this phase.

## Existing Website Submission Paths

### `/api/leads`

Files:

- `/Users/ochigaidoko/Documents/Ochiga-website/app/api/leads/route.ts`
- `/Users/ochigaidoko/Documents/Ochiga-website/lib/leads/schemas.ts`
- `/Users/ochigaidoko/Documents/Ochiga-website/lib/leads/build-payload.ts`
- `/Users/ochigaidoko/Documents/Ochiga-website/lib/leads/persist.ts`
- `/Users/ochigaidoko/Documents/Ochiga-website/lib/leads/security.ts`
- `/Users/ochigaidoko/Documents/Ochiga-website/lib/email.ts`

Current lead types:

- `LAND_JV`
- `OYI_DEPLOYMENT`
- `PRIVATE_MEMBERSHIP`
- `STRATEGIC_PARTNER`
- `GENERAL_CONTACT`

Current behavior:

- Parses JSON body.
- Applies body-size limit.
- Validates lead type.
- Applies in-memory rate limit.
- Applies honeypot and minimum form-age checks.
- Validates using Zod schemas.
- Builds structured `LeadPayload`.
- Sends internal and acknowledgement emails through Resend.
- Falls back to local JSONL only when explicitly enabled or non-production.
- Returns failure if neither email nor fallback persistence succeeds.

### `/api/deployments`

Files:

- `/Users/ochigaidoko/Documents/Ochiga-website/app/api/deployments/route.ts`
- `/Users/ochigaidoko/Documents/Ochiga-website/app/deployments/page.tsx`

Current behavior:

- Validates a deployment-specific form.
- Builds a deployment lead payload.
- Attempts delivery in this order:
  1. configured Office endpoint;
  2. configured webhook;
  3. hosted lead-agent public chat endpoint;
  4. local JSONL fallback when allowed.

This route already points toward CRM ingestion but is separate from the newer `/api/leads` framework.

## Existing Office CRM Capabilities

Repository: `/Users/ochigaidoko/oyi-edge-agent`

Schema: `db/lead-agents-schema.sql`

Existing CRM/Office tables include:

- `leads`
- `conversations`
- `lead_channel_states`
- `inbound_events`
- `demos`
- `proposals`
- `lead_memories`
- `traces`
- `notifications`
- `partners`
- `deployment_projects`
- `facility_workspaces`
- `onboarding_emails`
- `timeline_events`
- `audit_events`

Existing Office projection tables include:

- `office_packages`
- `office_estates`
- `office_buildings`
- `office_homes`
- `office_devices`
- `office_wallets`
- `office_analytics`
- `office_support_mappings`
- `office_documents`
- `office_files`

Existing service code:

- `src/lead-agents/store-supabase.js` creates/updates leads, conversations, timeline, demos, proposals, partners, deployment projects and Office projections.
- `src/lead-agents/runtime.js` can create leads from conversations and use marketing/sales prompt packs.
- `src/lead-agents/webhooks.js` supports alert/handoff style delivery.

## Target Ingestion Contract

Website should submit a normalized CRM intake event:

```ts
type WebsiteCrmIntake = {
  request_id: string;
  source: "ochiga_website";
  source_route: string;
  lead_type:
    | "LAND_JV"
    | "OYI_DEPLOYMENT"
    | "PRIVATE_MEMBERSHIP"
    | "STRATEGIC_PARTNER"
    | "GENERAL_CONTACT";
  submitted_at: string;
  page_url: string;
  person: {
    full_name: string;
    email: string;
    phone: string | null;
  };
  organisation: {
    name: string | null;
    website_or_linkedin: string | null;
  };
  commercial_context: Record<string, unknown>;
  consent: true;
  metadata: {
    ip_hash: string;
    form_age_ms: number;
    user_agent_hash?: string;
  };
};
```

## Idempotency Strategy

Use `request_id` as the first idempotency key. Add a secondary hash:

- lowercased email;
- lead type;
- normalized organisation/company;
- normalized page URL;
- submission date bucket.

Office ingestion should:

- insert `inbound_events` first;
- dedupe exact `request_id`;
- upsert or match contact/lead by email/phone where allowed;
- append `timeline_events` for every accepted intake;
- never silently discard duplicate submissions; record them as duplicate-linked events.

## Contact / Account / Opportunity Matching

Target Office CRM model should distinguish:

- contact/person;
- organisation/account;
- opportunity/enquiry;
- activity/timeline;
- assignment/follow-up.

Current Office schema has `leads` but not a fully normalized contact/account/opportunity split. Phase 1 should add contracts and adapters before schema changes.

Matching recommendation:

1. Contact: email exact match, then phone normalized match.
2. Organisation: exact normalized organisation/company, then website/domain match.
3. Opportunity: lead type + organisation/contact + open stage.
4. Activity: always append a timeline event.

## Email Notification Relationship

Email should become notification/fallback, not canonical storage.

Target behavior:

1. Website posts to Office CRM ingestion.
2. Office stores intake event and lead/opportunity/activity.
3. Office sends internal notification email or alert.
4. Website sends acknowledgement after Office accepts, or shows a clear failure if Office is unavailable and no durable queue exists.

## Security And Authentication

Requirements:

- Signed server-to-server requests from Website to Office or Backend.
- Shared secret or asymmetric signature with timestamp and replay window.
- Body-size limits and schema validation preserved.
- In-memory rate limiting replaced or supplemented with shared rate limiter for production.
- No browser-visible Office API keys.
- No PII in logs beyond hashed identifiers.

## Failure And Retry Strategy

Recommended durable lifecycle:

1. Website validates and sends to CRM ingestion.
2. CRM ingestion writes `inbound_events` with `status=received`.
3. CRM normalizes/matches/creates records transactionally or marks `needs_review`.
4. Email notification attempts after durable write.
5. Failed email does not fail CRM intake.
6. Failed CRM write fails the request unless a durable queue is configured.

## Phase 1 CRM Work

Do first:

- Pick one canonical website intake route.
- Preserve `/api/leads` and `/api/deployments` compatibility while routing both to one shared ingestion client.
- Add a no-secret Office ingestion endpoint contract.
- Add tests for schema, idempotency, bot checks and failure states.

Do not do yet:

- Replace Office CRM schema.
- Remove lead-agent fallback.
- Remove email.
- Change website UI during concurrent Claude work.

