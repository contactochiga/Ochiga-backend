# Oyi Camera Detection Intelligence — Phase 5

`facility_cameras` remains canonical identity. `camera_media` remains canonical evidence. `camera_detections` stores normalized observations and may reference one aggregated `camera_events` occurrence and one authorized media record.

Edge owns bounded frame sampling and provider adapters. `YOLO_BRIDGE_URL` is an optional external detector provider, not an embedded Oyi model. Provider health is separate from camera/stream health. Unknown labels normalize to `unknown`; face, plate and identity recognition remain unavailable.

Bounding boxes and visual-zone geometry use normalized frame coordinates (`0.0..1.0`). Tracking IDs are ephemeral object tracks, never people or resident identities. Attributes are shallow scalar metadata only; URLs, credentials, images, tensors and embeddings are rejected.

Edge detection ingestion is authenticated by the Phase 1/3 bound node identity. Backend derives estate/home ownership from the canonical camera, validates optional zone/media relationships, deduplicates retries, aggregates frame-level detections into bounded events, assigns deterministic severity and publishes concise Oyi evidence. Browsers query through camera access policy; the tables are RLS-enabled and unavailable directly to `anon`/`authenticated` roles.

Realtime continues to publish scoped camera events rather than global raw detections. Low-value unlinked detections expire after seven days; event-linked detections align with the 90-day security evidence window. Existing notification and governed automation systems consume camera events—there is no parallel notification/action runtime.

Phase 6 may add plate/OCR, access/visitor correlation, incident timelines and separately governed biometrics as consumers/providers of this Camera → Media → Detection → Event architecture. Those capabilities must not reinterpret tracking IDs as identity.
