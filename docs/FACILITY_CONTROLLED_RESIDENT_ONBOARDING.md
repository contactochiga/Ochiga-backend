# Facility-controlled resident onboarding

Status: architecture contract only. This is not exposed in Consumer UI yet.

## Future flow
1. Facility creates a resident assignment for an estate and home.
2. Backend creates an expiring invite token and a QR-safe invite URL.
3. Resident receives email, link, or QR code.
4. Consumer opens the invite link or scanner.
5. Backend validates invite scope and expiry.
6. Resident chooses username and password.
7. Backend activates the existing user and home membership.
8. Consumer hydrates the assigned home context.

## Contracts
- `ResidentInviteContract`
- `ResidentInviteCompletionContract`
- `ResidentInviteCompletionResult`

The TypeScript contracts live in `src/contracts/residentOnboarding.ts`.

## Safety requirements
- Invite tokens must be stored hashed.
- Invites must expire and be single-use.
- Facility actor and target home must share estate scope.
- Public signup can be disabled after this workflow is released.
