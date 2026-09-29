# Wave 9 executable capability/authority inventory

Generated from the same `ensureRegistered()` used by ConversationOrchestrator, not a second capability vocabulary. Reproduce with `node scripts/wave9-capability-inventory.mjs --json` after build. 73 unique registrations. Inventory itself makes no database/provider calls.

Core owns interpretation, permission/scope checks and capability selection for every row. Handler presence is not permission to execute: CapabilityService, per-module authorization, workflow confirmation and verification still apply. Office-domain execution remains the authorized Office adapter; physical device execution remains DeviceCommandAuthority/provider adapters. Read-only context recall cannot execute retained instructions. Unknown/disabled capabilities fail through existing rollout/fallback policy, not invented success. Domain fact ownership remains separate from this reasoning catalog.

| Existing ID | Domain | Rollout | Surfaces | Permissions | Risk / approval | Handlers | Evidence / scope |
|---|---|---|---|---|---|---|---|
| anomalies.read | reports | enabled | consumer | devices.read, maintenance.read, visitors.read, security.read, utilities.read, automations.read | read / none | read | operational_anomaly; home required |
| automations.list.read | automations | enabled | consumer | automations.read | read / none | read | route_contract; home required |
| automations.runs.read | automations | enabled | consumer | automations.read | read / none | read | automation_run; home required |
| community.latest.read | community | enabled | consumer, facility | community.read | read / none | read | community_post; estate required |
| context.memory.recall | global | enabled | consumer | none declared; domain/actor checks still apply | read / none | read | no required evidence declared; no required scope declared |
| corporate.company.read | corporate_company | enabled | public_corporate | none declared; domain/actor checks still apply | read / none | read | no required evidence declared; no required scope declared |
| corporate.development.read | corporate_development | enabled | public_corporate | none declared; domain/actor checks still apply | read / none | read | public_development_project; no required scope declared |
| corporate.oyi.read | corporate_oyi | enabled | public_corporate | none declared; domain/actor checks still apply | read / none | read | no required evidence declared; no required scope declared |
| corporate.partnerships.read | corporate_partnerships | enabled | public_corporate | none declared; domain/actor checks still apply | read / none | read | no required evidence declared; no required scope declared |
| corporate.private.read | corporate_private | enabled | public_corporate | none declared; domain/actor checks still apply | read / none | read | no required evidence declared; no required scope declared |
| crm.leads.read | crm | enabled | office_internal | crm.read | read / none | read | crm_lead_needs_attention; no required scope declared |
| crm.opportunities.read | crm | enabled | office_internal | crm.read | read / none | read | crm_opportunity_stale; no required scope declared |
| development.status.read | office_development | enabled | office_internal | development.manage | read / none | read | development_project_status; no required scope declared |
| devices.activity.read | devices | enabled | consumer, facility | devices.read | read / none | read | execution_history; home required |
| devices.availability.read | devices | enabled | consumer, facility | devices.read | read / none | read | device_availability; home required |
| devices.capabilities.read | devices | enabled | consumer, facility | devices.read | read / none | read | device_availability; home required |
| devices.diagnosis.read | devices | enabled | consumer, facility | devices.read | read / none | read | execution_history; home required |
| devices.failures.read | devices | enabled | consumer, facility | devices.read | read / none | read | execution_history; home required |
| devices.power.control | devices | enabled | consumer, facility | devices.control | low_risk_action / explicit_confirmation | draft | device_current_state; home required |
| devices.relationships.read | devices | enabled | consumer, facility | devices.read | read / none | read | device_availability; home required |
| devices.status.read | devices | enabled | consumer, facility | devices.read | read / none | read | device_availability; home required |
| financial.summary.read | office_financial | enabled | office_internal | financial.read | read / none | read | financial_estate_summary; no required scope declared |
| forecasts.read | reports | enabled | consumer | devices.read, maintenance.read, visitors.read, security.read, utilities.read, automations.read | read / none | read | operational_forecast; home required |
| global.capabilities.read | global | enabled | consumer, facility, office_internal, public_corporate | none declared; domain/actor checks still apply | read / none | read | no required evidence declared; no required scope declared |
| home.activity.read | home | enabled | consumer | devices.read, maintenance.read, visitors.read, security.read, utilities.read, wallet.read, services.read, community.read, automations.read, scenes.read | read / none | read | composed_context; home required |
| home.attention.read | home | enabled | consumer | devices.read, maintenance.read, visitors.read, security.read, utilities.read, wallet.read, services.read, community.read, automations.read, scenes.read | read / none | read | composed_context; home required |
| home.summary.read | home | enabled | consumer | devices.read, maintenance.read, visitors.read, security.read, utilities.read, wallet.read, services.read, community.read, automations.read, scenes.read | read / none | read | composed_context; home required |
| maintenance.requests.read | maintenance | enabled | consumer, facility | maintenance.read | read / none | read | maintenance_request; estate required |
| messages.unread.read | messages | implemented | consumer | messages.read | read / none | read | relationship_context; no required scope declared |
| office_automations.query.read | automations | enabled | office_internal | tasks.read | read / none | read | office_automation_open; no required scope declared |
| office_automations.read | automations | enabled | office_internal | tasks.read | read / none | read | office_automation_selected; no required scope declared |
| office_automations.write | automations | enabled | office_internal | tasks.manage | low_risk_action / explicit_confirmation | draft | no required evidence declared; no required scope declared |
| office_content.query.read | office_content | enabled | office_internal | content.write | read / none | read | office_content_open; no required scope declared |
| office_content.read | office_content | enabled | office_internal | content.write | read / none | read | office_content_selected; no required scope declared |
| office_documents.query.read | office_documents | enabled | office_internal | documents.generate | read / none | read | office_document_open; no required scope declared |
| office_documents.read | office_documents | enabled | office_internal | documents.generate | read / none | read | office_document_selected; no required scope declared |
| office_meetings.query.read | office_meetings | enabled | office_internal | meetings.read | read / none | read | office_meeting_open; no required scope declared |
| office_meetings.read | office_meetings | enabled | office_internal | meetings.read | read / none | read | office_meeting_selected; no required scope declared |
| office_meetings.write | office_meetings | enabled | office_internal | meetings.manage | consequential_action / explicit_confirmation | draft | no required evidence declared; no required scope declared |
| office_partnerships.query.read | corporate_partnerships | enabled | office_internal | partnerships.read | read / none | read | office_partnership_open; no required scope declared |
| office_partnerships.read | corporate_partnerships | enabled | office_internal | partnerships.read | read / none | read | office_partnership_selected; no required scope declared |
| office_partnerships.write | corporate_partnerships | enabled | office_internal | partnerships.manage | consequential_action / explicit_confirmation | draft | no required evidence declared; no required scope declared |
| office_portfolio.query.read | office_portfolio | enabled | office_internal | portfolio.read | read / none | read | office_portfolio_open; no required scope declared |
| office_portfolio.read | office_portfolio | enabled | office_internal | portfolio.read | read / none | read | office_portfolio_entry_selected; no required scope declared |
| office_portfolio.write | office_portfolio | enabled | office_internal | portfolio.manage | consequential_action / explicit_confirmation | draft | no required evidence declared; no required scope declared |
| office_support.query.read | office_support | enabled | office_internal | support.read | read / none | read | office_support_case_open; no required scope declared |
| office_support.read | office_support | enabled | office_internal | support.read | read / none | read | office_support_case_selected; no required scope declared |
| office_support.write | office_support | enabled | office_internal | support.assign | consequential_action / explicit_confirmation | draft | no required evidence declared; no required scope declared |
| office_tasks.query.read | office_tasks | enabled | office_internal | tasks.read | read / none | read | office_task_open; no required scope declared |
| office_tasks.read | office_tasks | enabled | office_internal | tasks.read | read / none | read | office_task_selected; no required scope declared |
| office_tasks.write | office_tasks | enabled | office_internal | tasks.manage | low_risk_action / explicit_confirmation | draft | no required evidence declared; no required scope declared |
| office.plan_studio.review | office_development | enabled | office_internal | planstudio.read | read / none | read | office_plan_draft; office_context required |
| predictions.read | reports | enabled | consumer | devices.read, maintenance.read, visitors.read, security.read, utilities.read, automations.read | read / none | read | operational_prediction; home required |
| recommendations.read | reports | enabled | consumer | devices.read, maintenance.read, visitors.read, security.read, utilities.read, automations.read | read / none | read | operational_recommendation; home required |
| reports.approvals.read | office_reports | enabled | office_internal | reports.write | read / none | read | report_pending_approval; no required scope declared |
| reports.period_summary.read | reports | shadow | consumer, facility | none declared; domain/actor checks still apply | read / none | read | cross_domain_summary; no required scope declared |
| room.activity.read | rooms | enabled | consumer | devices.read, maintenance.read, security.read | read / none | read | composed_context; home required |
| room.attention.read | rooms | enabled | consumer | devices.read, maintenance.read, security.read | read / none | read | composed_context; home required |
| room.status.read | rooms | enabled | consumer | devices.read, maintenance.read, security.read | read / none | read | composed_context; home required |
| rooms.inventory.read | rooms | enabled | consumer, facility | homes.read | read / none | read | composed_context; home required |
| scenes.list.read | scenes | enabled | consumer | scenes.read | read / none | read | route_contract; home required |
| security.incidents.read | security | enabled | consumer, facility | security.read | read / none | read | security_incident; estate required |
| services.active.read | services | enabled | consumer | services.read | read / none | read | service_account; home required |
| utilities.active.read | utilities | enabled | consumer, facility | utilities.read | read / none | read | service_account; estate required |
| utilities.balance.read | utilities | declared | consumer | utilities.read | read / none | read | utility_balance; no required scope declared |
| utilities.meter.read | utilities | declared | consumer, facility | utilities.read | read / none | read | meter_status; no required scope declared |
| utilities.purchases.read | utilities | enabled | consumer | utilities.read, wallet.read | read / none | read | utility_purchase; estate required |
| utilities.spending.read | utilities | enabled | consumer | wallet.read, services.read | read / none | read | utility_spending; home required |
| utilities.tariff.read | utilities | enabled | consumer, facility | utilities.read | read / none | read | utility_tariff; estate required |
| utilities.usage.read | utilities | declared | consumer, facility | utilities.read | read / none | read | utility_usage; no required scope declared |
| visitors.pending.read | visitors | enabled | consumer, facility | visitors.read | read / none | read | visitor_access; estate required |
| wallet.balance.read | wallet | enabled | consumer | wallet.read | read / none | read | wallet_balance; home required |
| wallet.transactions.read | wallet | enabled | consumer | wallet.read | read / none | read | wallet_transaction; home required |

This inventory exposes declarations and handler availability, not exhaustive proof of every handler's authorization. Freshness and provenance enforcement remains in evidence contracts/domain loaders; the JSON command includes full evidence requirements. Do not mistake no declared permission for public access without examining surfaces, actor checks and domain policy.
