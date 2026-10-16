# Trackervergelijking op dezelfde practicumvideo

Dit document beschrijft hoe de notebooktracker en de bestaande tracker op dezelfde beelden worden vergeleken. Het bevat het protocol en de uitvoerstappen, geen conclusie over welke methode nauwkeuriger is. Een resultaat mag pas worden beoordeeld na controle van de referenties, bronidentiteit, detectiedekking en scores.

De scripts zijn specifiek voor de aangeleverde opname: **2.492 frames van 1.024 × 576 pixels**, met 30 beelden per afspeelseconde. Dit is geen algemene benchmark voor willekeurige slingeropnamen. De bijbehorende bronvideo, het notebook en de bestaande tracking moeten lokaal beschikbaar zijn; ze worden niet meegeleverd in de repository.

## Wat wordt vergeleken?

| Naam in de uitvoer | Werkwijze | Te beoordelen marker |
| --- | --- | --- |
| `notebook_original`, `raw` | Ongewijzigde `detect_red_point` uit het aangeleverde notebook: rood HSV-masker over het hele beeld, 5×5 opening en sluiting, grootste externe contour, minimaal contourvlak 10 pixels, naar gehele pixels afgekapt momentencentrum | Alleen oranje; het originele notebook levert geen groene marker |
| `notebook_controlled`, `raw` | Expliciet aangepaste notebookvariant: dezelfde brede oranje/groene HSV-maskers en hetzelfde beeldgebied als onze tracker; de contour-, morfologie- en integercentrumstappen blijven behouden | Oranje en groen afzonderlijk |
| `ours`, `raw` | Bestaande componentkeuze, kleurweging, grootte- en beeldafstandgrenzen; oorspronkelijke ruwe coördinaten, inclusief ontbrekende detecties | Oranje en groen |
| `ours`, `quality_accepted` | Dezelfde ruwe coördinaten met de reeds bestaande selectie van het hele markerpaar | Oranje en groen; afkeuring telt als geen geleverde positie |

De aangepaste notebookvariant is **niet het oorspronkelijke notebook**. De gelijke maskers en uitsnede maken zichtbaar wat kleuraanpassing verandert. Er blijven verschillen in componentkeuze, geometrische grenzen en morfologie; dit is dus geen geïsoleerde test van uitsluitend integer- tegenover decimale coördinaten. Meer decimalen zijn geen bewijs van hogere nauwkeurigheid.

De gecontroleerde maskers zijn `H<=18, S>155, V>75` voor oranje en `29<=H<=95, S>70, V>40` voor groen. Het beeldgebied is `180<=x<850`, `30<=y<550`. De aangepaste notebookvariant krijgt geen afstandsgrenzen, kleurgewogen componentrangschikking of temporele selectie van onze tracker.

Beide routes gebruiken OpenCV. FFmpeg/FFprobe dienen voor videoverwerking en tijdstempels. De notebookfunctie wordt uit de broncellen gehaald als één AST-functiedefinitie en met `cv2` en `numpy` beschikbaar uitgevoerd. Het volledige notebook, `process_video`, uitvoercellen en opgeslagen notebookresultaten worden niet uitgevoerd. Deze extractie is geen algemene beveiligingsomgeving voor willekeurige notebooks: de functie moet vooraf als broncode zijn geïnspecteerd.

## Steekproef, blindering en referentie

De reguliere steekproef bestaat uit 25 frame-indices volgens `round(i*2491/24)` voor `i=0..24`. Daarnaast zijn zes vooraf aangewezen moeilijke beelden opgenomen: **360, 375, 385, 405, 420 en 450**. Deze komen uit het eerder bekeken bewegingsbegin en worden afzonderlijk gerapporteerd. Ze mogen niet stilzwijgend met de reguliere steekproef worden samengevoegd tot één representatief cijfer.

Twee onafhankelijke AI-lezers bepalen visueel het centrum van de oranje en groene kleurstip. Zij krijgen uitsluitend de oorspronkelijke frames en eventueel het pixelraster, zonder detectoroverlays, voorspelde coördinaten of de labels van de andere lezer. Het te volgen punt is het **zichtbare kleurstipcentrum**, niet het centrum van het gele kaartje, het scharnier of het massamiddelpunt.

Per frame en marker worden zichtbaarheid, coördinaten, geschatte onzekerheid en eventuele ambiguïteit vastgelegd. Een onscherpe of afgedekte stip mag niet met behulp van het model of de detector worden ingevuld. Beide lezingen worden voltooid voordat hun onderlinge verschillen en de detectoruitkomsten worden bekeken. Na die vergelijking worden de trackers, thresholds en framekeuze niet aangepast aan deze labels.

