const MAX_RESPONSE_BYTES = 1_000_000;

export function isKubernetesResourceName(value, maxLength = 253) {
  return typeof value === "string" &&
    value.length <= maxLength &&
    /^[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?$/.test(value);
}

export function redactSensitiveData(value) {
  if (Array.isArray(value)) return value.map(redactSensitiveData);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        /(token|secret|password|authorization|credential|api.?key)/i.test(key)
          ? "[redacted]"
          : redactSensitiveData(entry),
      ]),
    );
  }
  return value;
}

function fillTemplate(value, parameters) {
  return value.replace(/\{(namespace|pod)\}/g, (_match, key) => encodeURIComponent(parameters[key] || ""));
}

export function createBackstageClient(config, fetchImpl = fetch) {
  async function request(path, { method = "GET", body } = {}) {
    if (!config.baseUrl || !config.token || !path) {
      throw new Error("Backstage base URL, API token, and endpoint path must be configured");
    }
    const url = new URL(path, `${config.baseUrl}/`);
    if (url.origin !== new URL(config.baseUrl).origin) {
      throw new Error("Backstage endpoint paths must remain on the configured server origin");
    }
    const response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "manual",
      signal: AbortSignal.timeout(config.requestTimeoutMs || 15000),
    });
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
      throw new Error("Backstage response exceeded the 1 MB limit");
    }
    if (!response.ok) {
      throw new Error(`Backstage request failed with HTTP ${response.status}`);
    }
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      throw new Error("Backstage returned a non-JSON response");
    }
  }

  return {
    async getAzureHealth() {
      return redactSensitiveData(await request(config.healthPath));
    },
    async getPods() {
      return redactSensitiveData(await request(config.podsPath));
    },
    getPodActivity(namespace, pod) {
      return request(fillTemplate(config.activityPath, { namespace, pod })).then(redactSensitiveData);
    },
    restartPod(namespace, pod) {
      let body;
      try {
        body = JSON.parse(fillTemplate(config.restartBodyTemplate, { namespace, pod }));
      } catch {
        throw new Error("BACKSTAGE_RESTART_ACTION_BODY must be valid JSON with optional {namespace} and {pod} placeholders");
      }
      return request(fillTemplate(config.restartPath, { namespace, pod }), {
        method: config.restartMethod,
        body,
      }).then(redactSensitiveData);
    },
  };
}
