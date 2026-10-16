# Dubbele slinger — simulatie en proefvergelijking

Interactief model van een dubbele slinger, gebaseerd op de aangeleverde schets. Kies tussen touw/draad met twee losse gewichten en stijve stangen met eigen massa. Stel de lengtes, massa's en begintoestand in; bekijk de beweging en vergelijk voorspelde hoeken met videometingen van de echte opstelling.

**Touw/draad kan alleen trekken; stijve stangen kunnen ook duwen.** In de touwmodus stopt de berekening zodra een touw slap zou worden. In de stangmodus loopt zij door bij drukbelasting en zijn volledige omwentelingen mogelijk. Beide modellen veronderstellen een beweging in één vlak.

| Modus | Fysisch model | Massa van de verbinding | Stop bij nul trekkracht? |
| --- | --- | --- | --- |
| Touw / draad | Massaloos, onrekbaar en alleen geldig zolang het strak staat | Niet meegerekend | Ja, bij overgang naar negatieve spanning |
| Stijve stangen | Twee uniforme slanke stangen met ideale draaipunten | Per stang instelbaar | Nee; trek en druk zijn toegestaan |

Een flexibele draad valt hier onder de touwmodus; buigstijfheid wordt niet gemodelleerd. Slap touw, vrije vlucht en de schok bij opnieuw strak trekken zijn nog niet geïmplementeerd. Een touwstart die een duwkracht vereist wordt meteen afgewezen. Stangen worden als perfect stijf beschouwd; botsingen, knikken en een mechanische rotatiestop zijn niet inbegrepen.

De lokaal bekeken praktijkvideo toont twee stijve, vlakke strips met draaipunten en gekleurde markeringen. Daarom past de **stangmodus** bij het zichtbare mechanisme. De bovenste strip lijkt langer; de beweging dempt zichtbaar uit gedurende de opname van ongeveer 83 s. Dit zijn beeldobservaties. Uniforme slanke stangen blijven een benadering van deze strips. De voorbeeldinstellingen zijn nog niet op de video afgestemd. De video en daaruit gevolgde hoek- en positiegegevens blijven lokaal; tijdschaal, camera en massaverdeling zijn nog niet volledig gekalibreerd.

### Aangeleverde practicumgegevens

Op 15 oktober 2026 zijn deze waarden in twee afbeeldingen aangeleverd:

| Grootheid | Aangeleverde waarde | In SI-eenheden |
| --- | --- | --- |
| Oorsprong naar tweede scharnier, s1 | 203 mm | 0,203 m |
| Tweede scharnier naar uiteinde, s2 | 157 mm | 0,157 m |
| Upper Mass, m1 in de brontabel | 0,2703 ± 0,001 kg | 0,2703 ± 0,001 kg |
| Lower Mass, m2 in de brontabel | 0,2000 ± 0,001 kg | 0,2000 ± 0,001 kg |

De gebruiker heeft aangegeven dat de betekenis van de massa's **nog onbekend** is. De labels `m1` en `m2` in de brontabel betekenen niet automatisch de extra puntmassa's `m1` en `m2` in deze app: als het de totale stangmassa's zijn, horen ze bij `rodMass1` en `rodMass2`. Tel dezelfde massa niet dubbel. De betekenis van de opgegeven ±0,001 kg en de onzekerheid in de lengtes zijn niet gespecificeerd. De letterlijke gegevens en de open punten staan in [practicum-gegevens.json](practicum-gegevens.json); dat is een meetrecord, geen importeerbaar proefbestand. De gemeten massa's zijn daarin bewust nog aan geen modelparameter toegewezen. Beginstand, demping en massaverdeling blijven nog te bepalen.

De keuzelijst bevat **Practicum · alleen lengtes**. Deze voorinstelling gebruikt de aangeleverde `s1 = 0,203 m` en `s2 = 0,157 m` in stangmodus. Alle overige waarden zijn voorbeelden: `rodMass1 = rodMass2 = 0,2 kg`, `m1 = m2 = 0`, beginhoeken `25° / −15°`, nulbeginsnelheden, `c1 = 0,002` en `c2 = 0,001 N·m·s/rad`. De gemeten `0,2703 kg` en `0,2000 kg` worden niet automatisch ingevuld; dat de voorbeeldmassa van de onderste stang eveneens `0,2 kg` is, betekent geen bevestigde toewijzing.

Deze voorinstelling maakt de aangeleverde lengtes bruikbaar zonder de onbekende massa-interpretatie in te vullen. Het blijft een **ongekalibreerde voorbeeldproef**. De interface blijft bij openen starten met het bestaande stangenvoorbeeld van `0,5 m` per stang; kies de practicumvoorinstelling afzonderlijk.

## Lokaal starten

