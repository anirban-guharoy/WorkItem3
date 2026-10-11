export function invalidResourceResponse() {
  return { error: "namespace and pod must be valid Kubernetes resource names" };
}
