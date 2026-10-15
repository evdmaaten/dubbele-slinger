# Numerieke controle — dubbele slinger

Controle uitgevoerd op 15 oktober 2026, met Node.js `v24.11.1` op Windows. De waarden hieronder zijn uit de JavaScript-rekenkern berekend. Ze beschrijven de software en het ideale model, niet een gemeten fysieke proef.

**Numerieke controle: geslaagd binnen de geteste gevallen. Experimentele validatie: nog niet uitgevoerd.** Er zijn geen videometingen of andere echte meetreeksen gebruikt. Overeenkomst met een praktische opstelling, en de duur waarover die overeenkomst bruikbaar is, zijn dus nog onbekend.

## Wat is gecontroleerd

De volledige testuitvoering met `npm test` (`node --test`) eindigde met **22 geslaagde tests, 0 fouten en 0 overgeslagen tests**: 14 tests van de fysica en 8 tests van de gegevensverwerking. De gecontroleerde eigenschappen zijn:

- Stilhangende gewichten blijven stil; de bovenste spanning is `(m1+m2)g`, de onderste `m2g`.
- De massamatrix geeft zonder demping dezelfde hoekversnellingen als een onafhankelijk geformuleerde, expliciete afleiding, over 80 verschillende toestanden.
- De berekende spanningen en versnellingen voldoen aan de horizontale en verticale wetten van Newton, inclusief de gedefinieerde dempingskrachten.
- Energie en beide lengtes blijven behouden zonder demping. Met demping daalt de mechanische energie en blijft `E + gedissipeerde energie` behouden binnen numerieke tolerantie.
- De twee kleine-hoekmodi bij gelijke massa's en lengtes volgen de analytische frequenties `omega² = (g/s)(2 ± sqrt(2))`.
- Een onmogelijke gespannen beginstand stopt op tijdnul; een later verlies van touwspanning wordt verfijnd en beëindigt de uitvoer.
- Spiegeling van de beginstand spiegelt de beweging. Alle massa's met dezelfde factor vermenigvuldigen verandert de ongedempte baan niet, maar schaalt spanning en energie wel.
- Halveren van de RK4-stap verbetert een niet-lineaire referentieberekening ongeveer volgens vierde orde.
- De controle met halve tijdstap verfijnt ook daadwerkelijk wanneer een extra stabiliteitslimiet de interne stap bepaalt, zoals bij korte touwen met lichte gewichten en sterke demping.
- CSV-invoer, decimale komma's, hoekinterpolatie, volledige omwentelingen, tijdsverschuiving en export worden gecontroleerd. Gegevens buiten het tijdvenster worden uitgesloten; geen overlap levert geen misleidende nul-RMSE.
- Ongeldige parameters en onbruikbare meetrijen geven expliciete fouten.

Tests tonen gedrag voor de onderzochte gevallen. Ze zijn geen bewijs dat iedere mogelijke parametercombinatie nauwkeurig is, en geen meting van echte touwspanning of luchtweerstand.

## Referentie-instellingen

Tenzij in de tabel anders vermeld:

```text
s1 = s2 = 0,5 m
m1 = m2 = 0,2 kg
g = 9,81 m/s²
c1 = c2 = 0
omega1 = omega2 = 0 °/s
duur = 20 s
dt = 0,001 s
```

De maximale interne RK4-stap is hierbij `0,0005 s`. Er wordt om de `0,01 s` een uitvoerpunt bewaard, plus een eventueel eerder stoppunt. De nominale volledige runs bevatten 2.001 uitvoerpunten.

## Berekende uitkomsten

| Geval | Beginhoeken θ₁ / θ₂ | Uitkomst | Kleinste T₁ | Kleinste T₂ | Max. energiebalansfout |
| --- | --- | --- | ---: | ---: | ---: |
| Standaard | 25° / −15° | Volledige 20 s | 2,516567 N | 0,871985 N | 1,25 × 10⁻¹² J |
| Kleine uitslag | 5° / 0° | Volledige 20 s | 3,865430 N | 1,918015 N | 9,93 × 10⁻¹⁵ J |
| Grote uitslag | 60° / 25° | Volledige 20 s | 1,422774 N | 0,468935 N | 5,32 × 10⁻¹² J |
| Slap touw | 80° / 20° | Touw 2 bereikt nul bij 0,9653572165 s | 0,389369 N | ≈ 0 N | 1,81 × 10⁻¹¹ J |
| Ongeldige start | 120° / −10° | Directe stop op 0 s; geen baan | −1,236432 N | 0,397382 N | Niet van toepassing |

De energiebalansfout is `max(abs(E(t) + D(t) - E(0)))` over de gecontroleerde stappen. De spanningsextremen zijn numeriek bemonsterde extremen, geen analytisch bewezen continue minima. Bij het verfijnde stoppunt kan de gerapporteerde spanning door afronding zeer klein negatief zijn; in de gecontroleerde run ongeveer `−1,24 × 10⁻¹¹ N`.

Voor de standaardrun was de beginenergie `0,2172508862445 J` en de eindenergie `0,2172508862439 J`. De energie-indicator gebruikt een energieschaal van `2,943 J`, waardoor de gerapporteerde relatieve balansfout `4,24 × 10⁻¹³` is, of `4,24 × 10⁻¹¹ %`. Dit is een numerieke balansfout, geen percentage experimentele nauwkeurigheid.

Een extra run met standaardhoeken en `c1 = c2 = 0,001 N·m·s/rad` gaf na 20 s:

| Grootheid | Waarde |
| --- | ---: |
| Beginenergie | 0,2172508862445 J |
| Mechanische eindenergie | 0,0495913493345 J |
| Gedissipeerde energie | 0,1676595369106 J |
| Grootste fout in `E + D` | 8,47 × 10⁻¹³ J |

