# Oyi Authenticated Smoke Test

Use `npm run smoke:oyi` to verify the Unified Operating Layer with a real logged-in user.

## Required environment

```bash
export OYI_API_BASE="https://your-backend.example.com"
export OYI_SMOKE_TOKEN="<paste-valid-user-token>"
export OYI_SMOKE_ESTATE_ID="<active-estate-id>"
export OYI_SMOKE_HOME_ID="<active-home-id>"
```

`OYI_SMOKE_HOME_ID` is required for Consumer home-scoped checks. Facility checks use `OYI_SMOKE_ESTATE_ID`.

## Getting a valid token

Use a real user session from Consumer OS or Facility OS.

1. Log in to the app in a browser.
2. Open Developer Tools.
3. Check Application -> Local Storage for the app origin.
4. Copy the active auth token:
   - Consumer commonly stores `oyi_consumer_token_ls` or `oyi_consumer_token`.
   - Facility commonly stores `oyi_facility_token`.
5. Paste the token into `OYI_SMOKE_TOKEN` for your current terminal session only.

Do not store real tokens in `.env`, `.env.example`, docs, commits, screenshots, tickets, or chat logs.

## Example local command

```bash
cd /Users/ochigaidoko/Documents/Ochiga-backend

OYI_API_BASE="http://localhost:5000" \
OYI_SMOKE_TOKEN="<valid-user-token>" \
OYI_SMOKE_ESTATE_ID="<estate-id>" \
OYI_SMOKE_HOME_ID="<home-id>" \
npm run smoke:oyi
```

## What the smoke verifies

- `GET /oyi/awareness`
- Consumer `/oyi/chat` prompts:
  - What can you do?
  - What’s happening?
  - What needs attention?
  - Show device status.
  - Show offline devices.
  - Show pending visitors.
  - Show wallet balance.
  - Generate today’s home summary.
  - Turn off a supported device.
- Facility `/oyi/chat` prompts:
  - What can facility control?
  - What needs attention today?
  - Show offline estate devices.
  - Show pending visitors.
  - Show open maintenance.
  - Generate today’s estate report.
  - Who did what today?
  - Execute one supported operational action.
- `GET /oyi/threads`
- `GET /oyi/threads/:threadId/messages`
- Persisted assistant metadata includes operating intent.

## Safety

The smoke uses the permissions of the supplied user token. Use a non-production or low-risk user when testing command execution. The operating layer should return permission or validation failures safely when the user cannot execute an action.