**De eenvoudigste route is dubbelklikken op `standalone.html`.** De volledige interface, rekenkern, vormgeving en het meetprotocol zitten in dit ene bestand. Gebruik een moderne browser; een server, installatie of internetverbinding is voor deze route niet nodig. De link **Lees het meetprotocol** downloadt de ingesloten tekst als `dubbele-slinger-meetprotocol.md`.

Als je een ZIP ontvangt, pak die eerst uit en open daarna `standalone.html`. Bewaar de bronbestanden als je het model later wilt aanpassen. De standalone-versie rekent in de browser; tijdens een zwaardere berekening kan de interface kort wachten.

Voor werken vanuit de modulaire broncode gebruik je Node.js 20 of nieuwer. Vanuit de projectmap:

```powershell
npm start
```

Open [de lokale interface](http://localhost:4173). Stop de server met `Ctrl+C`. Deze route rekent waar mogelijk in een achtergrondworker. Er zijn geen externe pakketten nodig; `npm install` is niet nodig. De simulatie rekent in JavaScript in de browser. Er is geen Python-server nodig.

Na wijzigingen in de broncode of dit meetprotocol werk je het losse HTML-bestand bij met:

```powershell
npm run build
```

Bewerk de bronbestanden en bouw opnieuw; `standalone.html` is een gegenereerd bestand.

De numerieke en importtests starten met:

```powershell
npm test
```

Zie [VALIDATIE.md](VALIDATIE.md) voor de uitgevoerde numerieke controles, referentie-uitkomsten en controles met de lokale video. Een geslaagde softwaretest is geen validatie tegen de fysieke opstelling. Er zijn echte videometingen beschikbaar, maar de ontbrekende kalibratie verhindert nog een bevestigde kwantitatieve overeenkomst met de werkelijkheid.

## Instellingen en conventies

| Grootheid | Eenheid | Betekenis |
| --- | --- | --- |
| `model` | — | `string` voor touw/draad of `rigid` voor stijve stangen |
| `s1` | m | Afstand van het vaste ophangpunt tot het tussenpunt |
| `s2` | m | Afstand van het tussenpunt tot het onderste eindpunt |
| `m1`, `m2` | kg | Extra puntmassa op het tussenpunt en het onderste eindpunt |
| `rodMass1`, `rodMass2` | kg | Eigen massa van de uniforme stangen; alleen in stangmodus |
| `theta1`, `theta2` | graden | Absolute hoek van elk touw of elke stang ten opzichte van verticaal omlaag |
| `omega1`, `omega2` | graden/s | Beginsnelheid van de twee hoeken |
| `g` | m/s² | Zwaartekrachtsversnelling |
| `c1`, `c2` | N·m·s/rad | Optionele coëfficiënten voor het koppeldempingsmodel |
| `dt` | s | Tijdstap van de integrator; geen videoframetijd |
| duur | s | Gevraagde simulatieduur; in touwmodus kan deze door slap touw korter worden |

Positieve hoeken wijzen naar rechts vanaf de neerwaartse verticaal. `theta2` is dus **niet** de hoek tussen de twee delen. De plaats van het onderste eindpunt volgt uit de som van beide lengtevectoren. De rekenkern gebruikt radialen, meters, kilogrammen en seconden.

In touwmodus zijn `m1` en `m2` de twee gewichten en tellen stangmassa's niet mee. In stangmodus staan deze puntmassa's **naast** de stangmassa's. Voor alleen twee stangen stel je `m1 = m2 = 0` in en voer je hun massa's in bij `rodMass1` en `rodMass2`. Voor stangen met extra gewichten voer je beide soorten massa in; tel een gewicht niet dubbel. De totale massaverdeling moet een niet-ontaard systeem met twee vrijheidsgraden opleveren.

De standaardwaarden zijn voorbeelden, geen gemeten eigenschappen van jouw opstelling. Meet en voer de werkelijke waarden in voordat je een voorspelling beoordeelt.

De interface opent met een **gedempt stangenvoorbeeld**: twee stangen van `0,5 m` en `0,2 kg`, zonder extra puntgewichten, beginhoeken `25° / −15°`, `c1 = 0,002` en `c2 = 0,001 N·m·s/rad`. Ook deze lengtes, massa's en demping zijn niet uit de video bepaald. De touwvoorbeelden blijven via de keuzelijst beschikbaar.

De tweede, bijna gelijke simulatie begint met een kleine hoekverstoring. Het verschil tussen beide banen laat gevoeligheid voor de begintoestand zien. De gewone afstandsgrafiek is geen Lyapunov-exponent; de afzonderlijke faseruimteanalyse hieronder rapporteert een helling over een gekozen venster. Geen van beide bewijst op zichzelf chaos. Bij kleine uitwijkingen is het gedrag vaak bijna lineair; ook andere begintoestanden kunnen regelmatig bewegen. Grote hoeken geven bij touwen bovendien eerder een overgang naar slap touw. Zie de [oorspronkelijke modelafleiding van myPhysicsLab](https://www.myphysicslab.com/pendulum/double-pendulum-en.html).

## Wat je uit de interface kunt halen

- Animatie van de hoofdsimulatie en de bijna gelijke tweede simulatie.
- Hoeken, energie, touwspanningen of axiale reactiekrachten van de stangen, en afstand tussen de twee onderste eindpunten als functie van de tijd.
- Import van gemeten hoeken en vergelijking binnen een gekozen tijdvenster.
- Export van simulatiewaarden als CSV en proefinstellingen als JSON.
- Herstellen van instellingen uit een eerder geëxporteerd JSON-proefbestand; de beweging wordt opnieuw berekend.

De twee simulaties kunnen op verschillende tijdstippen stoppen. Vergelijk hun afwijking alleen zolang ze allebei geldig zijn. Een grote afstand op een laat tijdstip zegt weinig over de meetnauwkeurigheid aan het begin.

## Praktisch meetprotocol

1. **Leg de geometrie en massa vast.** Bij touw weeg je beide gewichten inclusief meebewegende bevestigingen. Meet met strak touw van ophangpunt tot massamiddelpunt 1 en vandaar tot massamiddelpunt 2; gebruik niet alleen de afgeknipte touwlengte. Bij stangen meet je van draaipunt tot draaipunt/eindpunt en weeg je elke stang afzonderlijk. Noteer extra puntmassa's apart, plus meetonzekerheden en bevestigingsafstanden.
2. **Controleer de massaverdeling.** In touwmodus komen beide touwen idealiter samen bij massamiddelpunt 1. Afzonderlijke bevestigingspunten aan een groot draaiend gewicht maken de puntmassabenadering minder nauwkeurig. In stangmodus moet elke stang ongeveer uniform zijn: massamiddelpunt halverwege, traagheidsmoment om het eigen massamiddelpunt `m s²/12`. Een zwaar lager, brede plaat of gewicht midden op de stang past niet exact in deze verdeling. Alleen de totale massa invoeren corrigeert dat niet.
3. **Film in één vlak.** Zet de camera vast, loodrecht op het bewegingsvlak. Houd ophangpunt, tussenpunt en onderste eindpunt in beeld en plaats een maatlat in hetzelfde vlak. In touwmodus volg je de massamiddelpunten, in stangmodus de draaipunten/eindpunten. Gebruik voldoende licht en een korte belichting om bewegingsonscherpte te beperken. Controleer de werkelijke tijdstempels of beeldfrequentie van de video.
4. **Begin klein.** Kies kleine uitwijkingen, bijvoorbeeld enkele graden, en laat los zonder extra zet. Doe eerst een reeks met ongeveer dezelfde beginstand. Controleer periodes, onderlinge fase en het doorgeven van beweging. Kijk of touwen strak blijven en of de beweging in het beeldvlak blijft. Stangen met eigen massa hebben andere periodes dan massaloze verbindingen met alleen puntmassa's.
5. **Bepaal de beginwaarden.** Gebruik het loslaatmoment als tijdnul. Meet beide absolute hoeken. Een onbedoelde beginsnelheid kan de voorspelling sterk veranderen; schat deze uit meerdere opeenvolgende frames als loslaten niet stil gebeurt.
6. **Exporteer de gemeten hoeken.** Volg in elk bruikbaar frame het vaste punt, tussenpunt en onderste eindpunt volgens de gekozen modus. Importeer de CSV volgens het formaat hieronder. De app bevat geen automatische videotracker.
7. **Controleer de berekening.** Vergelijk een run met tijdstap `dt` met dezelfde run met `dt/2`, vooral in het vroege vergelijkingsvenster. Bij nul demping hoort de energie nagenoeg constant te blijven. Bij demping controleer je de som van mechanische en gedissipeerde energie. Een kleinere tijdstap hoort de numerieke afwijking te verkleinen.
8. **Vergelijk eerst het begin.** Kies vooraf een tijdvenster en een foutmarge die past bij jouw meetonzekerheid. Bekijk beide hoekcurven en hun RMSE. Er is geen universele grens waaronder de proef automatisch geslaagd is. Een systematische fasefout kan bijvoorbeeld op een verkeerde lengte of tijdnul wijzen.
9. **Vergroot daarna de uitwijking.** Herhaal de proef meerdere keren en noteer de kleine verschillen in beginstand. Vergelijk ook kenmerken zoals omslagpunten, omwentelingen en in touwmodus het eerste moment van slap touw. Stop een punt-voor-puntvergelijking waar het model buiten zijn geldigheidsgebied komt. Kies geen chaotisch verloop als vooraf vaststaand succescriterium: beide systemen kunnen ook regelmatig bewegen.

Voor beeldcoördinaten met `x` naar rechts en `y` omlaag zijn de hoeken:

```text
theta1 = atan2(x1 - x0, y1 - y0)
theta2 = atan2(x2 - x1, y2 - y1)
```

Vermenigvuldig de uitkomst met `180/pi` voor graden. `(x0,y0)` is het vaste ophangpunt. Gebruik dezelfde hoekconventie in de videoanalyse en de app.

Experimentele chaotische slingers vertonen groeiende verschillen tussen bijna gelijke begincondities. Dat beperkt hoe lang één exacte baan praktisch voorspelbaar is; het sluit vergelijking van korte trajecten en herhaalde proeven niet uit. Zie [Shinbrot, Grebogi, Wisdom & Yorke, *Chaos in a double pendulum* (1992)](https://yorke.umd.edu/Yorke_papers_most_cited_and_post2000/1992-04-Wisdom_Shinbrot_AmerJPhys_double_pendulum.pdf), [DOI 10.1119/1.16860](https://doi.org/10.1119/1.16860). Die publicatie valideert niet automatisch deze touwopstelling of deze software.

## Gemeten gegevens importeren

Gebruik tijd in seconden en hoeken in graden, met deze kolomnamen:

```csv
t,theta1_deg,theta2_deg
0,5,-3
0.02,4.98,-2.96
0.04,4.92,-2.84
```

Dit is alleen een formaatvoorbeeld, geen echte meting. Een puntkomma als kolomscheiding en een decimale komma worden ook ondersteund:

```csv
t;theta1_deg;theta2_deg
0;5;-3
0,02;4,98;-2,96
0,04;4,92;-2,84
```

Gebruik een consistente scheiding, numerieke waarden en minimaal twee strikt oplopende tijdstippen vanaf nul of later. Vul ontbrekende frames niet met nulwaarden. Extra kolommen zijn toegestaan. Bewaar de originele video, ruwe meetgegevens en eenheden naast de geëxporteerde proefinstellingen.

De vergelijking gebruikt `t_model = t_CSV - tijdsverschuiving`. Een positieve verschuiving van `1,2 s` betekent dus dat het loslaten bij `t_CSV = 1,2 s` plaatsvond. Het gekozen eindtijdstip van het vergelijkingsvenster is modeltijd. Alleen meetpunten binnen dat venster en de geldige simulatietijd tellen mee; er wordt niet geëxtrapoleerd. De app interpoleert tussen simulatiewaarden en rapporteert per hoek de wortel uit de gemiddelde kwadratische hoekfout (RMSE). Hoekverschillen worden over de kortste boog genomen, zodat bijvoorbeeld `179°` en `-179°` slechts `2°` verschillen.

De hoekinterpolatie gebruikt de uitvoer van 100 Hz. Haar fout bij tussenliggende meettijdstippen is niet inbegrepen in de controle **Halve tijdstap**; houd daar bij snelle beweging rekening mee.

Pas een tijdsverschuiving alleen toe om een bekende loslaat- of cameravertraging te corrigeren en documenteer de keuze. Een achteraf passend gemaakte tijdnul of demping is kalibratie; beoordeel een voorspelling daarna met een andere proef.

De simulatie-CSV bevat tijd, hoeken, hoeksnelheden, posities, energie, beide krachten en gedissipeerde energie. De geëxporteerde posities gebruiken `x` naar rechts en `y` **omhoog**, met de oorsprong in het ophangpunt. Dit verschilt van de gebruikelijke beeldcoördinaten hierboven. Parameters, modelkeuze en proefcontext staan in het aparte JSON-bestand. Het opnieuw importeren van simulatiedata test de gegevensroute, maar levert geen onafhankelijke experimentele validatie.

In touwmodus heten de krachtkolommen `tension1_N` en `tension2_N`. In stangmodus zijn dit `axial_reaction1_N` en `axial_reaction2_N`, aangevuld met `reaction1_x_N`, `reaction1_y_N`, `reaction2_x_N` en `reaction2_y_N` voor de volledige scharnierreacties. Ook voor de krachten is `x` naar rechts en `y` omhoog. De geometrie, stangmassa's en modelkeuze staan in JSON; bewaar dat bestand bij de CSV.

## Bewegingspaden uit video naast de simulatie

In **De meting naast het model** laad je een aparte pad-CSV:

```csv
t_video_s,frame,valid,x1_px,y1_px,x2_px,y2_px
0,0,1,95,210,-55,258
0.033333,1,0,,,,
0.066667,2,1,94,211,-56,259
```

Dit zijn beeldposities ten opzichte van het gevolgde bovenste draaipunt: x naar rechts, y naar beneden. De interface draait alleen de y-as om voor de grafiek. `valid=0` bewaart een afgekeurd beeld als onderbreking; lijnen worden ook onderbroken bij ontbrekende framenummers. De meetbaan wordt niet uit modelhoeken of aangenomen stanglengtes gereconstrueerd.

Links staat de meting in pixels, rechts het berekende pad in meters, met onafhankelijke asschalen. Na invullen van een bekende cameraschaal in px/m kunnen beide grafieken dezelfde meterschaal gebruiken en kun je de meting gestippeld over de modelbaan leggen. Een optionele positieve hoekcorrectie draait de meetcoördinaten tegen de klok in (x rechts, y omhoog). Dit is een rotatie en uniforme schaal, geen perspectiefcorrectie.

De modeltijd is `(videotijd - gekozen starttijd) / factor`. Factor 1 neemt normale snelheid aan. Voor de aangeleverde opname is 240 fps genoemd en het ontvangen bestand speelt op 30 fps, maar de vertraging is niet bevestigd. Factor 8 is daarom uitsluitend een scenario, geldig als alle opnameframes een-op-een behouden zijn. Gebruik geen passende factor als bewijs van fysieke overeenstemming.

De markerfracties bepalen waar het te vergelijken modelpunt op iedere stang ligt, gemeten vanaf het bovenste scharnier van die stang: 0 = begin, 1 = einde. Punt 2 telt de volledige lengte van stang 1 mee. De groene stip in de video ligt vóór het fysieke einde; meet haar fractie. Deze instelling wijzigt alleen het getekende modelpunt, niet de massa of de bewegingsvergelijkingen. De twee gevolgde stippen zijn nog geen geïdentificeerde massamiddelpunten.

Het gekozen tijdvenster wordt beperkt tot de overlap van meting en geldige simulatie. De grafieken tonen een ruimtelijk pad over dat hele venster; zij volgen niet de afspeelcursor. Er wordt geen ruimtelijke foutscore of automatische kalibratie berekend. De vergelijkingsinstellingen komen mee in de proef-JSON; het meetbestand moet opnieuw lokaal worden geladen.

Het lokale script `analysis/render_trails.py` maakt, na `track_video.py` en `report_video.py`, een MP4 met de recente sporen, een volledige padgrafiek en `bewegingspaden.csv`. Historische markerposities worden alleen voor de gemeten verschuiving van het bovenste draaipunt gecorrigeerd. Bronvideo en meetgegevens staan onder `.local-data/` en worden niet automatisch gepubliceerd.

## Faseruimte, divergentie en de fithelling

De gebruiker heeft bevestigd dat de aangeleverde voorbeeldgrafiek op **één opname** berust. Daarin wisselt de blauwe `ln(delta(t)/delta0)` sterk en is visueel geen langdurig stijgend, ongeveer recht gebied te zien. De rode lijn past alleen een kort beginsegment en vermeldt `2,4544 s⁻¹`. Zonder de bronreeksen, norm, tijdskalibratie en fitkeuze is dat getal niet reproduceerbaar. De app probeert dit getal niet te bereiken.

| Analyse | Wat wordt vergeleken? | Wat betekent de helling? |
| --- | --- | --- |
| Eén meetreeks | Nabije toestanden op verschillende momenten in dezelfde opname, daarna in de tijd gevolgd | Verkennende gemiddelde divergentie over een eindig venster |
| Twee simulaties | De hoofdbaan en de bijna gelijke tweede beginvoorwaarde | Groei of afname van dit specifieke verschil; geen maximale Lyapunov-exponent |
| Meting tegenover model | Gemeten toestand en voorspelde toestand op overeenkomstige tijdstippen | Modelafwijking, inclusief meet-, kalibratie- en parameterfouten; geen Lyapunov-exponent |

Gebruik in **Divergentie & Lyapunov-fit** de keuze **Eén opname · nabije toestanden** en laad lokaal een hoek-CSV met `t,theta1_deg,theta2_deg`, bijvoorbeeld `hoeken-videotijd.csv`. De pixel-CSV met bewegingspaden is een ander formaat. Kies het bewegende deel van de opname, normtijd, snelheidsvenster, buurcriteria en fitinterval; klik na wijzigingen op **Analyseer divergentie**. De grafiek gebruikt bij één opname de verstreken volgtijd vanaf ieder buurpaar, niet de absolute videotijd. De blauwe curve is een gemiddelde en hoeft dus niet zo grillig te zijn als de aangeleverde afbeelding.

De instellingen `13,5–70` videoseconden, snelheidsvenster `11` punten, Theiler-venster `6`, volghorizon `0,5`, beginafstand `0,05–0,2` en fitvenster `0,1–0,4` zijn verkennende voorbeelden voor de huidige opname. De tijdvensters staan op de gekozen analyse-tijdas, behalve het analysebegin/-einde en de maximale tijdstap tussen meetpunten, die in oorspronkelijke CSV-seconden staan. Deze instellingen vormen geen vastgestelde kalibratie of optimale fitkeuze. De minimumafstand is geen gemeten ruisvloer.

Je kunt de grafiek als SVG, de divergentiepunten als CSV en het analyserapport als JSON downloaden. **Herstel analyserapport** zet de instellingen terug; het JSON-rapport bevat geen ruwe meetreeks, dus laad de oorspronkelijke lokale hoek-CSV opnieuw. Ook het gewone proefbestand bewaart de analyse-instellingen. Gebruik **Videotijd · fysieke schaal onbekend** met factor 1 totdat een omzetting is bevestigd; **Scenario** laat een onbevestigde omzetting expliciet onderzoeken. Een keuze in de interface bewijst niet dat de tijdschaal klopt.

Voor de reeds gevolgde practicumvideo reproduceert `node analysis/analyze_divergence.mjs .local-data/video-analyse` de lokale analyse uit `tracking-raw.csv`, `tracking-quality.csv` en `hoeken-videotijd.csv`. De bestanden `faseruimte-divergentie.json`, `.csv` en `.svg` blijven in die lokale map. Het afzonderlijke `faseruimte-instellingen.json` is geschikt voor **Herstel analyserapport**: herstel dit eerst en laad daarna `hoeken-videotijd.csv`. Het uitgebreide `faseruimte-divergentie.json` is het onderzoeksrapport, geen importbestand voor de interface. Het script gebruikt de oorspronkelijke framekwaliteit en dezelfde hoekafronding als de browserimport. Het vergelijkt ook andere snelheidsvensters, een langer Theiler-venster en een kleinere maximale beginafstand. Het heeft geen bronvideo of meetwaarden in de programmacode ingebouwd.

Er is geen afzonderlijke importmodus voor twee experimentele herhalingen. Voor een dergelijke proef zijn twee zelfstandig gemeten, bijna gelijke begintoestanden en dezelfde kalibratie nodig; een simulatie geldt niet als tweede experiment.

### De afstand heeft een vaste definitie

De volledige toestand gebruikt beide absolute hoeken en beide hoeksnelheden. Hoeken staan intern in radialen; snelheden in radialen per gebruikte seconde. Een vooraf gekozen positieve tijdschaal `tau` maakt hun bijdrage aan de afstand vergelijkbaar:

```text
delta(a,b) = sqrt(wrap(theta1a-theta1b)^2 + wrap(theta2a-theta2b)^2
                  + (tau*(omega1a-omega1b))^2 + (tau*(omega2a-omega2b))^2)
```

`wrap` neemt het kortste hoekverschil modulo `2*pi`. Een gelijke stand na een volledige omwenteling is dus dezelfde hoekpositie; de snelheden kunnen toch verschillen. `tau` blijft constant voor alle punten en analyses die je onderling vergelijkt. De app schaalt de componenten niet automatisch met hun gemeten spreiding. Een andere `tau` kan andere buren en andere eindige-vensterhellingen geven: noteer haar waarde en controleer deze gevoeligheid.

Voor de huidige video zijn dit **beeldhoeken tussen gevolgde markeringen**. De markercentra zijn niet onafhankelijk als mechanische draaipunten geïdentificeerd; camerahoek en perspectief zijn ook niet gekalibreerd. De vier getallen vormen daarom een benadering van de fysieke toestand, geen bevestigde meting van de volledige mechanische faseruimte.

### Eén opname: nabije toestanden volgen

De aanpak is geïnspireerd op [Rosenstein, Collins & De Luca, *A practical method for calculating largest Lyapunov exponents from small data sets* (1993)](https://delucafoundation.org/download/bibliography/cjd/056.pdf). Die methode zoekt nabije toestanden buiten een uitsluitingsvenster in de tijd, volgt hun afstanden en fit het gemiddelde van de logafstanden in een ongeveer lineair groeigebied. Het artikel benadrukt een aanvankelijke overgang en latere verzadiging; die zijn niet hetzelfde als het gebied waaruit een exponent wordt geschat.

Deze app gebruikt rechtstreeks de vier geschatte toestandcomponenten, geen delay-embedding van één scalar. Het is daarom een toepassing van het idee, geen ongewijzigde reproductie van het oorspronkelijke algoritme. De belangrijkste uitvoer is:

```text
Y(k) = gemiddelde over dezelfde paren j van ln(delta_j(k)/delta_j(0))
Y(k) ≈ intercept + helling * verstreken_tijd
```

Elk paar bestaat uit twee nabije toestanden die in de opname voldoende ver uit elkaar liggen. Het **Theiler-venster** sluit directe temporele buren uit; kies het met kennis van de karakteristieke oscillatietijd en controleer meerdere verdedigbare waarden. Een te klein venster kan vooral opeenvolgende punten op dezelfde baan selecteren. Een naaste buur is bovendien niet noodzakelijk dichtbij genoeg voor lokale exponentiële groei.

De paren moeten over de hele gevraagde volgduur bruikbaar zijn. Een vaste groep voorkomt dat de gemiddelde curve verandert doordat op latere tijden andere paren overblijven. Bij dezelfde groep verschilt het gemiddelde van de logratio's alleen door een constante van het gemiddelde van de logafstanden, zodat beide dezelfde vrije fithelling geven. Dit is niet hetzelfde als de logaritme van een gemiddelde afstand. De vaste selectie kan wel lange, goed gevolgde stukken bevoordelen; controleer de dekking en de beginafstanden.

Hoeksnelheden uit video versterken meetruis. De app schat ze met de helling van een lokale lineaire regressie over een volledig, gecentreerd oneven puntenvenster. De gemeten hoeken zelf worden niet gladgestreken; de randpunten zonder volledig venster vallen af. Er wordt geen snelheid door een gat heen afgeleid. De hoekontwikkeling gebruikt de kortste stap tussen opeenvolgende geldige frames; een werkelijke draai van meer dan 180° tussen frames is daarmee niet eenduidig te reconstrueren. Varieer de vensterbreedte: filteren verwijdert niet alleen ruis en kan de divergentie veranderen.

De volglags gebruiken de mediane meettijdstap. Interpolatie vindt uitsluitend binnen ononderbroken segmenten plaats en levert geen nieuwe onafhankelijke waarnemingen op. Er worden maximaal 250 verschillende ongeordende paren gevolgd, met minimaal 10 paren als softwarevoorwaarde; die aantallen zijn geen statistische kwaliteitsgarantie. Nulafstanden krijgen geen epsilon: als voor een paar de logaritme ongedefinieerd is, wordt het hele gemiddelde op die lag ongeldig, in plaats van met een andere groep verder te middelen. Een fit mag niet over zo'n ontbrekend punt of een meetgat lopen.

### Interpretatie en tijdseenheid

De rechte lijn heeft een vrije intercept en is alleen een kleinste-kwadratenfit binnen het aangegeven venster. Haar helling kan positief, nul of negatief zijn. Een positieve helling of een hoog `R²` is op zichzelf geen bewijs van chaos; opeenvolgende curvepunten en paren zijn gecorreleerd, dus het aantal punten is geen aantal onafhankelijke proeven. Zoek geen venster uitsluitend omdat het een positieve helling of `2,4544` oplevert. Controleer vroege meetruis, overgangsgedrag, verzadiging, het gekozen venster en reproduceerbaarheid.

Bij normalisatie op de beginafstand is `Y(0)=0`. De vrije fitlijn hoeft niet door dat punt te gaan. De fithelling is ook niet per definitie `ln(delta(t)/delta0)/t`. Een maximale Lyapunov-exponent vereist aanvullende onderbouwing voor de limiet van kleine verstoringen en lange tijden; deze interface toont eindige-vensterresultaten.

De echte opname dempt uit en doorloopt daardoor veranderende bewegingsregimes. Eén gemiddelde over de hele opname kan vooral de late beweging bij rust beschrijven; behandel dit niet als een stationaire chaotische attractor. Een vlakke of dalende curve bewijst evenmin dat iedere andere beginstand of ieder ander tijdvenster niet-chaotisch is.

Zolang de vertraging niet vaststaat, heeft een videofit de eenheid **per videoseconde**. Als later `t_fysiek = t_video/f` wordt bevestigd, geldt voor exact dezelfde logafstandsreeks `helling_fysiek = f * helling_video`. Om dezelfde vierdimensionale norm te behouden moet dan ook `omega_fysiek = f * omega_video` en `tau_fysiek = tau_video/f` gelden. Deel voor dezelfde analyse ook het Theiler-venster, de horizon en de fitgrenzen door `f`; de velden in oorspronkelijke CSV-seconden blijven gelijk. Alleen de snelheden herschalen en `tau` gelijk laten verandert de norm en mogelijk de gekozen buren. De opgegeven 240 opnamefps bij 30 afspeelfps rechtvaardigt factor 8 pas als de framebewaring en afspeelvertraging zijn bevestigd.

## Rekenmodel

Het systeem is tweedimensionaal met een vast ophangpunt. Voor touw zijn de verbindingen massaloos en onrekbaar. Voor stangen is de massaverdeling uniform, met het massamiddelpunt op halve lengte en traagheidsmoment `r s²/12` om het eigen massamiddelpunt. De optionele puntmassa's zitten op het tussenpunt en het onderste eindpunt. Zie ook [Neumann, *Double Pendulum as Rigid Bodies* (2011)](https://www.myphysicslab.com/develop/docs/Rigid_Double_Pendulum.pdf) voor de afleiding met uitgebreide lichamen. Hieronder zijn hoeken in radialen, `w1 = d(theta1)/dt`, `w2 = d(theta2)/dt` en `q = theta1 - theta2`.

Neem `r1 = rodMass1` en `r2 = rodMass2` in stangmodus, en `r1 = r2 = 0` in touwmodus. Dan gelden:

```text
A = (m1 + m2 + r2 + r1/3) s1²
B = (m2 + r2/2) s1 s2
C = (m2 + r2/3) s2²
H1 = (m1 + m2 + r2 + r1/2) g s1
H2 = (m2 + r2/2) g s2

M = [[A, B cos(q)], [B cos(q), C]]
b1 = -B sin(q) w2² - H1 sin(theta1) - c1 w1 + c2 (w2 - w1)
b2 = +B sin(q) w1² - H2 sin(theta2) - c2 (w2 - w1)
M · [a1,a2]ᵀ = [b1,b2]ᵀ
```

De beweging wordt met vierde-orde Runge–Kutta (RK4) geïntegreerd. De interne stap is maximaal `dt/2` en kan voor stabiliteit of uitvoertijdstippen verder worden verkleind. Uitvoer verschijnt om de `0,01 s`, aangevuld met het eindpunt of de modelgrens. In touwmodus betekent positieve spanning trek; een gevonden overgang naar negatieve spanning wordt binnen de betreffende tijdstap verfijnd voordat de simulatie stopt. In stangmodus is negatieve axiale reactiekracht toegestaan en stopt de berekening daar niet. Herhaal met een kleinere tijdstap wanneer een stoptijd van belang is: een eindige stapgrootte blijft een numerieke benadering.

Bij stangen zijn de krachten de **axiale projecties van de reactie aan het boveneinde van elke stang**. Reactie 1 hoort bij het vaste ophangpunt; reactie 2 is de kracht van het bovenste op het onderste deel in het tussenliggende scharnier. Positief wijst langs de stang naar de bovenliggende ophanging, negatief ervan af. Dit is geen uniforme axiale belasting langs de hele stang en geen materiaalspanning of sterkteberekening. De werkelijke scharnierreactie kan ook een dwarscomponent hebben.

De mechanische energie, met het nulpunt in de laagste stand, is:

```text
E = 0.5 A w1² + 0.5 C w2² + B cos(q) w1 w2
    + H1 (1 - cos(theta1)) + H2 (1 - cos(theta2))

dD/dt = c1 w1² + c2 (w2 - w1)²
```

Zonder demping blijft `E` theoretisch constant; met demping blijft `E + D` constant. Numerieke energieafwijking en fysiek energieverlies zijn verschillende zaken.

Het percentage **Energiebalans** is de grootste waargenomen afwijking van `E + D` ten opzichte van de beginenergie, gedeeld door `max(E_begin, H1 + H2, 10^-12 J)`. Deze energieschaal voorkomt een misleidend groot percentage wanneer de beginenergie bijna nul is. **Halve tijdstap** vergelijkt de grootste positieafwijking van tussenpunt en onderste eindpunt tussen `dt` en `dt/2` op gezamenlijke uitvoertijdstippen; het is geen foutgrens voor het experiment.

De interface waarschuwt als die positieafwijking groter is dan 1% van `s1+s2`. Dit is een praktische signalering van numerieke afwijking, geen criterium waarmee een echte proef wordt goedgekeurd. Een goede energiebalans kan samengaan met een sterk afwijkende lange baan; verkort dan het vergelijkingsvenster en onderzoek verdere stapverfijning.

`c1` en `c2` modelleren viscose koppeldemping aan respectievelijk de bovenste rotatie en de relatieve rotatie tussen beide delen. Bij stangen zijn dit zuivere koppels aan de scharnieren. Voor losse touwen is dit een fenomenologische benadering, geen letterlijk scharnier of volledig luchtweerstandsmodel. Begin met nul en bepaal eventuele demping uit afzonderlijke, rustige proeven.

Niet meegenomen: touwrek en touwmassa; buiging of knikken van stangen; afwijkende massaverdeling; eindige afmetingen en eigen rotatie van extra gewichten; botsingen, knopen, steunbeweging, driedimensionale beweging, volledige luchtweerstand en de dynamica na slap touw. De getekende diktes en bolgroottes zijn illustratief en vormen geen botsingsmodel.

## Bestanden en delen

De broncode wordt beheerd in de repository [evdmaaten/dubbele-slinger](https://github.com/evdmaaten/dubbele-slinger). De map bevat de bewerkbare broncode, tests, dit meetprotocol en het gegenereerde `standalone.html`. Download de repository via **Code → Download ZIP**, pak die uit en open het losse HTML-bestand. Het model kan ook op een andere computer lokaal worden geopend; webhosting is niet nodig.

De app verwerkt geïmporteerde meetgegevens in de browser; ze worden niet automatisch geüpload. Bewaar echte proefgegevens bewust samen met video, ruwe metingen, geëxporteerde simulatie en proefinstellingen. De JSON-import herstelt de modelinstellingen, niet de oorspronkelijke meet-CSV: laad die apart opnieuw in. Proefbestanden gebruiken schema `dubbele-slinger/v2`; eerdere `v1`-bestanden worden als touwproef ingelezen.