Die dempingscoëfficiënten zijn alleen testwaarden. Ze zijn niet uit de echte opstelling bepaald.

## Controle met halve tijdstap

Dezelfde beginwaarden zijn doorgerekend met `dt = 0,001 s` en `dt = 0,0005 s`. De positieafwijking is het maximum over beide gewichten, op gezamenlijke uitvoertijdstippen.

| Geval | Gemeenschappelijke looptijd | Grootste positieafwijking | Verschil in stoptijd |
| --- | ---: | ---: | ---: |
| Standaard, 25° / −15° | 20 s | 4,91 × 10⁻¹¹ m | Niet van toepassing |
| Grote uitslag, 60° / 25° | 20 s | 6,02 × 10⁻¹¹ m | Niet van toepassing |
| Slap touw, 80° / 20° | Tot circa 0,9653572165 s | 5,48 × 10⁻¹² m | 7,48 × 10⁻¹² s |

De zeer kleine verschillen laten zien dat deze voorbeelden bij de gekozen stappen numeriek stabiel overeenkomen. Ze betekenen niet dat lengtes, beginhoeken of loslaatmomenten in een proef zo nauwkeurig bekend zijn. Ook het bisectiecriterium van `10⁻¹¹ s` voor een gevonden spanningsnul is alleen de breedte van een numeriek tijdsinterval, geen fysieke nauwkeurigheidsgarantie.

Voor een meetpunt tussen uitvoertijdstippen gebruikt de app lineaire interpolatie van hoeken uit de uitvoer van 100 Hz. Deze interpolatiefout is niet opgenomen in de positieafwijking tussen `dt` en `dt/2`. Bij snelle beweging kan deze groter zijn dan de integratiefout uit de tabel. Ook de getekende animatie tussen uitvoerpunten is een interpolatie.

Bij sterke gevoeligheid voor beginvoorwaarden kunnen ook kleine afrondings- en integratiefouten op langere termijn groeien. Beoordeel daarom een vooraf gekozen kort venster en herhaal de convergentiecontrole voor de werkelijk gebruikte instellingen.

## Zelf reproduceren

Start de tests in de projectmap:

```powershell
npm test
```

De kernresultaten zijn ook rechtstreeks op te vragen zonder browser:

```powershell
node --input-type=module -e "import {simulate,compareConvergence} from './physics.js'; const r=simulate(); console.log(r.status,r.diagnostics); const s=simulate({theta1:80,theta2:20}); console.log(s.event); const c=compareConvergence(); console.log(c.maxPositionDifference);"
```

Gebruik de presets in de interface voor dezelfde standaard-, kleine-, grote- en slap-touwproeven. Bewaar voor een eigen proef zowel de CSV als de JSON met instellingen en controles.

De gecontroleerde bronbestanden hadden de volgende SHA-256-hashes. Na bronwijzigingen moeten de tests en referentie-uitkomsten opnieuw worden vastgesteld.

```text
physics.js
90E3AB8F97C929A45A9C50DA6C4558C65A59CA24DC5038B778DD10D88B57000D
measurements.js
7292E3C042547269CA0C26CD6FE0BB599115BDE9D25C10B2F38E5189F73FDD3C
tests/physics.test.js
B44D0130F0E42C290E3D9ED381A2A8C36571CC74AE1FD43C2729F459BA5FF598
tests/measurements.test.js
7BB212BA73BFDB557DE7B096220DEA8886B7FBD329ED46F6577EEA8A0BD62522
```

## Controle van de interface

De bronversie en de gegenereerde zelfstandige HTML zijn in Chrome via een lokale HTTP-preview geopend en visueel gecontroleerd. Afspelen, pauzeren, tijdschuif en het slap-touwvoorbeeld werken. De interface stopt bij touw 2 op circa 0,9654 s.

De echte downloadknoppen leverden een CSV van 468.798 bytes en een compacte JSON van 2.199 bytes voor de standaardproef. Na wijziging van s1 naar 0,7 m herstelde het ingelezen JSON-bestand de instelling tot 0,5 m. Het opnieuw inladen van de geëxporteerde simulatie-CSV gaf over 0–5 s 501 vergelijkingspunten, 1500 uitgesloten punten en RMSE 0,000° voor beide hoeken. Dit is een synthetische controle van de gegevensroute, geen vergelijking met echte metingen. De testgegevens zijn daarna uit de interface gewist.

De zelfstandige HTML bevat geen externe HTML/CSS-resources. De ingebedde modules zijn syntactisch gecontroleerd en werken in de lokale preview. Rechtstreekse geautomatiseerde controle via een file-URL is door de browsertool geblokkeerd; dubbelklikken op het bestand is daarom niet afzonderlijk geverifieerd. Er zijn geen browserinstellingen veranderd om deze beperking te omzeilen.

## Wat nog door de echte proef moet worden vastgesteld

Meet eerst lengte, massa, beide beginhoeken en het loslaatmoment met hun onzekerheden. Film de kleine uitslagen en vergelijk de vroege hoekcurven, periodes en fase. Bepaal vervolgens eventueel demping uit aparte proeven en controleer met een nieuwe proef of die kalibratie voorspelt wat er gebeurt.

Bij grote uitslagen moeten vooral vlakke beweging, blijvende touwspanning en rotatie van de gewichten worden gecontroleerd. Als een touw slap wordt, eindigt dit model; de vervolgbeweging kan met deze versie niet worden voorspeld. Er is geen universele RMSE-grens gekozen die een echte proef automatisch goedkeurt.

Volg het [meetprotocol in README.md](README.md). Een vergelijking met een opnieuw ingelezen simulatie-CSV controleert alleen de softwaregegevensroute en telt niet als onafhankelijke experimentele validatie.
