# Flappy Bird 🐤

Ein Flappy-Bird-Klon für den Browser – gebaut für mobile Geräte. Kein Build-Schritt,
keine Abhängigkeiten, keine externen Assets: Grafik wird auf einem `<canvas>`
gezeichnet, Sounds werden per WebAudio synthetisiert.

## Spielen

`index.html` einfach im Browser öffnen. Für den Offline-Modus (Service Worker) muss
die Seite über HTTP ausgeliefert werden:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

Auf dem Handy: Seite öffnen und über „Zum Home-Bildschirm hinzufügen" als App
installieren – sie startet dann im Vollbild und läuft auch ohne Netz.

## Steuerung

| Aktion | Mobil | Desktop |
| --- | --- | --- |
| Flattern / Starten / Neustart | Tippen | `Leertaste`, `↑` oder `Enter` |
| Pause | App verlassen | `P` oder `Esc` |
| Ton an/aus | Lautsprecher-Symbol oben rechts | `M` |

## Features

- **Mobile first** – Vollbild, Touch-Steuerung, kein Scrollen/Zoomen/Textauswahl,
  Vibration beim Absturz.
- **Auflösungsunabhängig** – gerendert wird in einer virtuellen 288px-breiten Welt,
  deren Höhe sich dem Seitenverhältnis des Geräts anpasst; skaliert scharf über
  `devicePixelRatio`.
- **Feste Physik-Schrittweite** (1/60 s) – gleiches Spielgefühl auf 60-, 90- und
  120-Hz-Displays.
- **Highscore** in `localStorage`, plus Medaillen ab 10 / 20 / 30 / 40 Punkten.
- **Pause statt Game Over**, wenn der Tab in den Hintergrund geht – der Lauf
  bleibt erhalten.
- **PWA** – installierbar und offline spielbar über `manifest.webmanifest` + `sw.js`.

## Dateien

| Datei | Inhalt |
| --- | --- |
| `index.html` | Seitengerüst, Viewport-/Touch-Setup |
| `game.js` | komplette Spiellogik, Rendering und Sound |
| `manifest.webmanifest` | PWA-Metadaten |
| `sw.js` | Service Worker (Offline-Cache) |
| `icon.svg` | App-Icon |

## Balancing

Die Spielwerte stehen als Konstanten oben in `game.js` (pro 1/60-s-Schritt):

```js
const GRAVITY  = 0.40;   // Fallbeschleunigung
const FLAP_V   = -6.9;   // Impuls pro Tap
const PIPE_GAP = 132;    // Lücke zwischen den Röhren
const PIPE_DX  = 190;    // Abstand zwischen den Röhrenpaaren
const SPEED    = 2.35;   // Scrollgeschwindigkeit
```

Auf hohen Displays wird die Höhendifferenz zweier aufeinanderfolgender Lücken auf
`reach` (150px) begrenzt, damit kein Sprung entsteht, den der Vogel nicht schafft.
