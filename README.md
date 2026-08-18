# Alexa Smarthome/Skills-Manager für QNAP

Eine lokale Weboberfläche zur Verwaltung und Bereinigung der in Alexa bekannten Smart-Home-Geräte und aktivierten Skills. Sie zeigt Verbindungsquellen, Erreichbarkeit, Namensdubletten und technische IDs und ermöglicht ausdrücklich bestätigte Verwaltungsaktionen.

Die Anwendung steuert keine eigentlichen Smart-Home-Funktionen wie Licht oder Temperatur. Sie kann ausdrücklich ausgewählte Alexa-Einträge entfernen, aktive Skills per Alexa-Befehl deaktivieren und Smart-Home-Einträge in Alexa deaktivieren beziehungsweise wieder aktivieren. Zusammengehörige Matter-Endpunkte werden als ein physisches Gerät behandelt. Aktive und deaktivierte Geräte werden getrennt gezählt und über eigene Kacheln gefiltert. Ein deaktiviertes Gerät erzeugt keine Namensdublettenwarnung für ein gleichnamiges aktives Gerät. Bei einer abgelehnten Geräteänderung wird zusätzlich die von Amazon gelieferte Fehlerursache angezeigt. Es gibt keine automatische Abfrage, Löschung oder Hintergrundbereinigung.

## Das bekommst du

- alle von der Alexa-Smart-Home-Schnittstelle gelieferten Einträge in einer Tabelle
- Gruppierung nach Alexa-Skill, direkter Echo-Verbindung oder Bridge
- Filter nach Skill/Quelle, Gerätetyp, Status und Namensdubletten
- Hinweise auf nicht erreichbare und deaktivierte Einträge
- Kennzeichnung möglicher Altlasten, deren Skillname nicht mehr im persönlichen Skillkatalog auflösbar ist
- Gruppierung eines Matter-Geräts mit mehreren technischen Alexa-Endpunkten zu einer Tabellenzeile
- Matter-Gruppen zählen nicht als Namensdublette und werden beim Einzellöschen gemeinsam verarbeitet
- Übersicht aller von Amazon gelieferten aktivierten Skills mit Name, Typ und Skill-ID
- Die oberen Kennzahlen „Geräte / Einträge“ und „Aktive Skills“ schalten den jeweils zugehörigen Bereich darunter um; niemals beide Tabellen untereinander
- Die umfangreiche Herkunftsübersicht ist standardmäßig eingeklappt und bleibt als optionale Zusatzinformation erhalten
- Filter für Skillname, Typ und Skills mit zugeordneten Smart-Home-Geräten
- Direkte Skill-Deaktivierung: Echo auswählen, Skill einzeln bestätigen, Alexa-Textbefehl senden und aktive Liste erneut prüfen
- Smart-Home-Geräte in Alexa deaktivieren und wieder aktivieren, ohne den Eintrag zu löschen
- Gemeinsames Aktivieren oder Deaktivieren aller technischen Endpunkte eines gruppierten Matter-Geräts
- Mobile Skill-Karten ohne horizontales Scrollen mit mindestens 44 Pixel hohen Aktionsschaltflächen
- Manuelle Kennzeichnung „Aktiv / behalten“ für funktionierende Geräte, die Amazon keinem Skillnamen zuordnet
- Dauerhafte Ausschlussliste im lokalen Datenvolume; gekennzeichnete Geräte sind für die Sammellöschung gesperrt
- gefilterte Sammelauswahl für mögliche Altlasten (höchstens 200 pro Vorgang)
- Einzellöschung anderer Einträge über die Detailansicht
- technische IDs und Zeitstempel in der Detailansicht
- CSV-Export der gerade gefilterten Liste
- lokale Amazon-Anmeldung, die jederzeit wieder entfernt werden kann

## Wichtige Grenzen

- Die verwendete Alexa-Schnittstelle ist nicht offiziell für diesen Zweck dokumentiert und kann sich durch Amazon-Änderungen verändern.
- Amazon liefert den lesbaren Skillnamen nicht für jeden Eintrag. Dann zeigt die Oberfläche den Hersteller als Ersatz und kennzeichnet den Namen als nicht auflösbar.
- „Nicht erreichbar“, „deaktiviert“, ein alter Zeitstempel oder ein nicht auflösbarer Skillname sind Prüfhilfen, aber kein sicherer Löschbeweis.
- Die Sammellöschung ist deshalb nur für Skill-Einträge freigegeben, deren Skillname Amazon nicht mehr im persönlichen Skillkatalog auflöst. Andere Einträge müssen einzeln geöffnet und bestätigt werden.
- Virtuelle Mediendienste werden nicht in die Sammelauswahl aufgenommen, können aber nach Einzelprüfung über die Detailansicht entfernt werden.
- Ein aktiver Skill kann gelöschte Einträge bei einer späteren Gerätesuche erneut anlegen.
- Die verwendete Löschschnittstelle entfernt den Alexa-Endpunkt. Das Ursprungsgerät, eine FRITZ!Box-Vorlage oder das Herstellerkonto wird dadurch nicht gelöscht.
- Die Matter-Gruppierung ist bewusst konservativ und greift nur bei direkt verbundenen Einträgen mit Amazons Matter-Platzhaltern `TestVendor` beziehungsweise `TestProduct`, wenn sowohl ein allgemeiner als auch ein funktionaler Endpunkt vorhanden ist.
- Amazon stellt über die verwendete Bibliothek keine dokumentierte direkte Skill-Deaktivierungsfunktion bereit. Die Anwendung verwendet deshalb den funktionierenden Alexa-Textbefehl `deaktiviere den Skill …` über ein ausgewähltes Echo.
- Die Anwendung wertet die Skill-Deaktivierung nur dann als erfolgreich, wenn der Skill nach dem erneuten Laden nicht mehr in der aktiven Liste erscheint.
- Es gibt bewusst keine Sammeldeaktivierung von Skills; jeder Skill wird einzeln bestätigt und anschließend geprüft.
- Das Deaktivieren eines Geräteeintrags sperrt nur dessen Nutzung in Alexa. Das physische Gerät und das Herstellerkonto werden nicht verändert, der Eintrag bleibt gespeichert und kann wieder aktiviert werden.

