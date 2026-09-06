#!/usr/bin/env bash
#
# Customer Zero — Sprint 5.
#
# Crea un sender fake, una plantilla y una secuencia de 3 emails en
# el CRM en producción. Después inscribe 50 leads sintéticos. El
# worker in-process debería ejecutar la secuencia y dejarla
# registrada en message_events.
#
# Requisitos:
#   - API_BASE_URL:  por defecto https://departify-crm-production.up.railway.app
#   - DEMO_EMAIL:    demo@departify.app (override si quieres)
#   - DEMO_PASSWORD: departify-demo-2026 (override si quieres)
#
# Uso:
#   ./scripts/customer-zero-email.sh
#
# El script es idempotente: si el sender/plantilla/secuencia ya
# existen, los reutiliza por nombre.

set -euo pipefail

API_BASE_URL="${API_BASE_URL:-https://departify-crm-production.up.railway.app}"
DEMO_EMAIL="${DEMO_EMAIL:-demo@departify.app}"
DEMO_PASSWORD="${DEMO_PASSWORD:-departify-demo-2026}"
COOKIE_JAR="$(mktemp -t cz-cookies.XXXXXX)"
LEADS_TMP="$(mktemp -t cz-leads.XXXXXX.json)"

cleanup() {
  rm -f "$COOKIE_JAR" "$LEADS_TMP"
}
trap cleanup EXIT

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$*"; }
fail() { printf "  \033[31m✗\033[0m %s\n" "$*"; exit 1; }

api() {
  local method="$1"; shift
  local path="$1"; shift
  local body="${1:-}"
  local args=(
    -sS -X "$method"
    -b "$COOKIE_JAR" -c "$COOKIE_JAR"
    -H 'content-type: application/json'
    -H 'accept: application/json'
    "$API_BASE_URL$path"
  )
  if [[ -n "$body" ]]; then
    args+=(--data-raw "$body")
  fi
  curl "${args[@]}"
}

bold "1) Login como $DEMO_EMAIL"
login_res=$(api POST /api/v1/auth/login "{\"email\":\"$DEMO_EMAIL\",\"password\":\"$DEMO_PASSWORD\"}")
ok "login OK"

