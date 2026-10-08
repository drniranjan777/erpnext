{{- define "nextgen.name" -}}{{ .Release.Name }}{{- end -}}

{{- define "nextgen.labels" -}}
app.kubernetes.io/name: nextgen-erp
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "nextgen.env" -}}
- name: NODE_ENV
  value: production
- name: APP_URL
  value: {{ .Values.appUrl | quote }}
- name: DATA_REGION
  value: {{ .Values.dataRegion | quote }}
- name: STORAGE_DIR
  value: /data/storage
{{- end -}}
