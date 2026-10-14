// Local presence audit only. Never prints credential values or sends a request.
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../iq11e/contract.mjs';
export function inspectAccess(env = process.env, names = fs.readdirSync(ROOT)) {
  const variables = ['OPENAI_API_KEY', 'OPENAI_PROJECT_ID', 'OPENAI_PROJECT', 'OPENAI_ORG_ID', 'OPENAI_ADMIN_KEY', 'OPENAI_BASE_URL'];
  const presence = Object.fromEntries(variables.map(k => [k, Boolean(env[k]?.trim())]));
  return {
    checked_at: new Date().toISOString(), checked_scope: 'Current process environment and this worktree root only; no keychain/global credential search',
    environment_presence: presence,
    local_credential_file_present: names.some(n => /^\.env(?:\.|$)/.test(n) && !/example|sample|template/.test(n)),
    credential_status: presence.OPENAI_API_KEY ? 'PRESENT_NOT_AUTHENTICATED' : 'UNAVAILABLE_IN_CHECKED_SCOPE',
    project_status: presence.OPENAI_PROJECT_ID || presence.OPENAI_PROJECT ? 'PRESENT_NOT_VERIFIED' : 'UNAVAILABLE_IN_CHECKED_SCOPE',
    billing_status: 'NOT_VERIFIED', project_data_controls: 'NOT_VERIFIED',
    model_access: 'NOT_VERIFIED', authenticated_api_requests: 0, paid_inference_calls: 0,
    note: 'Environment presence never proves valid authentication, quota, credit, billing or retention. No paid probe is permitted.'
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) console.log(JSON.stringify(inspectAccess(), null, 2));
