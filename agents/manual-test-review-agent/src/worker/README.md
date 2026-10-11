# Worker boundary

Review is currently a synchronous HTTP request: it evaluates a submitted test set and publishes
only after the review gate approves it. It has no background queue or worker process. Long-running
model and Xray calls use configured upstream timeouts/retries. A durable asynchronous worker is a
future change and must preserve the approval gate and idempotency rules.
