{{- define "mta.name" -}}manual-test-agent{{- end -}}
{{- define "mta.fullname" -}}{{ .Release.Name }}-mta{{- end -}}
{{- define "mta.labels" -}}
app.kubernetes.io/name: {{ include "mta.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}
{{- define "mta.selector" -}}
app.kubernetes.io/name: {{ include "mta.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}
{{- define "mta.image" -}}
{{ required "image.repository is required" .Values.image.repository }}:{{ required "image.tag is required" .Values.image.tag }}
{{- end -}}

{{- define "mta.containerSecurity" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
runAsNonRoot: true
capabilities:
  drop: ['ALL']
{{- end -}}

{{/* args: dict "root" $ "component" "api" */}}
{{- define "mta.envFrom" -}}
- configMapRef:
    name: {{ include "mta.fullname" .root }}
{{- if .root.Values.keyVault.enabled }}
- secretRef:
    name: {{ include "mta.fullname" .root }}-{{ .component }}-secrets
{{- end }}
{{- end -}}

{{- define "mta.csiVolume" -}}
{{- if .root.Values.keyVault.enabled }}
- name: secrets-store
  csi:
    driver: secrets-store.csi.k8s.io
    readOnly: true
    volumeAttributes:
      secretProviderClass: {{ include "mta.fullname" .root }}-kv-{{ .component }}
{{- end }}
{{- end -}}

{{- define "mta.csiMount" -}}
{{- if .Values.keyVault.enabled }}
- name: secrets-store
  mountPath: /mnt/secrets
  readOnly: true
{{- end }}
{{- end -}}
