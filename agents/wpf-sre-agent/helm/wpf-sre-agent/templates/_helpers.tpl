{{- define "sre.name" -}}wpf-sre-agent{{- end -}}
{{- define "sre.labels" -}}
app.kubernetes.io/name: {{ include "sre.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}
{{- define "sre.serviceAccount" -}}
{{- if .Values.serviceAccount.name -}}{{ .Values.serviceAccount.name }}{{- else -}}{{ include "sre.name" . }}{{- end -}}
{{- end -}}