Dit zijn **AI-visuele referenties, geen menselijke of metrologisch gekalibreerde grondwaarheid**. Onafhankelijke lezingen kunnen dezelfde beeldinterpretatiefout delen. Hun overeenstemming meet daarom niet de totale referentienauwkeurigheid. Het gemiddelde van de twee centra dient als vergelijkingsreferentie waar beide lezers de marker zichtbaar achten; onderlinge afstand en onzekerheid blijven afzonderlijk zichtbaar. Sluit achteraf geen moeilijke referenties uit omdat een detector daar slecht scoort.

De bestaande kwaliteitsselectie van onze tracker bevat een eerdere handmatige afkeuring van **frame 385**. Deze voorkennis blijft deel van de vastgelegde methode en wordt vermeld. De geselecteerde variant is daarmee niet volledig automatisch of onafhankelijk van eerdere inspectie van deze opname. De nieuwe lezers blijven wel blind voor de detectoruitkomsten tijdens het labelen.

## Benodigdheden en lokale paden

Voer de voorbeelden vanuit de projectmap uit in PowerShell. Pas de drie bronpaden aan de eigen computer aan. Gebruik voor een nieuwe volledige herhaling een nieuwe lokale uitvoermap; overschrijf geen eerdere referentielabels of vastgelegd manifest.

```powershell
Set-Location -LiteralPath 'C:\pad\naar\dubbele-slinger'
python -m venv '.venv-video'
$benchmarkPython = Join-Path (Get-Location) '.venv-video\Scripts\python.exe'
& $benchmarkPython -m pip install -r '.\analysis\requirements.txt'

$benchmarkVideo = 'C:\pad\naar\WhatsApp Video 2026-10-15 at 9.29.56 PM.mp4'
$benchmarkNotebook = 'C:\pad\naar\Pendulum tracking (3).ipynb'
$benchmarkTracking = (Resolve-Path -LiteralPath '.\.local-data\video-analyse').Path
$benchmarkOutput = Join-Path (Get-Location) '.local-data\tracker-benchmark-herhaling'
```

FFprobe moet via `PATH` beschikbaar zijn. De bestaande trackingmap moet `tracking-raw.csv`, `tracking-quality.csv`, `tracking-metadata.json` en `measurement-summary.json` bevatten. Die moeten bij exact dezelfde bronvideo horen. `analysis/requirements.txt` legt de gebruikte Python-pakketten vast; de uitvoer registreert de OpenCV- en NumPy-versie. Bewaar ook de gebruikte broncodeversie bij de benchmark.

Tijdens de benchmark worden `track_video.py`, de bestaande ruwe coördinaten en de kwaliteitsselectie **niet gewijzigd of opnieuw gegenereerd**. De vergelijkingsscripts schrijven naar de afzonderlijke benchmarkmap. Ze veranderen de bronvideo en het aangeleverde notebook niet.

## Uitvoering

### 1. Leg de vergelijking vast

```powershell
& $benchmarkPython '.\analysis\benchmark_tracking.py' freeze --video $benchmarkVideo --notebook $benchmarkNotebook --tracking $benchmarkTracking --output $benchmarkOutput
```

`frozen-manifest.json` legt onder meer de broncontrolesommen, framekeuze, methoden en inspecteerbare notebookfunctie vast. De bronhash wordt aan de bestaande videometadata getoetst; de kwaliteitssamenvatting moet naar dezelfde ruwe tracking verwijzen. Een bestaand manifest met afwijkende vaste bron- of methodevelden wordt niet overschreven. De geëxtraheerde functie staat lokaal in `notebook-detect-red-point.py`.

### 2. Maak beelden voor de blinde lezers

```powershell
& $benchmarkPython '.\analysis\prepare_tracking_reference.py' $benchmarkVideo $benchmarkOutput
```

Dit maakt `reference-protocol.json`, de oorspronkelijke PNG's onder `reference-frames` en versies met een pixelraster onder `reference-grids`. Het script controleert de beeldafmetingen, de gekozen frames, het totale frameaantal en de ongewijzigde bronhash. Geef beide lezers alleen deze beelden en de labelinstructie; houd de detectoruitvoer buiten hun beoordeling.

Bewaar de lezingen afzonderlijk als `annotations-A.json` en `annotations-B.json` in de benchmarkmap. Voor de rapportgenerator gebruikt elk bestand een JSON-object met een `rows`-array. Geef voor elk geselecteerd frame beide markers op, ook als een marker niet zichtbaar is:

