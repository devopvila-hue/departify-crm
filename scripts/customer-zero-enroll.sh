#!/usr/bin/env bash
#
# Customer Zero — Fase 2: bulk enroll 50 leads en la secuencia de Sprint 5.
#
# Asume que el sender/plantilla/secuencia ya existen (los crea
# customer-zero-email.sh). Genera los ids de leads vía búsqueda y los
# inscribe con llamadas paralelas.
#
# Uso: ./scripts/customer-zero-enroll.sh [N]  (default 50)

set -euo pipefail

API_BASE_URL="${API_BASE_URL:-https://departify-crm-production.up.railway.app}"
DEMO_EMAIL="${DEMO_EMAIL:-demo@departify.app}"
DEMO_PASSWORD="${DEMO_PASSWORD:-departify-demo-2026}"
N="${1:-50}"
COOKIE_JAR="/tmp/cz-cookies-$$"
PARALLEL=10

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }

bold "1) Login"
curl -sS -X POST -c "$COOKIE_JAR" -b "$COOKIE_JAR" -H "content-type: application/json" \
  -d "{\"email\":\"$DEMO_EMAIL\",\"password\":\"$DEMO_PASSWORD\"}" \
  "$API_BASE_URL/api/v1/auth/login" > /dev/null
ok "login OK"

bold "2) Localizar secuencia Customer Zero"
seq_id=$(curl -sS -b "$COOKIE_JAR" "$API_BASE_URL/api/v1/email/sequences" | \
  python3 -c 'import json,sys
for s in json.load(sys.stdin):
  if s.get("name") == "Customer Zero · Secuencia 3 emails":
    print(s["id"]); break')
[[ -n "$seq_id" ]] || { echo "no se encontró la secuencia, ejecuta customer-zero-email.sh primero"; exit 1; }
ok "secuencia: $seq_id"

bold "3) Localizar o crear $N leads"
created=0
reused=0
errors=0

create_one() {
  local i="$1"
  local email="cz-lead-$(printf '%03d' "$i")@departify-cz.test"
  local full_name="Lead Customer Zero $i"
  local first_name="Lead$i"
  local existing
  existing=$(curl -sS -b "$COOKIE_JAR" "$API_BASE_URL/api/v1/contacts?search=$email" | \
    python3 -c "
import json, sys
d = json.load(sys.stdin)
items = d.get('items', d) if isinstance(d, dict) else d
for c in items:
  if c.get('email') == '$email':
    print(c['id']); break
")
  if [[ -n "$existing" ]]; then
    echo "REUSED $existing"
    return
  fi
  local id
  id=$(curl -sS -X POST -b "$COOKIE_JAR" -H "content-type: application/json" \
    -d "{\"fullName\":\"$full_name\",\"email\":\"$email\",\"firstName\":\"$first_name\"}" \
    "$API_BASE_URL/api/v1/contacts" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("id",""))')
  if [[ -n "$id" ]]; then
    echo "CREATED $id"
  else
    echo "ERROR $email"
  fi
}
export -f create_one

> /tmp/cz-ids-$$
seq 1 "$N" | xargs -P "$PARALLEL" -I {} bash -c 'create_one "$@"' _ {} > /tmp/cz-ids-$$
awk '{print $2}' /tmp/cz-ids-$$ | grep -v '^$' > /tmp/cz-ids-clean-$$
mv /tmp/cz-ids-clean-$$ /tmp/cz-ids-$$
total=$(wc -l < /tmp/cz-ids-$$ | tr -d ' ')
created=$(grep -c "^CREATED" /tmp/cz-ids-$$ || true)
reused=$(grep -c "^REUSED" /tmp/cz-ids-$$ || true)
errors=$(grep -c "^ERROR" /tmp/cz-ids-$$ || true)
ok "$total leads (created=$created reused=$reused errors=$errors)"

bold "4) Inscribir todos en paralelo"
enrolled=0
already=0
reenrolled=0
errs=0
export seq_id

enroll_one() {
  local id="$1"
  local res
  res=$(curl -sS -X POST -b "$COOKIE_JAR" -H "content-type: application/json" \
    -d "{\"contactId\":\"$id\"}" \
    "$API_BASE_URL/api/v1/email/sequences/$seq_id/enrollments")
  echo "$res" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read() or "{}")
if d.get("alreadyEnrolled"): print("ALREADY")
elif d.get("reEnrolled"): print("REENROLLED")
elif d.get("id"): print("OK")
else: print("ERR")
'
}
export -f enroll_one

cat /tmp/cz-ids-$$ | xargs -P "$PARALLEL" -I {} bash -c 'enroll_one "$@"' _ {} > /tmp/cz-enroll-$$
enrolled=$(grep -c "^OK" /tmp/cz-enroll-$$ || true)
reenrolled=$(grep -c "^REENROLLED" /tmp/cz-enroll-$$ || true)
already=$(grep -c "^ALREADY" /tmp/cz-enroll-$$ || true)
errs=$(grep -c "^ERR" /tmp/cz-enroll-$$ || true)
ok "inscripciones: ok=$enrolled reEnrolled=$reenrolled already=$already errors=$errs"

bold "5) Estado actual de la secuencia"
sleep 3
status_summary=$(curl -sS -b "$COOKIE_JAR" "$API_BASE_URL/api/v1/email/sequences/$seq_id/enrollments" | \
  python3 -c "
import json, sys
from collections import Counter
d = json.load(sys.stdin)
print(', '.join(f'{k}={v}' for k, v in sorted(Counter(e['status'] for e in d).items())))
")
ok "estado: $status_summary"

bold "6) Distribución de paso (currentStep)"
step_summary=$(curl -sS -b "$COOKIE_JAR" "$API_BASE_URL/api/v1/email/sequences/$seq_id/enrollments" | \
  python3 -c "
import json, sys
from collections import Counter
d = json.load(sys.stdin)
print(', '.join(f'step{k}={v}' for k, v in sorted(Counter(e.get('currentStep') for e in d).items())))
")
ok "$step_summary"

echo
ok "Customer Zero listo."
echo "  https://departify-crm-production.up.railway.app/email/sequences/$seq_id"

rm -f "$COOKIE_JAR" /tmp/cz-ids-$$ /tmp/cz-enroll-$$
