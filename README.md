# Dubbele slinger — simulatie en proefvergelijking

Interactief model van twee losse gewichten aan twee touwtjes, gebaseerd op de aangeleverde schets. Stel de lengtes, massa's en begintoestand in; bekijk de beweging en vergelijk voorspelde hoeken met videometingen van de echte opstelling.

**Het model geldt alleen zolang beide touwtjes strak staan.** Een touw kan trekken, maar niet duwen. De berekening stopt zodra de benodigde spanning negatief zou worden. Slap touw, vrije vlucht en de schok bij opnieuw strak trekken zijn nog niet gemodelleerd. Een start met negatieve spanning wordt meteen afgewezen.

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

Zie [VALIDATIE.md](VALIDATIE.md) voor de uitgevoerde numerieke controles en referentie-uitkomsten. Een geslaagde softwaretest is geen validatie tegen de fysieke opstelling. Er zijn nog geen echte meetresultaten geleverd waarmee overeenkomst met de werkelijkheid kan worden vastgesteld.

## Instellingen en conventies

| Grootheid | Eenheid | Betekenis |
| --- | --- | --- |
| `s1` | m | Afstand van het vaste ophangpunt tot puntmassa 1 |
| `s2` | m | Afstand van puntmassa 1 tot puntmassa 2 |
| `m1`, `m2` | kg | Massa van het eerste en tweede gewicht |
| `theta1`, `theta2` | graden | Absolute hoek van elk touw ten opzichte van verticaal omlaag |
| `omega1`, `omega2` | graden/s | Beginsnelheid van de twee hoeken |
| `g` | m/s² | Zwaartekrachtsversnelling |
| `c1`, `c2` | N·m·s/rad | Optionele coëfficiënten voor het koppeldempingsmodel |
| `dt` | s | Tijdstap van de integrator; geen videoframetijd |
| duur | s | Gevraagde simulatieduur; kan door slap touw korter worden |

Positieve hoeken wijzen naar rechts vanaf de neerwaartse verticaal. `theta2` is dus **niet** de hoek tussen de twee touwen. De plaats van massa 2 volgt uit de som van beide touwvectoren. De rekenkern gebruikt radialen, meters, kilogrammen en seconden.

De standaardwaarden zijn voorbeelden, geen gemeten eigenschappen van jouw opstelling. Meet en voer de werkelijke waarden in voordat je een voorspelling beoordeelt.

