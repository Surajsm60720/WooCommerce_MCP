{{- define "mcp-platform.name" -}}
mcp-platform
{{- end -}}

{{- define "mcp-platform.labels" -}}
app.kubernetes.io/name: {{ include "mcp-platform.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}
