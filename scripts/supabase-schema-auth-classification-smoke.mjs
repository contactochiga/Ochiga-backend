#!/usr/bin/env node
import assert from "node:assert/strict";
import { classifySupabaseSchemaError, supabaseAuthFailureMessage } from "./supabase-schema-error-classification.mjs";

assert.equal(classifySupabaseSchemaError({ message: "Invalid API key", status: 401 }), "supabase_auth");
assert.equal(classifySupabaseSchemaError({ message: "JWT expired" }), "supabase_auth");
assert.equal(classifySupabaseSchemaError({ message: "column wallet_transactions.reference does not exist" }), "schema_or_connectivity");

const message = supabaseAuthFailureMessage("wallet_transactions", "reference").join("\n");
assert.match(message, /Supabase authentication\/configuration failure/);
assert.match(message, /wallet_transactions\.reference/);
assert.match(message, /no schema regression has been proven/i);

console.log("supabase schema auth classification smoke passed");
