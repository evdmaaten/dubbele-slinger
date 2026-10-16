# Gemeten pad naast het stangenmodel

`compare_measured_paths.mjs` maakt een voorwaardelijke voorspelling met dezelfde `physics.js` als de HTML-interface. De twee bevestigde stangmassa's komen uit `practicum-gegevens.json`: boven 0,2703 kg, onder 0,2000 kg. De lengtes zijn 0,203 en 0,157 m; beide extra puntmassa's zijn nul. Markers zijn volgpunten, geen massamiddelpunten of extra gewichten.

De analyse gebruikt bestaande, gecontroleerde markerposities. Zij verandert geen tracking en stemt geen dynamische parameters af op de latere meetpunten. De opname en meetbestanden worden niet meegeleverd of gepubliceerd.

## Uitvoeren

Vanuit de projectmap, met Node.js en de Python-omgeving uit `analysis/requirements.txt`:

```powershell
node '.\analysis\compare_measured_paths.mjs' '.\.local-data\video-analyse' '.\.local-data\model-vergelijking'
& '.\.venv-video\Scripts\python.exe' '.\analysis\render_model_comparison.py' '.\.local-data\model-vergelijking'
```

Het vereiste invoerbestand is `bewegingspaden.csv` uit de videotracking. Framenummers, tijdstempels, geldigheid en oorspronkelijke pixelposities blijven behouden. Ongeldige markerparen worden niet met een modelwaarde of een geïnterpoleerde meting vervangen.

## Vastgelegde vergelijking

- Start van de simulatie: 13,5 videoseconde. De eerdere ruststand is geen gezamenlijke loslaatstand: de onderste en bovenste staaf begonnen op verschillende momenten te bewegen.
- Beginhoeken en beginsnelheden: lokale lineaire regressie van de ontvouwde beeldhoeken over frames 402–408 (13,4–13,6 videoseconde). Snelheden worden met de gekozen tijdsfactor vermenigvuldigd. Een aparte gevoeligheidsrun gebruikt elf frames rond hetzelfde tijdstip.
- Scores beginnen bij 13,7 videoseconde, na beide initialisatievensters. De vensters eindigen bij 15,5, 21,5 en 53,5 videoseconde; daarnaast wordt het latere gedeelte afzonderlijk weergegeven. Initialisatiepunten verbeteren de voorspellingsscore dus niet.
- Tijdsfactoren 8 en 1 zijn scenario's. Factor 8 is uitsluitend fysiek juist als de genoemde 240 opnameframes per seconde daadwerkelijk één-op-één als 30 fps worden afgespeeld. Dit is nog niet bevestigd.
- Per tijdsfactor wordt zonder demping gerekend en met de eerdere voorbeelddemping `c1=0.002`, `c2=0.001 N m s/rad`. Deze demping is niet uit het vervolg van deze video geschat.
- Hoofdweergave: factor 8, zonder demping, zeven initialisatieframes. Dit is een vooraf benoemd scenario, geen als beste uit de scores gekozen model.

De projectie gebruikt uitsluitend het eerdere venster 10,5–11,8 videoseconde: de mediane bovenradius gedeeld door `s1` geeft een voorlopige pixels-per-meter-schaal. De mediane onderradius bepaalt de groene markerfractie. Dat veronderstelt dat oranje precies op het tussenscharnier ligt, beide stangen dezelfde beeldschaal hebben en de beeldverticaal de zwaartekrachtsrichting is. De camerahelling wordt op nul aangenomen; er wordt geen perspectiefcorrectie uitgevoerd. Afwijkende markerafstand tijdens de beweging blijft als geometrische inconsistentie zichtbaar en wordt niet met de voorspelling gecorrigeerd.

## Resultaten lezen

`vergelijking.json` bevat instellingen, broncontrolesommen, initialisatie, alle voorspellingen, meetgaten en scores. `afwijkingen.csv` bewaart per scenario de gemeten en voorspelde coördinaten en hun afwijkingen.

De positie-RMSE is de wortel van de gemiddelde gekwadrateerde afstand tussen modelmarker en gemeten marker **op hetzelfde videotijdstip**. Zij wordt in oorspronkelijke beeldpixels uitgedrukt. De hoek-RMSE gebruikt de kortste hoekafstand en graden. Er wordt geen percentage overeenkomst of gekalibreerde millimeterfout van gemaakt. Alleen de RMSE van de hoekstatistieken is een grootte; de overige hoekstatistieken bewaren het teken van de hoekresiduen.

De padfiguur laat vormverschillen zien. De tijdfiguur is noodzakelijk om te beoordelen of de beweging ook tegelijk overeenkomt. Een gelijkende baanvorm bewijst geen juiste fase, snelheid of periode. Een lagere score over het gehele uitdovende filmpje kan voortkomen uit kleine amplitudes en bevestigt geen juiste tijdsfactor.

De lange voorspelling blijft gevoelig voor de beginsnelheid, markergeometrie, demping, camerastand en werkelijke massaverdeling. De stangen worden uniform en slank aangenomen. De bevestigde totale massa's bewijzen die massaverdeling niet. De halve-tijdstapcontrole in het rapport toetst de numerieke integratie, niet deze fysieke aannames.

## In de HTML-interface bekijken

1. Open `standalone.html` en gebruik **Herstel instellingen uit JSON** voor `instellingen-f8-free.json` uit de lokale uitvoermap.
2. Ga naar **De meting naast het model** en laad het oorspronkelijke `bewegingspaden.csv`.
3. Beide panelen tonen standaard de eerste acht videoseconden na 13,5 s (één modelseconde bij factor 8). De volledige berekende duur is vijf modelseconden. Rechts staat de meting gestreept over de modelbaan.

De app toont daarbij meters onder de voorlopige beeldschaal. De cijfermatige analyse houdt de fout in pixels, zodat een ongekalibreerde projectie niet als gemeten fysieke nauwkeurigheid wordt gepresenteerd. De padweergave bevat ook de initialisatiebeelden; de rapportscore begint later en heeft daarom een iets kleiner aantal punten.

De andere `instellingen-*.json`-bestanden herstellen de afzonderlijke scenario's. Na een JSON-import moet de meet-CSV opnieuw worden geladen. Resultaatbestanden en browserimports blijven lokaal onder `.local-data/`; alleen scripts en dit protocol worden met de broncode gedeeld.
