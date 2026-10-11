# Persistence

The reviewer currently uses a local JSON record store (`DATA_DIR`) for review idempotency and
recovery. It does not use a relational database, so there are no SQL migrations. The deployment
must mount durable storage at `/data` and remain at one replica. Atomic rename protects individual
record writes; it does not provide cross-pod locking or transactional multi-record semantics.
Move this store to PostgreSQL before deploying multiple replicas or requiring stronger recovery
guarantees.
