# Oyi Camera Media Runtime Phase 4

Camera media is a private, server-authoritative resource linked to canonical `facility_cameras`. `camera_media` stores internal object references; `camera_event_media` supports multiple snapshots, thumbnails and future clips per event. Surfaces receive `CameraMediaReference` and request a 90-second signed read only after the existing camera access policy succeeds.

Edge uploads use its bound estate/node identity. Backend derives estate/home from the assigned camera, validates content bytes and size, generates the object key, and uses `(camera_id,idempotency_key)` to make outbox retries safe. Event association must match the same canonical camera and estate. Successful image ingestion establishes `metadata.frame_freshness_at`.

The private `camera-media-private` Supabase bucket is accessed through `CameraMediaStore`; storage details do not enter Camera Core. Retention defaults are ephemeral 1 day, standard 30 days, security 90 days and evidence unlimited. The retention worker is idempotent, ignores preserved/evidence media, tolerates missing objects and marks catalogue rows deleted.

Recording policy and provider interfaces are present, but continuous recording and pre-event buffering remain disabled. Future Edge, NVR and cloud recorder providers produce the same `CameraMedia` records. Digital Twin and Oyi evidence use camera/media IDs and safe metadata, never object keys or permanent URLs.
