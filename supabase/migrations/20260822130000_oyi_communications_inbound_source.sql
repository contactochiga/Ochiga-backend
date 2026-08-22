-- Oyi Communication Actions Runtime -- inbound threading (Phase 5).
-- An inbound WhatsApp/email message is not "conversation"/"automation"/
-- "task"/"workflow" sourced -- it originates from the provider webhook
-- itself. Widens the source check constraint to include this, rather
-- than forcing an inbound row into a misleading existing value.

begin;

alter table public.oyi_communications
  drop constraint if exists oyi_communications_source_check;

alter table public.oyi_communications
  add constraint oyi_communications_source_check
  check (source in ('conversation', 'automation', 'task', 'workflow', 'inbound_webhook'));

commit;
