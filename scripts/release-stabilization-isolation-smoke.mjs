import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function assertIncludes(file, needle, label = needle) {
  const body = read(file);
  if (!body.includes(needle)) {
    throw new Error(`${file} is missing ${label}`);
  }
}

function assertMatch(file, regex, label = String(regex)) {
  const body = read(file);
  if (!regex.test(body)) {
    throw new Error(`${file} does not satisfy ${label}`);
  }
}

const migration = "supabase/migrations/20260718163714_release_stabilization_multi_home_isolation.sql";
const serviceTransactionRepairMigration = "supabase/migrations/20260721214703_service_transactions_schema_cache_repair.sql";

assertIncludes(migration, "idx_wallets_user_home_unique", "home-scoped wallet uniqueness");
assertIncludes(migration, "wallet_account_id", "wallet transaction account scope");
assertIncludes(migration, "service_transactions", "service_transactions repair");
assertIncludes(serviceTransactionRepairMigration, "create table if not exists service_transactions", "corrective service transaction table repair migration");
assertIncludes(serviceTransactionRepairMigration, "idempotency_key", "service transaction idempotency key");
assertIncludes(serviceTransactionRepairMigration, "select pg_notify('pgrst', 'reload schema')", "corrective service transaction migration reloads PostgREST schema cache");
assertIncludes(migration, "dm_threads", "message thread scope repair");
assertIncludes(migration, "home_id uuid", "home-scoped message columns");
assertIncludes(migration, "oyi_credit_home_wallet", "home wallet credit RPC");
assertIncludes(migration, "oyi_debit_home_wallet", "home wallet debit RPC");

assertIncludes("src/services/walletScopeService.ts", "resolveWalletScopeFromRequest", "canonical wallet scope resolver");
assertIncludes("src/services/walletScopeService.ts", ".eq(\"home_id\", scope.homeId)", "home wallet lookup");
assertIncludes("src/controllers/walletController.ts", "resolveWalletScopeFromRequest", "wallet controller context resolution");
assertIncludes("src/controllers/walletController.ts", "oyi_credit_home_wallet", "wallet funding exact wallet credit");
assertIncludes("src/controllers/walletController.ts", "wallet_home_scope_mismatch", "wallet payment home mismatch guard");
assertIncludes("src/controllers/servicesController.ts", "resolveWalletScopeForHome", "service payment home wallet scope");
assertIncludes("src/controllers/servicesController.ts", "wallet_account_id: wallet.id", "service payment wallet account stamping");
assertIncludes("src/controllers/servicesController.ts", "serviceTransactionErrorResponse", "service transaction typed error response");
assertIncludes("src/controllers/servicesController.ts", "service_schema_unavailable", "missing service transaction schema maps to 503");
assertIncludes("src/controllers/servicesController.ts", "idempotency_key", "service transaction idempotency propagation");
assertIncludes("src/controllers/servicesController.ts", "transaction_availability", "service status semantic separation");
assertIncludes("src/services/homeServiceProvisioning.ts", "getOrCreateScopedWallet", "home provisioning creates home wallet");

assertIncludes("src/routes/messages.ts", "resolveRequestContext", "message routes resolve active context");
assertIncludes("src/controllers/messagesController.ts", "assertActiveHomeMembership", "message home membership guard");
assertIncludes("src/controllers/messagesController.ts", ".eq(\"home_id\", homeId)", "message inbox home filtering");
assertIncludes("src/routes/maintenance.routes.ts", "resolveRequestContext", "maintenance routes resolve active context");
assertIncludes("src/controllers/maintenance.controller.ts", ".eq(\"home_id\", homeId)", "maintenance home filtering");
assertMatch("src/controllers/maintenance.controller.ts", /home_memberships[\s\S]+eq\("home_id", requestedHomeId\)/, "maintenance validates home membership");
assertIncludes("src/controllers/maintenance.controller.ts", "NotificationService.sendToUser", "maintenance notifications use canonical notification service");
assertIncludes("src/controllers/maintenance.controller.ts", "home_id: existing.home_id", "maintenance update notifications keep home scope");

assertIncludes("src/routes/notifications.ts", "resolveRequestContext", "notifications resolve active context");
assertIncludes("src/routes/notifications.ts", "home_id.eq", "notifications filter by active home");
assertIncludes("src/routes/notifications.ts", "markNotificationAcknowledged(id, String(user.id), req.oisContext?.estate_id", "notification read acknowledgement is context-scoped");
assertIncludes("src/services/NotificationService.ts", ".from(\"home_memberships\")", "home notifications resolve active memberships");
assertIncludes("src/services/NotificationService.ts", "home_id: row?.home_id", "push payload carries home scope");

assertIncludes("src/routes/activity.ts", "resolveRequestContext", "activity routes resolve active context");
assertIncludes("src/routes/activity.ts", "req.oisContext?.home_id", "activity uses active home from canonical context");
assertIncludes("src/routes/activity.ts", ".eq(\"home_id\", homeId)", "activity source queries filter selected home");
assertIncludes("src/routes/activity.ts", ".eq(\"home_id\", homeId)", "activity wallet and domain records are home filtered");

assertIncludes("src/routes/proximityRoutes.ts", "resolveRequestContext", "proximity routes resolve active context");
assertIncludes("src/routes/proximityRoutes.ts", "scopedUser(req)", "proximity uses selected-home context");
assertIncludes("src/services/proximityService.ts", "home_id.eq", "proximity attention notifications are home-scoped");

assertIncludes("src/routes/scenes.ts", "resolveRequestContext", "scenes resolve active context");
assertIncludes("src/routes/scenes.ts", "activeScope(req)", "scenes use selected active scope");
assertIncludes("src/routes/scenes.ts", "executeDeviceCommandForActor", "scene execution stays on canonical command runtime");

assertIncludes("src/routes/visitors.ts", "resolveRequestContext", "visitor routes resolve active context");
assertIncludes("src/controllers/visitorController.ts", "(req as any).oisContext?.home_id", "visitor controller reads selected active home");
assertIncludes("src/controllers/visitorController.ts", "visitor_id", "visitor notifications carry canonical visitor id");
assertIncludes("src/controllers/visitorController.ts", "home_id: data.home_id", "visitor update notifications carry home scope");

console.log("release-stabilization-isolation-smoke: ok");
