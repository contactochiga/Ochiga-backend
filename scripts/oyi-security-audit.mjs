#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const sql = 'select public.oyi_security_audit_report() as report;';
const output = execFileSync('supabase', ['db', 'query', '--linked', '--output', 'json', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const parsed = JSON.parse(output);
const report = parsed.rows?.[0]?.report || {};
console.log(JSON.stringify(report, null, 2));

const failed = Number(report.browser_table_grant_count || 0) > 0
  || (report.tables_without_rls || []).length > 0
  || (report.unexpected_policy_gaps || []).length > 0
  || (report.unsafe_trigger_or_definer_functions || []).length > 0;
if (failed) process.exit(1);
