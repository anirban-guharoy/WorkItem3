# Persistence

The SRE agent stores verified operator feedback as JSON at
`WPF_SRE_LEARNING_STORE_PATH` (default path is local development only). It has no SQL schema and
therefore no database migrations. In Kubernetes, use `/data/learning.json` on a durable volume and
one replica. Writes are serialized in-process and atomically replaced; this is not a distributed
lock or multi-replica database.