bold "2) Crear o reutilizar sender fake"
senders_json=$(api GET /api/v1/email/senders)
sender_id=$(printf '%s' "$senders_json" | python3 -c '
import json, sys
d = json.load(sys.stdin)
for s in d:
  if s.get("provider") == "fake" and s.get("email") == "noreply@departify.app":
    print(s["id"]); break
')
if [[ -n "$sender_id" ]]; then
  ok "sender fake ya existe: $sender_id"
else
  sender_id=$(api POST /api/v1/email/senders '{
    "provider":"fake",
    "name":"DEPARTIFY (customer zero)",
    "email":"noreply@departify.app",
    "dailyLimit":1000,
    "credentials":{"apiKey":"customer-zero-placeholder"}
  }' | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
  ok "sender fake creado: $sender_id"
fi

bold "3) Crear o reutilizar plantilla"
tpl_id=$(api GET /api/v1/email/templates | python3 -c '
import json, sys
d = json.load(sys.stdin)
for t in d:
  if t.get("name") == "Customer Zero · Bienvenida":
    print(t["id"]); break
')
if [[ -n "$tpl_id" ]]; then
  ok "plantilla ya existe: $tpl_id"
else
  tpl_id=$(api POST /api/v1/email/templates "$(cat <<EOF
{
  "name": "Customer Zero · Bienvenida",
  "subject": "Hola {{contact.first_name}}, probando DEPARTIFY",
  "body": "Hola {{contact.first_name}},\n\nEsto es un email de prueba de la primera secuencia automatizada. Si lo recibes, el worker está vivo.\n\nUn saludo,\n{{organization.name}}",
  "senderId": "$sender_id"
}
EOF
)" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
  ok "plantilla creada: $tpl_id"
fi

bold "4) Crear o reutilizar secuencia de 3 emails"
seq_id=$(api GET /api/v1/email/sequences | python3 -c '
import json, sys
d = json.load(sys.stdin)
for s in d:
  if s.get("name") == "Customer Zero · Secuencia 3 emails":
    print(s["id"]); break
')
if [[ -n "$seq_id" ]]; then
  ok "secuencia ya existe: $seq_id"
else
  seq_id=$(api POST /api/v1/email/sequences "$(cat <<EOF
{
  "name": "Customer Zero · Secuencia 3 emails",
  "senderId": "$sender_id",
  "timezone": "Europe/Madrid",
  "sendingWindowStart": "00:00",
  "sendingWindowEnd": "23:59",
  "steps": [
    {"kind":"email","templateId":"$tpl_id","senderId":"$sender_id"},
    {"kind":"wait","waitDays":1},
    {"kind":"email","templateId":"$tpl_id","senderId":"$sender_id"},
    {"kind":"wait","waitDays":2},
    {"kind":"email","templateId":"$tpl_id","senderId":"$sender_id"}
  ]
}
EOF
)" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
  ok "secuencia creada: $seq_id"
fi

bold "5) Crear 50 leads sintéticos"
# Re-use contacts if they already exist (matched by email). For new ones,
# create them and enroll.
N=50
created=0
reused=0
enrolled=0
already=0
errors=0
> "$LEADS_TMP"
for i in $(seq 1 $N); do
  email="cz-lead-$(printf '%03d' "$i")@departify-cz.test"
  full_name="Lead Customer Zero $i"
  first_name="Lead$i"

  # Try to find the contact first.
  existing=$(api GET "/api/v1/contacts?search=$email" | python3 -c "
import json, sys
d = json.load(sys.stdin)
items = d.get('items', d) if isinstance(d, dict) else d
for c in items:
  if c.get('email') == '$email':
    print(c['id']); break
")
  if [[ -n "$existing" ]]; then
    contact_id="$existing"; reused=$((reused+1))
  else
    contact_id=$(api POST /api/v1/contacts "{
      \"fullName\":\"$full_name\",
      \"email\":\"$email\",
      \"firstName\":\"$first_name\"
    }" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))' 2>/dev/null || echo "")
    if [[ -n "$contact_id" ]]; then
      created=$((created+1))
    else
      warn "no se pudo crear contacto $email"
      errors=$((errors+1))
      continue
    fi
  fi
  printf '%s\n' "$contact_id" >> "$LEADS_TMP"
done
ok "leads: $created creados, $reused reusados, $errors errores"

bold "6) Inscribir los 50 leads en la secuencia"
while IFS= read -r contact_id; do
  [[ -z "$contact_id" ]] && continue
  enroll_res=$(api POST "/api/v1/email/sequences/$seq_id/enrollments" "{\"contactId\":\"$contact_id\"}")
  code=$(printf '%s' "$enroll_res" | python3 -c '
import json, sys
try:
  d = json.loads(sys.stdin.read() or "{}")
except Exception:
  print("parse_error"); sys.exit(0)
print("alreadyEnrolled" if d.get("alreadyEnrolled") else "reEnrolled" if d.get("reEnrolled") else "enrolled" if d.get("id") else "unknown")
')
  case "$code" in
    enrolled) enrolled=$((enrolled+1));;
    alreadyEnrolled) already=$((already+1));;
    reEnrolled) enrolled=$((enrolled+1));;
    *) warn "enroll falló para $contact_id: $enroll_res"; errors=$((errors+1));;
  esac
done < "$LEADS_TMP"
ok "enroll: $enrolled nuevos, $already ya inscritos, $errors errores"

bold "7) Snapshot del estado de la secuencia"
api GET "/api/v1/email/sequences/$seq_id/enrollments" > /tmp/cz-enrollments.json
status_summary=$(python3 - <<'PY'
import json
d = json.load(open("/tmp/cz-enrollments.json"))
by_status = {}
for e in d:
  by_status[e["status"]] = by_status.get(e["status"], 0) + 1
print(", ".join(f"{k}={v}" for k, v in sorted(by_status.items())))
PY
)
ok "estado enrollments: $status_summary"

bold "8) Resumen"
echo "  sender:    $sender_id"
echo "  plantilla: $tpl_id"
echo "  secuencia: $seq_id"
echo "  leads:     $created nuevos, $reused reusados"
echo "  inscritos: $enrolled nuevos, $already ya"
echo ""
ok "Customer Zero Sprint 5 listo."
echo ""
echo "Próximos pasos:"
echo "  • Espera ~1 minuto y vuelve a correr este script para ver cómo"
echo "    el worker avanza los enrollments (sent, advanced, completed)."
echo "  • Revisa la UI: https://departify-crm-production.up.railway.app/email/sequences/$seq_id"
