# Worker boundary

The SRE API and Teams bot are request/response applications. They do not need a background worker
or queue: pod activity is fetched and summarized in the initiating HTTP/Teams request, and restarts
are submitted to Backstage synchronously. Do not add a queue without defining how caller identity,
restart confirmation, cancellation, and duplicate actions survive redelivery.
