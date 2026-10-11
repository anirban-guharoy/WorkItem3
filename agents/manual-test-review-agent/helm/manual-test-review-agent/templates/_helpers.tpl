{{- define "review.name" -}}manual-test-review-agent{{- end -}}
{{- define "review.labels" -}}
app.kubernetes.io/name: {{ include "review.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}
{{- define "review.serviceAccount" -}}
{{- if .Values.serviceAccount.name -}}{{ .Values.serviceAccount.name }}{{- else -}}{{ include "review.name" . }}{{- end -}}
{{- end -}}
