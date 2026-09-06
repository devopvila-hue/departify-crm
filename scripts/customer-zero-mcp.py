#!/usr/bin/env python3
"""
Customer Zero — Sprint 6.

Conecta al MCP server de DEPARTIFY CRM, lista los 50 leads de
Customer Zero creados en Sprint 5, y los enriquece con un campo
"lead_score" calculado por el LLM a partir de su nombre y email.

Uso:
  LLM_API_KEY=... CRM_BASE_URL=https://departify-crm-production.up.railway.app \\
  CRM_API_KEY=sk_...  python3 scripts/customer-zero-mcp.py [--limit N]

Requiere:
  - requests (pip install requests)
  - LLM_API_KEY de MiniMax (u otro Anthropic-compatible)
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

CRM_BASE_URL = os.environ.get("CRM_BASE_URL", "https://departify-crm-production.up.railway.app").rstrip("/")
CRM_API_KEY = os.environ.get("CRM_API_KEY", "")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.minimax.io/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "MiniMax-M3")


def mcp_call(token: str, method: str, params: dict, session_id: str | None) -> tuple[dict, str | None]:
    body = json.dumps({"jsonrpc": "2.0", "id": int(time.time() * 1000), "method": method, "params": params}).encode()
    headers = {
        "content-type": "application/json",
        "accept": "application/json, text/event-stream",
        "authorization": f"Bearer {token}",
    }
    if session_id:
        headers["mcp-session-id"] = session_id
    req = urllib.request.Request(f"{CRM_BASE_URL}/mcp", data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        new_sid = resp.headers.get("mcp-session-id") or session_id
        text = resp.read().decode()
        try:
            return json.loads(text), new_sid
        except json.JSONDecodeError:
            # SSE format: "event: message\ndata: <json>\n\n"
            for line in text.splitlines():
                if line.startswith("data: "):
                    return json.loads(line[6:]), new_sid
            raise


def llm_score_contact(name: str, email: str) -> dict:
    """Ask the LLM to score a Customer Zero lead. Returns a dict with score + reason."""
    if not LLM_API_KEY:
        return {"score": None, "reason": "LLM_API_KEY not set; skipped"}
    body = {
        "model": LLM_MODEL,
        "max_tokens": 256,
        "system": (
            "Eres un asistente de CRM. Te paso el nombre y email de un lead de prueba "
            "y debes devolver SOLO un JSON con dos campos: score (entero 0-100, qué tan "
            "calificado parece el lead) y reason (string corto explicando el score en español)."
        ),
        "messages": [
            {"role": "user", "content": f"Nombre: {name}\nEmail: {email}"},
        ],
    }
    req = urllib.request.Request(
        f"{LLM_BASE_URL}/v1/messages",
        data=json.dumps(body).encode(),
        headers={
            "content-type": "application/json",
            "x-api-key": LLM_API_KEY,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode())
            text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
            # Naive JSON extraction: look for the first {...} block.
            start = text.find("{")
            end = text.rfind("}")
            if start != -1 and end > start:
                return json.loads(text[start : end + 1])
            return {"score": None, "reason": text[:200] or "no JSON in response"}
    except (urllib.error.HTTPError, urllib.error.URLError) as e:
        return {"score": None, "reason": f"LLM error: {e}"}


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=10, help="Max contacts to enrich (default 10).")
    p.add_argument("--search", default="cz-lead-", help="Contact search prefix (default cz-lead-).")
    args = p.parse_args()

    if not CRM_API_KEY:
        print("ERROR: define CRM_API_KEY (un API key del CRM).", file=sys.stderr)
        return 1

    print(f"→ Conectando a {CRM_BASE_URL}/mcp ...")
    init, sid = mcp_call(CRM_API_KEY, "initialize", {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "customer-zero-mcp", "version": "0.1.0"},
    }, None)
    print(f"  initialize ok, session={sid!r}")

    # Send the "initialized" notification.
    mcp_call(CRM_API_KEY, "notifications/initialized", {}, sid)

    # 1) tools/list
    r, _ = mcp_call(CRM_API_KEY, "tools/list", {}, sid)
    names = sorted(t["name"] for t in r["result"]["tools"])
    print(f"  {len(names)} tools: {', '.join(names[:8])}, ...")

    # 2) list_contacts (filtered to Customer Zero leads)
    r, _ = mcp_call(CRM_API_KEY, "tools/call", {
        "name": "list_contacts",
        "arguments": {"search": args.search, "pageSize": 50},
    }, sid)
    items = json.loads(r["result"]["content"][0]["text"])["items"]
    print(f"  {len(items)} contactos con prefijo '{args.search}'")

    # 3) Enrich the first N with the LLM.
    enriched = 0
    for c in items[: args.limit]:
        result = llm_score_contact(c.get("fullName", ""), c.get("email", ""))
        score = result.get("score")
        reason = result.get("reason")
        if score is None:
            print(f"  {c['id']} {c.get('email',''):40s} → sin score: {reason}")
            continue
        # Write the score back as a custom value via update_contact.
        update, _ = mcp_call(CRM_API_KEY, "tools/call", {
            "name": "update_contact",
            "arguments": {
                "id": c["id"],
                "patch": {"jobTitle": f"lead_score={score}"},
            },
        }, sid)
        ok = "ok" in update["result"]["content"][0]["text"]
        print(f"  {c['id']} {c.get('email',''):40s} → score={score:>3}  {('✓' if ok else '✗')}  ({reason})")
        if ok:
            enriched += 1

    print()
    print(f"Customer Zero Sprint 6: {enriched} leads enriquecidos via MCP + LLM.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