## Voraussetzungen

- QNAP mit Container Station beziehungsweise Docker Compose
- zwei freie Ports im Heimnetz:
  - `8765` für die Übersicht
  - `3456` nur während der Amazon-Anmeldung
- ein Browser im selben Heimnetz

Die voreingestellten Ports kollidieren nicht mit FRITZsync auf Port `8088`.

## Schnellstart auf der QNAP

1. ZIP-Datei in einen eigenen Ordner auf der QNAP entpacken, zum Beispiel:

   ```text
   /share/Container/alexa-geraeteuebersicht
   ```

2. Per SSH in diesen Ordner wechseln und das Image einmal bauen:

   ```bash
   cd /share/Container/alexa-geraeteuebersicht
   sudo docker compose build
   ```

3. Nur bei Bedarf starten:

   ```bash
   sudo docker compose up -d
   ```

4. Im Browser öffnen; `QNAP-IP` durch die Adresse deiner QNAP ersetzen:

   ```text
   http://QNAP-IP:8765
   ```

5. Auf **„Mit Amazon verbinden“** klicken. Die lokale Anmeldung öffnet sich über `http://QNAP-IP:3456`. Danach **„Geräte jetzt laden“** wählen.

6. Nach der Bestandsaufnahme vollständig stoppen:

   ```bash
   sudo docker compose down
   ```

`restart: "no"` ist in `compose.yaml` fest gesetzt. Der Container startet deshalb nicht automatisch neu. Es gibt keinen Zeitplan und keine Hintergrundabfrage.

### Update von Version 0.1.0

Den bisherigen Projektordner als Sicherung behalten, die Dateien aus dem neuen ZIP in einen neuen Ordner entpacken und dort starten:

```bash
sudo docker compose up -d --build
```

Beide Versionen verwenden standardmäßig dasselbe lokale Sitzungs-Volume. Deshalb ist normalerweise keine erneute Amazon-Anmeldung notwendig. Nicht beide Container gleichzeitig starten, da beide dieselben Ports verwenden.

### Start über Container Station

Alternativ kann der entpackte Ordner in Container Station als Compose-Anwendung angelegt werden. Wichtig ist, dass `compose.yaml`, `Dockerfile`, `package.json`, `app.js`, `lib`, `public` und `fixtures` zusammen im Build-Kontext liegen. In der Anwendung muss die Neustart-Richtlinie **Nie / No** erhalten bleiben.

## Sicherer Umgang mit der Anmeldung

Nach erfolgreicher Anmeldung wird die Sitzung ausschließlich im lokalen Docker-Volume gespeichert:

```text
alexa-geraeteuebersicht-session
```

Diese Datei ist sensibel:

- den Projektordner und Container Station nur für dein Administratorkonto freigeben
- die Ports `8765` und `3456` nicht aus dem Internet weiterleiten
- die Übersicht nur im vertrauenswürdigen Heimnetz öffnen
- nach Abschluss in der Oberfläche über `⋯` die **lokale Anmeldung entfernen**, wenn sie nicht erhalten bleiben soll

Das Entfernen der lokalen Anmeldung verändert weder Alexa-Geräte noch Skills.

Wenn die Anwendung samt Sitzung vollständig entfernt werden soll:

```bash
sudo docker compose down -v
```

`-v` löscht das lokale Sitzungs-Volume. Ohne `-v` bleibt die Anmeldung für den nächsten manuellen Start erhalten.

## Aufräum-Workflow

1. Liste unmittelbar vor dem Aufräumen neu laden.
2. Nach **Skill / Quelle** filtern, zum Beispiel `Fritz!Box`.
3. Optional **Nur mögliche Altlasten** aktivieren.
4. **Sichtbare Altlasten auswählen** anklicken und Anzahl sowie Namen prüfen.
5. **Auswahl löschen** wählen, die Bestätigung aktivieren und erst dann löschen.
6. Teilerfolge werden als `gelöscht / fehlgeschlagen` gemeldet; anschließend lädt die Anwendung die Alexa-Liste neu.
7. Andere Einträge können über **Details → Aus Alexa entfernen** einzeln geprüft und gelöscht werden.

