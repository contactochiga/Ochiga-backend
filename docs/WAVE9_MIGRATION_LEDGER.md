# Wave 9 migration ledger — read-only production inspection

Inspected 2026-09-26 using Supabase schema metadata only; no user rows or credentials queried. Backend production project `zcpgtdakqxyvjkmiibei`: 115 history entries and 115 tracked migration files at `17e876d`. History membership is not a claim that every production object exactly equals Git SQL. No migration is deleted or applied by this audit.

Office project `metbajilbqclwjfsxfps` records only `20260521114108_office_files_audit_document_foundation` in Supabase migration history. Office uses `db/lead-agents-schema.sql` and its own schema application script; its full schema must be compared through information_schema rather than falsely treating unlisted SQL as unapplied.

| Migration | Git state | Production-applied state | Required action | Risk |
|---|---|---|---|---|
+| 20260312000100_camera_events.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260312000200_community_comments_reactions.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260312000300_messaging_chat.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260312000400_user_push_tokens.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260313000100_camera_ai_profiles.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260314000100_super_admin_controls.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260516000100_tier1_foundation_audit_events.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260516000200_tier1_foundation_permission_scopes.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260516000300_tier1_foundation_platform_files.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260521000100_pilot_onboarding_foundation.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260521000200_provider_webhook_events.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260522000100_edge_phase1_hardening.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260522000200_ai_command_hardening.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260522085935_edge_pilot_onboarding_foundation_20260522_fixed.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260522090029_edge_phase1_hardening_20260522.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260529000100_community_production_layer.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260529000200_user_avatar_profile_columns.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260530063357_user_avatar_profile_columns.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260530063734_profile_avatar_storage_bucket.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260530173217_consumer_scenes_automations.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260530194500_user_profile_phone.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260531164609_scene_descriptions.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260531165847_scene_descriptions.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260601000100_invite_first_onboarding_phase1.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260601195049_fix_invite_activation_ambiguous_conflicts.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260601195502_fix_invite_activation_membership_upsert.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260602125600_add_device_registry_bind_state.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260602230840_platform_gap_closure_stage_b.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260606000100_resident_proximity_awareness.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260606000200_intelligence_memory_timeline.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260606000300_device_events_usage_counters.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260611000100_ochiga_intelligence_events.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260611000200_ochiga_intelligence_phase3.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260611000300_ochiga_intelligence_predictions.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260611000400_ochiga_organization_intelligence.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260612000100_ochiga_workflow_orchestration.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260612204345_service_registry_phase1.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260613000100_notification_runtime_intelligence.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260619093000_oyi_conversation_history.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260621174712_oyi_language_teacher.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260621230236_oyi_production_security_closure_phase1.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260621233428_oyi_production_security_closure_phase2.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260621233753_oyi_security_audit_report_gap_classification.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260622001731_facility_operational_lifecycle_phase3.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260622044434_facility_incident_notification_handover_phase4.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260622155722_ois_notification_routing_contract.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260629000100_oyi_core_execution_ledger_v11.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260709000100_infrastructure_services_home_provisioning.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260709000200_infrastructure_services_phase2_runtime.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260710000100_ir_virtual_appliances.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260710000200_repair_ir_device_schema.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260711000100_wallet_atomic_debit.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260716210000_create_device_states.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260716234055_infrastructure_onboarding_engine.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260718125719_repair_home_service_account_provisioning.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260718163714_release_stabilization_multi_home_isolation.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260721214703_service_transactions_schema_cache_repair.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260721224157_electricity_purchase_lifecycle.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260722093000_tuya_ir_inventory_stabilization.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260722100000_tuya_lock_category_mapping.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260725113000_enterprise_provider_connections_device_projection.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260725143000_smart_access_device_capabilities.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260725165000_presence_home_scope_conflict_repair.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260728093656_automation_runtime_v2_completion.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260728143000_oyi_core_convergence_canonical_storage.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260729130500_oyi_intelligence_security_posture_closure.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260812000100_communications_sessions_handoffs.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260813072416_oyi_conversation_workflow_action_persistence.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260813090500_relax_oyi_workflow_action_thread_fk.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260814090000_oyi_learning_parameters.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260814203000_intelligence_feedback_lookup_index.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260819200000_oyi_observability_closure.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260820000000_automation_surface_contract.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260820100000_automation_owner_label.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260822120000_oyi_communication_runtime.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260822130000_oyi_communications_inbound_source.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260822140000_oyi_goals.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260822150000_oyi_goals_paused_status.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260823100000_oyi_inbound_reply_loop.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260824103037_camera_media_runtime_phase4.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260824105101_camera_detection_intelligence_phase5.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260824120000_camera_runtime_phase1_hardening.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260824150000_camera_gateway_phase3.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260828120000_estate_owner_invite_activation.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260829090000_fix_estate_owner_invite_role_promotion.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260829091000_extend_membership_role_canonical_values.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260829092000_estate_profile_fields.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260830090000_facility_automation_policy_and_approvals.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260830100000_automation_approvals_entityless_actions.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260830110000_automation_approvals_policy_rls.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260830180000_estates_add_type_column.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260831090000_facility_automation_event_rules.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260901090000_soften_estate_owner_invite_conflict_message.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260901100000_fix_estate_owner_role_promotion_regression.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260901120000_fix_resident_invite_existing_identity_credentials.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260901150000_typed_utility_pricing_plans.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260905010000_LOCAL_TEST_home_zone_building_link.sql | tracked | APPLIED (history verified) | retain; applied despite filename; never delete | schema/statement equivalence requires separate verification |
| 20260905020000_LOCAL_TEST_home_canonical_ref.sql | tracked | APPLIED (history verified) | retain; applied despite filename; never delete | schema/statement equivalence requires separate verification |
| 20260905030000_LOCAL_TEST_room_canonical_ref.sql | tracked | APPLIED (history verified) | retain; applied despite filename; never delete | schema/statement equivalence requires separate verification |
| 20260905040000_LOCAL_TEST_device_canonical_ref.sql | tracked | APPLIED (history verified) | retain; applied despite filename; never delete | schema/statement equivalence requires separate verification |
| 20260905050000_LOCAL_TEST_device_parent_relationship.sql | tracked | APPLIED (history verified) | retain; applied despite filename; never delete | schema/statement equivalence requires separate verification |
| 20260915090000_home_building_zone_floor_link.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260915090100_home_canonical_ref.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260915090200_room_canonical_ref.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260915090300_device_canonical_ref.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260917110000_facility_automation_device_command_correlation.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260923120000_operational_awareness_direct_scope_columns.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260924090934_wave6_edge_current_state_atomic_ingestion.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260924093033_wave6_camera_observation_persistence.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260924101810_wave6_camera_health_transition_outbox.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260924112951_wave6_canonical_materialization_durability.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260924130000_maintenance_requests_schema_drift_closure.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260925090000_wave7_slice2_goal_canonical_signal_lineage.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260925100000_wave7_slice5_canonical_decision.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
| 20260926090000_wave8_slice5_learning_parameter_governance.sql | tracked | APPLIED (history verified) | retain; no history repair indicated | schema/statement equivalence requires separate verification |
