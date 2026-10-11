# Runbook

| Symptom                            | Check                                                  | Action                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pod is not ready                   | `GET /healthz`, pod events, container logs             | The probe is process health only; inspect the latest startup error and required configuration.                                                    |
| Review returns 400                 | Response validation details                            | Correct the payload to the shared `ReviewRequest`/test-case contract.                                                                             |
| Review returns `changes_requested` | `review.findings` and `review.coverage` in response    | Fix criterion coverage/actionability and submit a revised test set. Xray should not have been called.                                             |
| Review passes but returns 503      | Xray configuration                                     | Set the Xray client id/secret through Key Vault/secret provider and retry.                                                                        |
| Publish returns 502                | Sanitized application log and persisted `xrayProgress` | Verify Xray availability/permissions; retry the same request fingerprint to resume. Check Xray manually if its idempotency behavior is unknown.   |
| Repeated busy 409                  | Review record status and `updatedAt`                   | Allow the active call to finish. A stale `reviewing`/`publishing` record older than one hour may be retried; inspect external Xray effects first. |
| Lost review state after restart    | Mounted path and PVC                                   | Set `DATA_DIR=/data` and mount the durable volume. Do not rely on container writable layers.                                                      |

Rollback with Helm to the prior revision. Review state format changes must remain backward
compatible; back up the `/data` volume before upgrades.