Tipp: Wird ein alter Eintrag weiterhin von einem aktiven Skill geliefert, kann Alexa ihn nach einem manuellen Löschen erneut entdecken. In diesem Fall zuerst die Quelle beim Hersteller bereinigen.

## Skills deaktivieren

1. Oben **Aktive Skills** öffnen.
2. Im orangefarbenen Testbereich ein vorhandenes Echo auswählen.
3. Beim gewünschten Skill **Deaktivieren** wählen.
4. Den genauen Skillnamen und das Echo in der Sicherheitsabfrage prüfen und bestätigen.
5. Auf eine mögliche hörbare Antwort des Echos achten. Falls Alexa nachfragt, dort bestätigen.
6. Die Anwendung wartet kurz, lädt die aktive Skillliste neu und meldet, ob der Skill verschwunden ist.

Es wird kein frei eingegebener Sprachtext an Alexa übermittelt. Der Server akzeptiert nur einen Skill und ein Echo aus der unmittelbar zuvor geladenen Liste sowie die feste Einzelbestätigung. Smart-Home-Skills können beim Deaktivieren ihre zugeordneten Alexa-Geräte entfernen.

## Geräte deaktivieren oder aktivieren

1. Oben **Geräte / Einträge** öffnen.
2. Direkt in der Tabellenzeile **Deaktivieren** wählen oder das Gerät über **Details** öffnen.
3. Namen und Aktion in der Sicherheitsabfrage bestätigen.
4. Die Anwendung lädt die Geräteliste neu und prüft den von Amazon gemeldeten Zustand.

Ein deaktivierter Eintrag bleibt in Alexa vorhanden, ist aber dort nicht steuerbar. Mit **Aktivieren** kann er später wieder freigegeben werden. Bei einem gruppierten Matter-Gerät werden alle zugehörigen technischen Endpunkte gemeinsam verarbeitet.

## Einstellungen

### Anderen Port für die Übersicht verwenden

Der Amazon-Anmeldeport bleibt `3456`; nur der UI-Port kann einfach geändert werden:

```bash
sudo env UI_PORT=8877 docker compose up -d
```

Dann lautet die Adresse `http://QNAP-IP:8877`.

### Oberfläche mit Testdaten ansehen

Für einen gefahrlosen Funktionstest ohne Amazon-Anmeldung:

```bash
sudo env MOCK_MODE=true docker compose up -d --build
```

Im Testmodus auf **„Geräte jetzt laden“** klicken. Die vier angezeigten Einträge sind ausschließlich Beispieldaten. Anschließend wieder mit `sudo docker compose down` stoppen.

## Fehlerbehebung

### Das Anmeldefenster öffnet sich nicht

- Pop-ups für `http://QNAP-IP:8765` erlauben.
- Alternativ im blauen Hinweis auf **„Anmeldefenster öffnen“** klicken.
- Prüfen, ob Port `3456` im Heimnetz erreichbar und nicht belegt ist.
- Die Übersicht direkt über die QNAP-IP öffnen, nicht über einen externen Reverse Proxy.

### Die gespeicherte Anmeldung ist abgelaufen

In der Übersicht `⋯` öffnen, die lokale Anmeldung entfernen und erneut verbinden.

### Skillname nicht auflösbar

Das ist kein Programmfehler: Der Eintrag wurde als Skill-Gerät erkannt, aber Amazon hat im persönlichen Skillkatalog keinen passenden lesbaren Titel geliefert. Hersteller, Beschreibung und Skill-ID helfen bei der Zuordnung.

### Keine oder unvollständige Liste

Die Anwendung zeigt nur, was Amazon über die verwendete Smart-Home-Geräteliste liefert. Danach in der Alexa-App einmal **Geräte suchen** ausführen und die Übersicht neu laden. Beachte dabei, dass eine Suche auch alte Einträge aus weiterhin verknüpften Herstellerkonten erneut anlegen kann.

## Technische Hinweise

- Node.js 22 im Container
- Abhängigkeit: `alexa-remote2` 8.1.0
- keine externe Datenbank, Analyse oder Telemetrie
- keine automatische Aktualisierung der Geräteliste
- keine automatische oder gebündelte Skill- oder Gerätedeaktivierung
- keine Sammellöschung aktiver, direkt verbundener oder virtueller Einträge
- serverseitige Prüfung gegen die unmittelbar zuvor geladenen Geräte-, Skill- und Echo-Listen sowie die jeweils bestätigten Namen und Aktionen
- maximal 200 Einträge pro Sammelvorgang; Verarbeitung einzeln mit Fehlerbericht
- Content Security Policy und restriktive Browser-Berechtigungen
- CSV-Export wird ausschließlich im Browser erzeugt

## Lizenz

Der Anwendungscode steht unter der MIT-Lizenz. Abhängigkeiten behalten ihre jeweils eigene Lizenz.
