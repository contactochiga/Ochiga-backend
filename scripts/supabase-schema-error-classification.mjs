export function classifySupabaseSchemaError(error) {
  const message = String(error?.message || error || "");
  const status = Number(error?.status || error?.code || 0);
  const name = String(error?.name || "");
  if (
    status === 401 ||
    status === 403 ||
    /invalid api key/i.test(message) ||
    /jwt/i.test(message) ||
    /not authenticated/i.test(message) ||
    /unauthorized/i.test(message) ||
    /forbidden/i.test(message) ||
    /auth/i.test(name)
  ) {
    return "supabase_auth";
  }
  return "schema_or_connectivity";
}

export function supabaseAuthFailureMessage(table, column) {
  return [
    `FAIL Supabase authentication/configuration failure while checking ${table}.${column}`,
    "  Remote schema verification could not be completed with the current SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY configuration.",
    "  Verify the linked project and service-role key; no schema regression has been proven by this failure.",
  ];
}
