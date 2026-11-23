---
name: ancientvoid-fleet-strecke
description: Debug and extend AncientVoid fleet routing (`/api/hosts/<hostId>/…`) — why peer-hosted sessions fail with 415/403/502, which paths are routable, and how binary uploads must be forwarded. Use for "kann keine Bilder pasten in der Sitzung auf dem anderen Rechner", attachment/media/voice uploads to peers, fleet 415 Unsupported Media Type, or when adding a new fleet-routable endpoint.
---

# Fleet-Strecke `/api/hosts/<hostId>/…`: was durchkommt und was nicht

Ein Hub erreicht gekoppelte Rechner nur über **ausgerechnete Pfade** und das
Kopplungs-Token `fleet:<homeHostId>` — nie Token, WebAuthn, Metrics oder
Fleet-Verwaltung. Erlaubt steht in `packages/contracts/src/fleet/fleet.ts`
(`FLEET_ROUTABLE`, geprüft von `isFleetRoutable`). Neu auf der Erlaubnisliste = bewusster
Pull-Request, weil er Zugriffe auf einen fremden Rechner öffnet.

## Der Fall, der 2026-11-23 aufgefallen ist: 415 beim Bild-Einfügen

Symptom: In einer Sitzung auf einem **anderen** Hub (`#/hosts/<host>/sessions/…`)
landet das eingefügte Bild als Chip „Unsupported Media Type“; auf dem eigenen
Hub funktioniert dasselbe Bild.

Kette: Die PWA lädt host-qualifiziert nach `/api/hosts/<host>/attachments`.
Diese Route fällt in den Catch-all `app.route({ method: [...], url:
"/api/hosts/:hostId/*" })` in `apps/hub/src/modules/fleet/fleet-proxy.ts`.
Dessen Body-Behandlung ist JSON: `forward()` schreibt
`content-type: application/json` und `JSON.stringify(body)`, und die Route kennt
nur den App-weiten JSON-Parser (`apps/hub/src/app.ts`). Für `image/png` gibt es
dort **keinen** Content-Type-Parser → Fastify antwortet **415** in
`preParsing`, die Weiterleitung läuft nie an. Die lokale Attach-Route funktioniert,
weil sie in einem eigenen Scope `addContentTypeParser("*", { parseAs: "buffer" })`
registriert.

Reparatur: eigene, **specific** Route für binäre Uploads im Fleet-Modul
(spezifischer als der Catch-all, find-my-way zieht sie vor):
`app.register(scope => { scope.addContentTypeParser("*", { parseAs: "buffer",
bodyLimit: MAX_ATTACHMENT_BYTES + 1024 }, …); scope.post("/api/hosts/:hostId/attachments", …) })`
mit `forwardRaw()` (Bytes + originales `content-type` + `x-filename`,
Timeout 60 s, Antwortgröße wie sonst gedeckelt).
## 403 „Nicht erlaubt für fleet:<hostId>: PATCH …“ ≠ Kopplung widerrufen

Der Peer-Hub entscheidet selbst, was ein Flotten-Token darf: `operationOf()`
(`apps/hub/src/platform/policy.ts`) bildet Schreibwege **einzeln** auf benannte
Operationen ab; was nicht abgebildet ist, fällt auf den Fail-closed-Fallback
(erlaubt nur, wer `tokens.manage` darf) und wird für `fleet:*` verworfen.
Symptom 2026-11-23: Warteschlange einer fremden Sitzung (`/api/sessions/<id>/queue…`)
hatte kein Mapping → Editieren/Umhängen/Streichen/Jetzt-Senden war verboten,
während Vormerken (`/steer` → `sessions.prompt`, fleet: allow) funktionierte.
Der Proxy machte daraus 502 „lehnt den Zugriff ab (Kopplung widerrufen?)“ — eine
Vermutung, die in die Irre führte. Heute: `sessions.queue` (Mensch+Flotte allow,
Agent/Display deny), und der Proxy reicht den **Grund des Peers** durch.

Prüfen, ob eine Route ein Mapping hat:

```bash
grep -n "queue\|steer" apps/hub/src/platform/policy.ts
node -e "const {policyFor}=require('@ancientvoid/contracts');console.log(policyFor('sessions.queue','fleet:x'))"
```

Zwei Grenzen, die beide bedient sein wollen:
- **Heim-Hub:** `app.route({ method: [...] })` in `fleet-proxy.ts` muss die
  Methode überhaupt weiterleiten (PATCH fehlte; eine fremde
  Warteschlangen-Änderung konnte den Peer nie erreichen).
- **Peer-Hub:** die Policy-Entscheidung fällt dort. Ein Partner-Hub auf älterem
  Stand lehnt weiter ab, auch nachdem der Heim-Hub aktualisiert ist —
  Flotten-Funktionen brauchen **beide** Hubs auf demselben main.

## Live an einer echten Nutzer-Sitzung testen (Vorsicht)

Die Warteschlangen-Knöpfe wirken auf das **erste** Element der Liste, nicht auf
das zuletzt eigene. Vor jedem Klick Index und Text des Ziel-Eintrags lesen, und
eigene Test-Einträge sofort wieder streichen. Ein versehentliches
✎/✕-Paar löscht eine vorgemerkte Meldung des Nutzers — sie ist danach nirgends
mehr (hard delete). Zu retten war sie nur über freie Seiten in
`data/hub.db` (`strings`/Bytesuche nach dem Text; die Anhang-JSON liegt neben
dem Text), dann mit `POST /api/sessions/<id>/steer`
(`{kind:"prompt", text, attachmentIds:[…], queue:true}`) exakt wieder einreihen.


## Prüfen, ob ein Pfad überhaupt weiterleitbar ist

```bash
node -e "const {isFleetRoutable}=require('@ancientvoid/contracts');console.log(isFleetRoutable('/api/attachments'))"
```
Falsch → Antwort ist **403** `path not routable to other hosts` (nicht 415).
415 = Route gefunden, aber Body-Typ ungeparst. 502 `nicht erreichbar` = Peer
down; 502 `lehnt den Zugriff ab` = Kopplung widerrufen bzw. Peer-Token passt nicht.

## Binär nach oben: was eine Route können muss

- eigener Scope mit `addContentTypeParser("*", { parseAs: "buffer" })` und
  `bodyLimit` aus den Contracts (`MAX_ATTACHMENT_BYTES`), nie raten.
- Body als `Buffer` verlangen, leere Datei **400** bevor etwas losgeschickt wird.
- Originalheader mitgeben: `content-type`, `x-filename` (URI-kodiert).
- Ziel: `hostId === deps.hostId` → `app.inject` gegen die lokale Route; sonst
  `forwardRaw(peer.url + pfad, peer.token, bytes, header)`.
- Eigenes Timeout: Uploads über Tailscale brauchen länger als die 10 s des
  Standard-`forward()` (60 s gemessen sinnvoll); lange LLM-Wege nutzen
  `SLOW_PATHS`/`FORWARD_TIMEOUT_SLOW_MS`.

## Testen mit zwei echten Hubs (kopiert aus fleet-routing.test.ts)

`createHubApp` braucht für Attachments **beides**, sonst fehlt die Route still
und Tests sehen 404 „Route POST:/api/attachments not found“:

```ts
const settings = new SettingsStore(db);
const attachments = new AttachmentStore(db, join(dir, "attachments"));
await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false }, hostId, projectRoots: [], settings, attachments });
```

Paaren: Invite am Peer (`POST /api/fleet/invites`), dann am Home
`POST /api/fleet/peers { url, code }` → 201. Upload testen mit
`app.inject({ method: "POST", url: "/api/hosts/<peer>/attachments", payload: PNG,
headers: { authorization, "content-type": "image/png", "x-filename" } })`,
und **nachweisen, dass der Peer ihn hat**: `GET /api/attachments/<id>/content`
gegen den Peer-App und Bytes vergleichen (`res.rawPayload`).

Bildmaterial: echtes PNG (`base64 -d` eines gültigen 1×1-PNG). Ein kaputtes
Byte-Knäuel wird zu Recht abgelehnt und erzeugt einen Fehltest.