| Veld per regel | Inhoud |
| --- | --- |
| `frame` | Oorspronkelijke gehele frame-index |
| `marker` | `orange` of `green` |
| `visible` | JSON-boolean; `false` bij een niet te bepalen centrum |
| `x_px`, `y_px` | Coördinaten in de oorspronkelijke pixels: x rechts, y omlaag, oorsprong linksboven; `null` bij een onzichtbare marker |
| `uncertainty_px` | Geschatte positionele onzekerheid bij een zichtbare marker, geen statistisch betrouwbaarheidsinterval |
| `note` | Toelichting bij onscherpte, afdekking of een andere onzekerheid |

De scorefunctie accepteert ook CSV, maar de huidige rapportgenerator verwacht de twee genoemde JSON-bestanden met `rows`. Bewaar de afzonderlijke lezingen; vervang ze niet door een gezamenlijk overeengekomen labelbestand.

### 3. Bereken de detecties en controleer onze bestaande tracking

```powershell
& $benchmarkPython '.\analysis\benchmark_tracking.py' run --video $benchmarkVideo --notebook $benchmarkNotebook --tracking $benchmarkTracking --output $benchmarkOutput
```

Alle 2.492 beelden worden in dezelfde volgorde gedecodeerd. De originele en aangepaste notebookroutes krijgen dezelfde bronframes. De bestaande functies `marker` en `match_patch` worden opnieuw doorgerekend om onze opgeslagen posities en markeroppervlakken te controleren. De positiefouten worden vervolgens berekend met de vastgelegde ruwe waarden, niet met achteraf verbeterde detecties.

`prediction-run.json` moet aantonen dat de invoerhashen vóór en na de run gelijk zijn en dat er geen afwijkende frames in de reproductiecontrole zijn. De coördinatentolerantie voor deze software-identiteitscontrole is `1e-8 px`; dit is **geen fysieke meetnauwkeurigheid**. Bij een afwijking stopt de workflow vóór het scoren. `predictions-all-frames.csv` bewaart alle detecties, `predictions-selected-frames.csv` de vastgelegde steekproef en `ours-identity-check.csv` de reproductiecontrole per frame.

### 4. Controleer de tijdas afzonderlijk

```powershell
& $benchmarkPython '.\analysis\benchmark_tracking.py' timing --video $benchmarkVideo --tracking $benchmarkTracking --output $benchmarkOutput
```

`timing-audit.json` vergelijkt `frame-index/fps`, de gehele PTS met de videotijdbasis en de geëxporteerde CSV-tijden. Controleer de uitkomst; veronderstel niet bij voorbaat dat beide tijdmethoden verschillen of gelijk zijn. Deze controle bepaalt geen oorspronkelijke opnametijd en bevestigt geen slowmotionfactor. De benchmark beoordeelt beeldposities per gekoppelde frame-index, niet de nauwkeurigheid van fysieke snelheden of hoeken.

### 5. Vergelijk de referenties en scoor de methoden

```powershell
$benchmarkAnnotationsA = Join-Path $benchmarkOutput 'annotations-A.json'
$benchmarkAnnotationsB = Join-Path $benchmarkOutput 'annotations-B.json'
& $benchmarkPython '.\analysis\benchmark_tracking.py' score --output $benchmarkOutput --annotations-a $benchmarkAnnotationsA --annotations-b $benchmarkAnnotationsB
```

Controleer eerst `observer-agreement.csv` en de referentieaantallen. De regels met twee zichtbare referenties vormen de noemer voor de scores. Ontbrekende referenties moeten dus apart worden gemeld; de detector mag daar niet automatisch een goede of slechte score krijgen.

De rapportage houdt per marker de reguliere en moeilijke beelden gescheiden. Rapporteer detectiedekking, mediaan, gemiddelde, RMSE en P90 van de pixelafstand, naast treffers binnen de vooraf vastgelegde **5 en 10 pixels**. Voor deze trefferpercentages tellen ontbrekende of door onze kwaliteitsselectie afgekeurde posities mee als geen succes. Foutmaten over uitsluitend geleverde posities worden altijd samen met de dekking gelezen. Gepaard vergelijken op gemeenschappelijk geleverde posities is aanvullend; het mag de gemiste frames niet verbergen.

Inspecteer grote fouten op verkeerde objectkeuze of markeridentiteit. Een pixelafstand alleen classificeert niet automatisch de oorzaak. Kleine verschillen van dezelfde orde als de visuele referentieonzekerheid leveren geen overtuigende nauwkeurigheidsrangorde op. De geschatte onzekerheid wordt niet omgezet in een gekalibreerd betrouwbaarheidsinterval.

