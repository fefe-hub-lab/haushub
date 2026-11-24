# HausHub – Zählerstände-App

Offline-Web-App (PWA) für Android. Sie erfasst Zählerstände für Strom, Gas, Wasser, PV usw. und wertet sie aus.
Es wird **kein Server** benötigt. Alle Daten bleiben auf dem Handy.

## 1. Einmalig online stellen (kostenlos über GitHub Pages)

1. Auf https://github.com ein kostenloses Konto anlegen.
2. Oben rechts **„+“ → „New repository“** wählen. Name z. B. `haushub`, Sichtbarkeit **Public**, dann „Create repository“.
3. Auf **„uploading an existing file“** klicken und **alle Dateien aus diesem ZIP** hineinziehen (inkl. Ordner `icons`). Danach „Commit changes“.
4. **Settings → Pages** öffnen und unter „Branch“ `main` und `/ (root)` wählen, dann „Save“.
5. Nach 1–2 Minuten läuft die App unter `https://<benutzername>.github.io/haushub/`.

> Über diese Adresse werden nur die Programmdateien ausgeliefert. Die Zählerstände gehen nie ins Internet.

## 2. Auf dem Android-Handy installieren

1. Die Adresse in **Chrome** öffnen.
2. Auf **„Installieren“** im Hinweis der App tippen oder im Chrome-Menü **⋮ → „App installieren“ / „Zum Startbildschirm hinzufügen“** wählen.
3. HausHub erscheint danach als App-Icon. Ab jetzt immer über das Icon starten, die App funktioniert auch ohne Internet.
4. Unter **Daten → „Dauerhafter Speicher“** prüfen, ob „aktiv“ angezeigt wird. Falls nicht, auf „Anfordern“ tippen.

**Wichtig:** Nicht im Inkognito-Modus verwenden. Außerdem darf man in Chrome die **Website-Daten nicht löschen**, sonst sind die Daten weg (siehe Datensicherung).

## 3. Benutzung

- **Zähler anlegen** im Tab „Zähler“. Es gibt Vorlagen für Strom, Gas, Wasser, Warmwasser und PV-Anlage sowie eigene Zähler.
  Optional lassen sich ein Tarif (Arbeitspreis, Grundpreis) und bei Gas der Umrechnungsfaktor m³ → kWh von der Gasrechnung hinterlegen.
- **Ablesen** über den mittleren ＋-Knopf. Nach dem Speichern springt die App automatisch zum nächsten Zähler (Ablese-Runde).
  Zu jeder Ablesung kann ein Foto vom Zähler gespeichert werden.
- **Plausibilitätsprüfung:** Die App warnt, wenn ein Stand kleiner ist als vorher, wenn der Verbrauch ungewöhnlich hoch ist oder wenn das Datum in der Zukunft liegt.
- **Zählertausch:** Beim Ablesen „Zählertausch“ anhaken. Dann den Endstand des alten und den Anfangsstand des neuen Zählers eintragen; der Verbrauch läuft korrekt weiter.
- **Auswertung:** Monatsverbrauch als Diagramm mit Vorjahresvergleich, Jahreswerte, Prognose für das laufende Jahr und Kosten.
  Mit PV-Erzeugungs- und Einspeisezähler zusätzlich Eigenverbrauch und Autarkiegrad.
  Liegen Ablesungen nicht genau am Monatsende, wird der Verbrauch dazwischen linear auf die Tage verteilt.
- **Erinnerung zum Ablesen:** Unter „Daten“ einen monatlichen Termin in den Google Kalender eintragen. Außerdem zeigen die Zählerkarten „Ablesung fällig“ an.

## 4. Datensicherung – bitte regelmäßig!

Die Daten liegen nur auf dem Handy. Bei Verlust des Handys, beim Zurücksetzen oder wenn die Browserdaten gelöscht werden, sind sie sonst weg.

- **Daten → „Backup erstellen & teilen“** öffnet das Android-Teilen-Menü. Dort z. B. **Google Drive**, eine E-Mail an sich selbst oder WhatsApp/Signal „an mich“ wählen.
- Alternativ **„Backup als Datei herunterladen“**. Die Datei landet im Ordner „Downloads“.
- Die App erinnert mit einem gelben Hinweis, wenn länger nicht gesichert wurde (Standard: 30 Tage, einstellbar).
- **Wiederherstellen** (z. B. auf einem neuen Handy): App installieren, dann **Daten → „Backup wiederherstellen“** und die Backup-Datei auswählen.
  - *Alles ersetzen*: übernimmt genau den Stand des Backups.
  - *Zusammenführen*: ergänzt fehlende Einträge.
- Die Backup-Datei (`HausHub-Backup-JJJJ-MM-TT_HHMM.json`) ist eine lesbare JSON-Datei. Fotos sind darin eingebettet (abschaltbar).
- Zusätzlich gibt es den **CSV-Export für Excel** (Semikolon, deutsches Zahlenformat).

## 5. Updates der App

Geänderte Dateien einfach im GitHub-Repository ersetzen und in `sw.js` die Zeile `const VERSION = 'haushub-v1.0.0';` hochzählen (z. B. `v1.0.1`).
Beim nächsten Öffnen lädt die App die neue Version im Hintergrund. Danach erscheint „Neue Version installiert – Neu laden“.
Die gespeicherten Daten bleiben dabei erhalten.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | Grundgerüst der App |
| `app.js` | gesamte Logik (Datenbank, Berechnungen, Ansichten, Backup) |
| `style.css` | Design (hell/dunkel automatisch) |
| `manifest.json` | macht die Seite installierbar (Name, Icon, Farben) |
| `sw.js` | Service Worker für den Offline-Betrieb |
| `icons/` | App-Icons |
