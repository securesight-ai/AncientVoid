# K2-Stichprobe — Session-Tail nach i18n

23.11.2026 · Arch Linux · AMD Ryzen 7 5800X · Node 26.12.0 ·
Playwright Chromium Headless 159.0.8154.6. Produktstand `2a7eab27`
mit lokalem Arbeitsdiff. Dummy-Adapter, kein LLM. Der Desktop-Spec misst
30 Events/s an der derzeitigen PWA mit dem kompakten Lesepreset.

```bash
npx --no-install playwright test e2e/specs/appearance-presets.spec.ts --project=desktop --grep '30 Events/s' --workers=1
```

| Runde | Events | Gematchte Events | Event → DOM p95 / Maximum (ms) |
|---|---:|---:|---:|
| 1 | 64 | 64 | 33 / 35 |
| 2 | 64 | 64 | 34 / 34 |
| 3 | 65 | 64 | 34 / 44 |

Alle drei Runden lagen unter dem Spec-Budget von 200 ms. Die einzelnen
p95-Werte streuen von 33 bis 34 ms. Der Animationsframe-Abstand blieb in
allen drei Runden bei rund 16,7 ms p95.

## Was das nicht sagt

Der Lauf ist eine Stichprobe am aktuellen Stand mit deutschem Fixture.
Der Vergleich mit dem Stand vor P61 und der vollständige K2-Langlauf sind
damit noch unbelegt.
