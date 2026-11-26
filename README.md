# Pokélingo 🟢

Pokémon-Namen generationsweise lernen – im Stil von Duolingo.
Alle 1025 Pokémon (Gen 1–9) mit deutschem & englischem Namen, Typen, Dex-Nummer und Bild
(Daten & Bilder: [PokéWiki](https://www.pokewiki.de/Pok%C3%A9mon-Liste)).

Reine statische Web-App (HTML/CSS/JS, kein Build, kein Server, keine Abhängigkeiten).
Funktioniert am Handy als installierbare App (PWA) und offline.

## Lernprinzip

| Methode | Umsetzung in der App |
|---|---|
| **Chunking** | Jede Generation ist ein Lernpfad aus Lektionen à ~6 Pokémon in Dex-Reihenfolge (Entwicklungsreihen bleiben zusammen). |
| **Aktives Abrufen** (Testing Effect) | Pro Lektion steigt die Schwierigkeit: Bild→Name wählen → Name→Bild wählen → Buchstaben-Kacheln / Silhouette → Namen frei tippen. |
| **Spaced Repetition** | Leitner-System mit 7 Stufen (1, 2, 4, 8, 16, 35, 90 Tage). Richtig = Stufe hoch, falsch = Stufe halbiert. „Wiederholen“ zeigt nur Fälliges. |
| **Interleaving** | Checkpoints nach je 4 Lektionen mischen alles; Ablenker sind bewusst ähnliche Pokémon (gleicher Typ / Anfangsbuchstabe). |
| **Sofortiges Feedback & Fehlerschleife** | Falsche Antworten kommen in der Lektion 3–5 Aufgaben später nochmal (leichter). |
| **Dual Coding** | Bild + Name + Typ + Aussprache (Sprachausgabe). |
| **Elaboration** | Eigenes Eselsbrücken-Feld pro Pokémon (z. B. *Bisa-SAM* = Samen). |
| **Motivation** | XP, Tagesziel, Streak, Combo, 60-Sekunden-Blitzrunde mit Rekord. |

Weitere Modi pro Generation: **Schwächen** (höchste Fehlerquote), **Meisterprüfung** (alle gelernten tippen), gesperrte Lektionen per Test überspringen.
Einstellungen: abgefragte Sprache (DE / EN / beide inkl. Übersetzungsaufgaben), Tippen an/aus, Tagesziel, Design.
Fortschritt liegt im `localStorage` des Browsers und lässt sich als JSON sichern/laden.

## Lokal starten

```bash
python3 -m http.server 8000
```

Dann <http://localhost:8000> öffnen. (Direkt `index.html` doppelklicken geht auch, dann aber ohne Offline-Modus.)

## Hosten

**GitHub Pages (empfohlen, kostenlos):** Der Workflow `.github/workflows/pages.yml` veröffentlicht bei jedem Push auf `main`.
Einmalig: Repo → *Settings → Pages → Source: GitHub Actions*. Danach unter `https://<user>.github.io/pokelingo/` erreichbar.
Bei privatem Repo braucht Pages ein bezahltes GitHub-Konto – Alternative: Netlify / Cloudflare Pages (Ordner einfach hochladen bzw. Repo verbinden, kein Build-Befehl, Ausgabeordner `/`).

Am Handy die Seite öffnen → „Zum Home-Bildschirm hinzufügen“ → läuft wie eine App.

## Daten aktualisieren

```bash
python3 tools/update_data.py --images
```

Pokémon und alle zugehörigen Namen/Bilder © Nintendo / Creatures / GAME FREAK. Privates, nicht-kommerzielles Lernprojekt.
