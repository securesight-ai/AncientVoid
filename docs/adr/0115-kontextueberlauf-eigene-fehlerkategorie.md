# ADR-0115: Kontextüberlauf ist eine eigene Fehlerkategorie — keine Anmeldefrage

Status: akzeptiert (2026-11-23). **Erweitert ADR-0015** (Provider-Fehler in
handhabbaren Worten). Referenz: BUG-0265.

## Kontext

ADR-0015 klassifiziert Provider-Pleiten per Textprüfung über das, was die CLI
gedruckt hat: `quota`, `rate_limit`, `auth`, `network`, `server`, `unknown`.
Die `auth`-Regel war zu gierig:

    /\b40[13]\b|unauthori[sz]ed|forbidden|invalid.*(api.?key|token)|authentication|…/i

`invalid.*(api.?key|token)` überbrückt den **ganzen** Text. Damit rutscht jede
Meldung, in der „invalid" und irgendein „token" vorkommt, in die
Anmeldungs-Schublade — obwohl dort nichts anzumelden ist.

Gemessen 2026-11-23, Sitzung `943797b3-a698-454d-a096-4e42fdab782a`
(„Garmin GTA VI", Adapter `pi`, Modell `strata/qwen3.8-flash-next-iq3_s`), vier
mal derselbe Rohfehler:

    seq 3969  06:40:05Z  400: {"type":"invalid_request_error","message":
      "request exceeds the context window: prompt (237428 tokens) leaves no
       room to answer in the context (204800); requests are never truncated"}
    seq 4975  07:33:31Z  prompt (204827 tokens) — gleiche Meldung
    seq 5777  08:37:54Z  prompt (204963 tokens) — gleiche Meldung
    seq 6547  10:05:19Z  prompt (205319 tokens) — gleiche Meldung

Alle vier landeten als `category: "auth"`, im Chat als
**„Anmeldung beim Provider fehlgeschlagen — Die CLI ist nicht (mehr)
angemeldet oder der Schlüssel ist ungültig. Am PC neu anmelden."** Kais
worktrees waren zu diesem Zeitpunkt völlig korrekt angemeldet (dieselbe
Pi-Instanz hat in einer anderen Session weitergearbeitet). Der Hinweis war
nicht nur nutzlos, er hat die eigentliche Ursache verdeckt: der Verlauf dieser
Sitzung war größer als das Modell fasst.

## Entscheidung

1. **Neue Kategorie `context`** in `ProviderErrorCategory` (Contracts). Sie wird
   **vor** `quota`/`auth` geprüft, weil Kontextmeldungen regelmäßig Wörter aus
   anderen Kategorien enthalten („usage", „invalid", „token").
2. **Erkennung** (`CONTEXT_RE`): `exceeds the context window`,
   `context_length_exceeded`, `context length is`, `maximum context`,
   `prompt is too long`, `input is too long` plus deutsche Formen.
3. **Der Text nennt die Zahlen aus der Meldung** (gebrauchte Tokens und
   Grenze, führender HTTP-Status wird verworfen) und sagt, was hilft:
   Übergabe in eine neue Session oder ein Modell mit größerem Kontext — und
   ausdrücklich: An-/Abmeldung hilft hier nicht.
4. **`auth` wird scharf gemacht**: `invalid.{0,24}?(api.?key|token|credential)`
   statt `invalid.*(api.?key|token)`. Echte Anmeldefehler bleiben `auth`
   (`401 Unauthorized`, `invalid api key`, `not logged in`, `authentication`).
5. **„Weiter" ist hier keine Heilung.** `context` löst bewusst keine
   Automatik-Fortsetzung aus (`InterruptedBanner.limitFailure` prüft weiter nur
   `quota`/`rate_limit`); das Banner bietet die vorhandene Übergabe an.

## Folgen

- Der Ereignis-Payload `provider.error` kann `category: "context"` tragen —
  Abwärtskompatibilität: unbekannte Kategorien fallen in `providerFailureOf`
  auf `unknown` zurück, ältere Clients zeigen also den (richtigen) Klartext,
  nur ohne eigenen Zweig.
- Adapter müssen nichts ändern: die Klassifizierung sitzt zentral in
  `providerErrorEvent()` (ADR-0015), alle Adapter rufen sie.
- Der Rutsch ist **kein Einzelfall**: jede Provider-Meldung mit „invalid …"
  und späterem „token" war bisher eine vorgetäuschte Anmeldepleite — dazu
  zählen OpenAI-Formulierungen wie `maximum context length is … tokens`.