De scorer schrijft `accuracy-summary.json` (schema `dubbele-slinger/tracker-accuracy-v2`) en `accuracy-by-frame.csv`, met beide treffergrenzen en de gepaarde vergelijkingen. `paired-common-valid.csv` bevat de vergelijkingen per gezamenlijk geldig frame; `annotation-exclusions.csv` legt vast welke referentiepunten wegens ontbrekende zichtbaarheid buiten de scores vallen. Controleer die bestanden samen met `observer-agreement.csv`, zodat ontbrekende referenties, ontbrekende detecties en kwaliteitsafkeuringen niet door elkaar worden gehaald. Een manifest of tabel met alleen voorspellingen is nog geen afgeronde nauwkeurigheidstest.

### 6. Maak en inspecteer het lokale rapport

```powershell
& $benchmarkPython '.\analysis\report_tracking_benchmark.py' $benchmarkOutput
Invoke-Item -LiteralPath (Join-Path $benchmarkOutput 'vergelijking.html')
```

De rapportgenerator maakt de HTML, een PNG- en SVG-grafiek, overlays voor alle geselecteerde frames en `report-artifacts.json` met controlesommen. Controleer visueel de markerlabels, ontbrekende posities, afkeuringen, onzekerheidsaanduidingen en overeenstemming tussen tabellen en scorebestanden. De rapportgenerator is op deze opname en deze referentieprocedure afgestemd; tekst over aantallen of zichtbaarheid moet overeenkomen met de werkelijke score-uitvoer. Een geslaagde render is geen automatische controle van alle meetclaims.

## Herkomst corrigeren zonder het vastgelegde protocol te herschrijven

De definitieve `score`-stap maakt via `write_provenance_amendment` automatisch een afzonderlijk lokaal `provenance-amendment.json`. Dit corrigeert de te stellige historische formulering dat annotaties niet beschikbaar waren toen het implementatiemanifest werd geschreven; annotatie A bestond toen al. De aanvulling bevat de oorspronkelijke manifest- en runhash, voorspellinghashen, de correctie en een waargenomen bestandstijdlijn. Bestandstijden zijn daarbij geen onafhankelijk bewezen aanmaaktijden. Het oorspronkelijke `frozen-manifest.json` en `prediction-run.json` blijven byte voor byte behouden, zodat hun historische hashes geldig blijven. Bij een bestaande aanvulling worden de vaste bronhashen gecontroleerd; deze werkwijze herschrijft geen historische vastlegging.

Maak daarbij onderscheid tussen de datum waarop beelden en instellingen zijn vastgelegd, de datum waarop lezingen zijn gemaakt en de datum waarop het implementatiemanifest is geschreven. Het bestaan van een labelbestand vóór dat laatste moment betekent niet op zichzelf dat labels voor afstemming zijn gebruikt; omgekeerd bewijst een manifestvlag niet dat een lezer blind was. Leg de werkelijke werkwijze vast. Een metadata-aanvulling mag geen gewijzigde bron, detectie, framekeuze, threshold of referentie verbergen: zulke wijzigingen vragen een afzonderlijke benchmarkversie.

## Interpretatie en delen

Onze tracker was al op deze opname afgestemd. De reguliere steekproef is beperkt; de moeilijke beelden zijn bewust gekozen. Resultaten gelden daarom eerst voor deze opname en deze markers. Voor een algemeen oordeel zijn andere opnamen en onafhankelijk gecontroleerde referentiepunten nodig. Goede stiptracking bewijst geen gekalibreerde scharnierhoek, geen overeenkomst met het dynamische model en geen Lyapunov-exponent.

De bevestiging van de staafmassa's — boven `0,2703 kg`, onder `0,2000 kg`, beide gemeld `±0,001 kg`, zonder aparte puntgewichten bij de markers — is een **afzonderlijke modelparameterupdate**. Zij verandert geen tracker, benchmarklabel of pixelreferentie. Massaverdeling, traagheidsmomenten, markergeometrie, demping en fysieke tijdschaal blijven afzonderlijk te beoordelen.

Alle gegenereerde gegevens blijven onder `.local-data/`, dat is uitgesloten van Git. Publiceer uitsluitend de beoordeelde broncode en dit protocol. **Bronvideo, aangeleverd notebook, uitgesneden of volledige videoframes, labels, ruwe tracking, voorspellingen, scores en gegenereerde rapporten worden niet meegepubliceerd.** Een algemene broncode-upload autoriseert geen upload van deze lokale gegevens. Dit document kan zonder die bestanden in GitHub staan; een andere gebruiker heeft de oorspronkelijke lokale bronnen nodig om dezelfde benchmark te reproduceren.