De tweede, bijna gelijke simulatie begint met een kleine hoekverstoring. Het verschil tussen beide banen laat gevoeligheid voor de begintoestand zien. Dit is geen berekende Lyapunov-exponent en bewijst op zichzelf geen chaos. Bij kleine uitwijkingen is het gedrag vaak bijna lineair; ook andere begintoestanden kunnen regelmatig bewegen. Grote hoeken geven bij touwen bovendien eerder een overgang naar slap touw. Zie de [oorspronkelijke modelafleiding van myPhysicsLab](https://www.myphysicslab.com/pendulum/double-pendulum-en.html).

## Wat je uit de interface kunt halen

- Animatie van de hoofdsimulatie en de bijna gelijke tweede simulatie.
- Hoeken, energie, touwspanningen en afstand tussen de twee onderste gewichten als functie van de tijd.
- Import van gemeten hoeken en vergelijking binnen een gekozen tijdvenster.
- Export van simulatiewaarden als CSV en proefinstellingen als JSON.
- Herstellen van instellingen uit een eerder geëxporteerd JSON-proefbestand; de beweging wordt opnieuw berekend.

De twee simulaties kunnen op verschillende tijdstippen stoppen. Vergelijk hun afwijking alleen zolang ze allebei geldig zijn. Een grote afstand op een laat tijdstip zegt weinig over de meetnauwkeurigheid aan het begin.

## Praktisch meetprotocol

1. **Leg de geometrie vast.** Weeg beide gewichten inclusief bevestigingsmateriaal dat meebeweegt. Meet met strak touw van ophangpunt tot het massamiddelpunt van gewicht 1, en van massamiddelpunt 1 tot massamiddelpunt 2. Noteer meetonzekerheden, knopen en bevestigingsafstanden. Gebruik niet alleen de afgeknipte touwlengte.
2. **Controleer de puntmassabenadering.** Het model laat beide touwen bij het massamiddelpunt van gewicht 1 samenkomen. Als de touwen op verschillende plaatsen aan een groot gewicht vastzitten, kan dat gewicht draaien. Alleen een aangepaste effectieve lengte maakt dit niet exact. Noteer dit als modelafwijking; bij duidelijke rotatie is een model met uitgebreide lichamen nodig.
3. **Film in één vlak.** Zet de camera vast, loodrecht op het bewegingsvlak. Houd ophangpunt en beide massamiddelpunten in beeld en plaats een maatlat in hetzelfde vlak. Gebruik voldoende licht en een korte belichting om bewegingsonscherpte te beperken. Controleer de werkelijke tijdstempels of beeldfrequentie van de video.
4. **Begin klein.** Kies kleine uitwijkingen, bijvoorbeeld enkele graden, en laat los zonder extra zet. Doe eerst een reeks met ongeveer dezelfde beginstand. Controleer periodes, onderlinge fase en het doorgeven van beweging tussen de gewichten. Kijk of de touwen strak blijven en de beweging in het beeldvlak blijft.
5. **Bepaal de beginwaarden.** Gebruik het loslaatmoment als tijdnul. Meet beide absolute hoeken. Een onbedoelde beginsnelheid kan de voorspelling sterk veranderen; schat deze uit meerdere opeenvolgende frames als loslaten niet stil gebeurt.
6. **Exporteer de gemeten hoeken.** Volg in elk bruikbaar frame het vaste punt en de twee massamiddelpunten. Importeer de CSV volgens het formaat hieronder. De app bevat geen automatische videotracker.
7. **Controleer de berekening.** Vergelijk een run met tijdstap `dt` met dezelfde run met `dt/2`, vooral in het vroege vergelijkingsvenster. Bij nul demping hoort de energie nagenoeg constant te blijven. Bij demping controleer je de som van mechanische en gedissipeerde energie. Een kleinere tijdstap hoort de numerieke afwijking te verkleinen.
8. **Vergelijk eerst het begin.** Kies vooraf een tijdvenster en een foutmarge die past bij jouw meetonzekerheid. Bekijk beide hoekcurven en hun RMSE. Er is geen universele grens waaronder de proef automatisch geslaagd is. Een systematische fasefout kan bijvoorbeeld op een verkeerde lengte of tijdnul wijzen.
9. **Vergroot daarna de uitwijking.** Herhaal de proef meerdere keren en noteer de kleine verschillen in beginstand. Vergelijk ook kenmerken zoals omslagpunten en de eerste momenten van slap touw. Stop een punt-voor-puntvergelijking waar het model buiten zijn geldigheidsgebied komt.

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

De simulatie-CSV bevat tijd, hoeken, hoeksnelheden, posities, energie, beide touwspanningen en gedissipeerde energie. De geëxporteerde posities gebruiken `x` naar rechts en `y` **omhoog**, met de oorsprong in het ophangpunt. Dit verschilt van de gebruikelijke beeldcoördinaten hierboven. Parameters en proefcontext staan in het aparte JSON-bestand. Het opnieuw importeren van simulatiedata test de gegevensroute, maar levert geen onafhankelijke experimentele validatie.

## Rekenmodel

Het systeem is tweedimensionaal, met een vast ophangpunt, twee puntmassa's en massaloze, onrekbare touwen. In de volgende vergelijkingen zijn hoeken in radialen, `w1 = d(theta1)/dt`, `w2 = d(theta2)/dt` en `q = theta1 - theta2`.

De hoekversnellingen volgen uit `M · [a1,a2]ᵀ = [b1,b2]ᵀ`:

```text
M11 = (m1 + m2) s1²
M12 = M21 = m2 s1 s2 cos(q)
M22 = m2 s2²

b1 = -m2 s1 s2 sin(q) w2² - (m1 + m2) g s1 sin(theta1)
     -c1 w1 + c2 (w2 - w1)
b2 = +m2 s1 s2 sin(q) w1² - m2 g s2 sin(theta2)
     -c2 (w2 - w1)
```

De beweging wordt met vierde-orde Runge–Kutta (RK4) geïntegreerd. De interne stap is maximaal `dt/2` en kan voor stabiliteit of uitvoertijdstippen verder worden verkleind. Uitvoer verschijnt om de `0,01 s`, aangevuld met het eindpunt of de modelgrens. De touwspanningen volgen uit de radiale componenten van de krachtenbalans; positief betekent trek. Een gevonden overgang naar negatieve spanning wordt in de betreffende tijdstap verfijnd voordat de simulatie stopt. Herhaal met een kleinere tijdstap wanneer een stoptijd van belang is: een eindige stapgrootte blijft een numerieke benadering.

De mechanische energie, met het nulpunt in de laagste stand, is:

```text
E = 0.5 (m1 + m2) s1² w1² + 0.5 m2 s2² w2²
    + m2 s1 s2 cos(q) w1 w2
    + (m1 + m2) g s1 (1 - cos(theta1))
    + m2 g s2 (1 - cos(theta2))

dD/dt = c1 w1² + c2 (w2 - w1)²
```

Zonder demping blijft `E` theoretisch constant; met demping blijft `E + D` constant. Numerieke energieafwijking en fysiek energieverlies zijn verschillende zaken.

Het percentage **Energiebalans** is de grootste waargenomen afwijking van `E + D` ten opzichte van de beginenergie, gedeeld door `max(E_begin, (m1+m2) g s1 + m2 g s2, 10^-12 J)`. Deze energieschaal voorkomt een misleidend groot percentage wanneer de beginenergie bijna nul is. **Halve tijdstap** vergelijkt de grootste positieafwijking van beide gewichten tussen `dt` en `dt/2` op gezamenlijke uitvoertijdstippen; het is geen foutgrens voor het experiment.

`c1` en `c2` modelleren viscose koppeldemping aan respectievelijk de bovenste rotatie en de relatieve rotatie tussen beide delen. Voor losse touwen is dit een fenomenologische benadering, geen letterlijk scharnier of volledig luchtweerstandsmodel. Begin met nul en bepaal eventuele demping uit afzonderlijke, rustige proeven.

Niet meegenomen: touwrek, touwmassa, eindige afmetingen en rotatie van de gewichten, botsingen, knopen, steunbeweging, driedimensionale beweging, volledige luchtweerstand en de dynamica na slap touw. De getekende bolgrootte is illustratief en geen botsingsmodel.

## Bestanden en delen

De broncode wordt beheerd in de privérepository [evdmaaten/dubbele-slinger](https://github.com/evdmaaten/dubbele-slinger). De map bevat de bewerkbare broncode, tests, dit meetprotocol en het gegenereerde `standalone.html`. Download de repository via **Code → Download ZIP**, pak die uit en open het losse HTML-bestand. Het model kan ook op een andere computer lokaal worden geopend; webhosting is niet nodig.

De app verwerkt geïmporteerde meetgegevens in de browser; ze worden niet automatisch geüpload. Bewaar echte proefgegevens bewust samen met video, ruwe metingen, geëxporteerde simulatie en proefinstellingen. De JSON-import herstelt de modelinstellingen, niet de oorspronkelijke meet-CSV: laad die apart opnieuw in.
