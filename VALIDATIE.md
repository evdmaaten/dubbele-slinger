# Numerieke controle — dubbele slinger

Controle uitgevoerd op 15 oktober 2026, met Node.js `v24.11.1` op Windows. De waarden hieronder zijn uit de JavaScript-rekenkern berekend. Ze beschrijven de software en het ideale model, niet een gemeten fysieke proef.

**Numerieke controle: geslaagd binnen de geteste gevallen. Experimentele validatie: nog niet uitgevoerd.** Een lokale praktijkvideo is visueel bekeken, maar er zijn geen gekalibreerde videometingen of andere echte meetreeksen gebruikt. Overeenkomst met de praktische opstelling, en de duur waarover die overeenkomst bruikbaar is, zijn dus nog onbekend.

## Wat is gecontroleerd

De volledige testuitvoering met `npm test` (`node --test`) eindigde met **33 geslaagde tests, 0 fouten en 0 overgeslagen tests**: 23 tests van de fysica en 10 tests van de gegevensverwerking. De gecontroleerde eigenschappen zijn:

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
- Touwmodus negeert stangmassa's en behoudt zijn oorspronkelijke baan en stopmoment; massaloze stijve verbindingen geven zolang het touw strak zou staan dezelfde beweging als het puntmassamodel.
- Reactiekrachten van massieve stangen voldoen aan onafhankelijke krachten- en momentenbalansen om de massamiddelpunten, ook met zuivere dempingskoppels.
- Twee gelijke uniforme stangen zonder puntgewichten volgen de analytische kleine-hoekfrequenties `omega² = (g/s)(3 ± 6 sqrt(7)/7)`. Bij verdwijnend kleine massa van de onderste stang wordt de bekende vergelijking van één uniforme fysieke slinger benaderd.
- Stijve stangen bewegen door tijdens drukbelasting en kunnen meerdere volledige omwentelingen maken; ook hun energieverlies sluit aan op de berekende dissipatie.
- CSV-uitvoer voor stangen benoemt axiale en Cartesische reacties expliciet, behoudt negatieve reacties en weigert ontbrekende of niet-eindige reactiecomponenten.

Tests tonen gedrag voor de onderzochte gevallen. Ze zijn geen bewijs dat iedere mogelijke parametercombinatie nauwkeurig is, en geen meting van echte touwspanning of luchtweerstand.

## Referentie-instellingen

Voor de touwreferentie, tenzij anders vermeld:

```text
model = string
s1 = s2 = 0,5 m
m1 = m2 = 0,2 kg
g = 9,81 m/s²
c1 = c2 = 0
omega1 = omega2 = 0 °/s
duur = 20 s
dt = 0,001 s
```

De maximale interne RK4-stap is hierbij `0,0005 s`. Er wordt om de `0,01 s` een uitvoerpunt bewaard, plus een eventueel eerder stoppunt. De nominale volledige runs bevatten 2.001 uitvoerpunten.

## Berekende uitkomsten in touwmodus

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

## Berekende uitkomsten met stijve stangen

De stangmodus rekent uniforme slanke stangen met eigen massa door, inclusief hun traagheidsmomenten. Extra puntmassa's op het tussenpunt en het onderste eindpunt blijven afzonderlijk instelbaar. De volgende runs gebruiken dezelfde lengtes, zwaartekracht, tijdstap en nulbeginsnelheden als boven. `F1` en `F2` zijn de axiale projecties van de reactie aan het boveneinde van elke stang; negatieve waarden zijn toegestaan en veroorzaken geen stop.

| Geval | Stangmassa's r₁ / r₂ | Extra puntmassa's m₁ / m₂ | Beginhoeken | Duur | Min. F1 / F2 | Max. energiebalansfout |
| --- | --- | --- | --- | ---: | --- | ---: |
| Stangen met gewichten | 0,1 / 0,1 kg | 0,2 / 0,2 kg | 25° / −15° | 20 s | 3,915144 / 1,253185 N | 1,92 × 10⁻¹² J |
| Alleen stangen | 0,2 / 0,2 kg | 0 / 0 kg | 25° / −15° | 20 s | 2,676681 / 0,701969 N | 2,89 × 10⁻¹² J |
| Hoge beginstand | 0,1 / 0,1 kg | 0,2 / 0,2 kg | 120° / −10° | 5 s | −1,984663 / −4,704654 N | 1,36 × 10⁻⁹ J |

Alle drie runs voltooiden hun gevraagde duur. In het derde geval liep de ongewikkelde hoek van stang 2 van minimaal ongeveer −139,31° tot maximaal 417,65°: de berekening staat dus een volledige omwenteling toe. Dit toont gedrag van dit gekozen model en bewijst geen chaos of overeenkomst met de praktijkvideo. In touwmodus wordt dezelfde hoge beginstand met de puntmassa's al op `t = 0` afgewezen.

De axiale reacties zijn geen uniforme belasting langs de gehele stang, geen materiaalspanning en geen sterktebeoordeling. Voor stangen met massa bevat de volledige scharnierreactie ook een dwarscomponent.

De interface start met een aanvullende **gedempte voorbeeldproef**: `model = rigid`, stangmassa's `0,2 / 0,2 kg`, puntmassa's `0 / 0 kg`, lengtes `0,5 / 0,5 m`, hoeken `25° / −15°`, `c1 = 0,002`, `c2 = 0,001 N·m·s/rad` en duur `20 s`. Deze run voltooide 20 s; de beginenergie was `0,1545814735808 J`, de mechanische eindenergie `0,0322249410998 J` en de gedissipeerde energie `0,1223565324821 J`. De maximale balansfout was `1,69 × 10⁻¹² J`; de maximale positieafwijking bij halve tijdstap was `2,77 × 10⁻¹¹ m`. Dit is een ongekalibreerd voorbeeld, geen nabootsing met gemeten eigenschappen van de video-opstelling.

## Controle met halve tijdstap

Dezelfde beginwaarden zijn doorgerekend met `dt = 0,001 s` en `dt = 0,0005 s`. De positieafwijking is het maximum over beide gewichten, op gezamenlijke uitvoertijdstippen.

| Geval | Gemeenschappelijke looptijd | Grootste positieafwijking | Verschil in stoptijd |
| --- | ---: | ---: | ---: |
| Standaard, 25° / −15° | 20 s | 4,91 × 10⁻¹¹ m | Niet van toepassing |
| Grote uitslag, 60° / 25° | 20 s | 6,02 × 10⁻¹¹ m | Niet van toepassing |
| Slap touw, 80° / 20° | Tot circa 0,9653572165 s | 5,48 × 10⁻¹² m | 7,48 × 10⁻¹² s |
| Stangen met gewichten, 25° / −15° | 20 s | 5,13 × 10⁻¹¹ m | Niet van toepassing |
| Alleen stangen, 25° / −15° | 20 s | 7,93 × 10⁻¹¹ m | Niet van toepassing |
| Stangen met gewichten, 120° / −10° | 5 s | 5,22 × 10⁻⁸ m | Niet van toepassing |

De kleine verschillen in deze voorbeelden laten numerieke overeenstemming bij de gekozen stappen zien. Ze betekenen niet dat lengtes, beginhoeken of loslaatmomenten in een proef zo nauwkeurig bekend zijn. Ook het bisectiecriterium van `10⁻¹¹ s` voor een gevonden spanningsnul is alleen de breedte van een numeriek tijdsinterval, geen fysieke nauwkeurigheidsgarantie.

**Een goede energiebalans garandeert geen nauwkeurige lange baan.** Een aanvullende stangproef met `rodMass1 = rodMass2 = 0,05 kg`, `m1 = m2 = 0,2 kg`, beginhoeken `120° / −10°` en duur `20 s` liep volledig door. De relatieve energiebalansfout was slechts `3,85 × 10⁻¹⁰`, maar de grootste positieafwijking tussen `dt` en `dt/2` was **1,335 m**. Voor deze instellingen is de volledige baan over 20 s dus niet betrouwbaar geconvergeerd. Een korter voorspellingsvenster en verdere stapverfijning zijn nodig voordat je die baan kwantitatief met een proef vergelijkt. De waargenomen gevoeligheid is op zichzelf geen berekende Lyapunov-exponent.

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
036AFE12FC2F0B5887CDD8D006B9422ECE9390CFBE199A4B15D4F5167DB9392E
measurements.js
3D880DE89ED0778AC5038BAA566A3C469F42DE09E77BD4D501BDEF28A25DA4EE
tests/physics.test.js
D93C23CF7703FD2CA8C6B958E410A74A895E603C0B14351387DC4A7BF405F292
tests/measurements.test.js
364287857F8F28473B61316C177B991A719C906AD78673938C1D64EF3DD84F4A
```

## Controle van de interface

De actuele modulaire bronversie en de gegenereerde zelfstandige HTML zijn in Chrome via een lokale HTTP-preview geopend en visueel gecontroleerd. De bronversie rekende met de achtergrondworker en gaf hetzelfde resultaat als de zelfstandige HTML, zonder waargenomen browserfouten. De volledige pagina is ook als schermafbeelding gecontroleerd.

| Browsercontrole | Waargenomen resultaat |
| --- | --- |
| Startproef | Stangmodus, `m1 = m2 = 0`, stangmassa's beide `0,2 kg`, `c1 = 0,002`, `c2 = 0,001`, looptijd 20 s |
| Numerieke indicatoren bij start | Energiebalans `8,6 × 10⁻¹¹ %`; maximale positieafwijking bij halve tijdstap `2,8 × 10⁻¹¹ m` |
| Wisselen van model | Touwkeuze verbergt de stangmassavelden; stangmodus maakt ze beschikbaar |
| Slap-touwvoorbeeld | Stop van touw 2 bij circa `0,9654 s` |
| Gevoelige stangproef, 120° / −10°, 20 s | Zichtbare waarschuwing voor meer dan 1% van de totale lengte; positieafwijking circa `1,3 m` |
| CSV downloaden | Bestand van 659.223 bytes, met axiale en Cartesische reactievelden voor stangen |
| JSON downloaden | Bestand van 2.421 bytes; schema `dubbele-slinger/v2`, stangmodel en alle massa's aanwezig |
| Eerder JSON-bestand importeren | `v1` herstelde de oorspronkelijke touwproef van 20 s |
| Nieuw JSON-bestand importeren | `v2` herstelde de stanginstellingen |
| Eigen stang-CSV opnieuw importeren | 501 punten vergeleken over 0–5 s, 1.500 uitgesloten punten, RMSE `0,000°` voor beide hoeken |

Het opnieuw importeren van de geëxporteerde CSV is een synthetische controle van downloaden, inlezen en vergelijken. Het is geen vergelijking met echte metingen. De bestandsomvang hierboven hoort bij deze concrete testbestanden en kan door tijdstempels of andere instellingen veranderen. Afspelen, pauzeren en de tijdschuif waren ook in de eerdere touwversie gecontroleerd.

De zelfstandige HTML bevat geen externe HTML/CSS-resources. De ingebedde modules zijn syntactisch gecontroleerd en werken in de lokale preview. Rechtstreekse geautomatiseerde controle via een file-URL is door de browsertool geblokkeerd; dubbelklikken op het bestand is daarom niet afzonderlijk geverifieerd. Er zijn geen browserinstellingen veranderd om deze beperking te omzeilen.

## Praktijkvideo en resterende experimentele validatie

De lokaal bekeken video toont twee stijve vlakke strips, met gele markeringen bij het tussenpunt en het onderste eindpunt. De bovenste strip lijkt langer; de beweging dempt zichtbaar uit in de opname van ongeveer 83 s. De stangmodus sluit aan op dit zichtbare mechanisme, met uniforme slanke stangen als benadering. Er is geen betrouwbare schaal- of massakalibratie uit de beelden afgeleid. De video blijft lokaal en is niet aan de repository toegevoegd.

Meet eerst de draaipuntsafstanden, massa en massaverdeling van elke strip, eventuele extra massa van gele markeringen en bevestigingen, beide beginhoeken en het loslaatmoment met hun onzekerheden. Film de kleine uitslagen en vergelijk de vroege hoekcurven, periodes en fase. Bepaal vervolgens eventueel demping uit aparte proeven en controleer met een nieuwe proef of die kalibratie voorspelt wat er gebeurt.

Bij grote uitslagen moeten vooral vlakke beweging, scharnierwrijving, botsingen, werkelijke massaverdeling en rotatie van extra gewichten worden gecontroleerd. Voor een aparte touwopstelling is blijvende touwspanning vereist: als een touw slap wordt, eindigt die modelvariant en wordt de vervolgbeweging niet voorspeld. Er is geen universele RMSE-grens gekozen die een echte proef automatisch goedkeurt.

Volg het [meetprotocol in README.md](README.md). Een vergelijking met een opnieuw ingelezen simulatie-CSV controleert alleen de softwaregegevensroute en telt niet als onafhankelijke experimentele validatie.


## Aanvulling: aangeleverde practicumlengtes (15 oktober 2026)

De keuze **Practicum · alleen lengtes** is in Chrome met het opnieuw gebouwde `standalone.html` gecontroleerd. De interface toont `s1=0.203` en `s2=0.157`; de stangmassa’s blijven expliciete voorbeeldwaarden van elk `0.2 kg`, met nul extra puntgewichten. De tabelmassa’s `0.2703` en `0.2000 kg` zijn niet toegewezen: de gebruiker heeft bevestigd dat hun betekenis nog onbekend is. Het meetrecord bewaart daarvoor `modelParameter: null`.

De voorbeeldberekening van 20 s wordt afgerond zonder browserfouten; de vergelijking met halve tijdstap toont ongeveer `9.8e-12 m`. De toelichting over nog onbekende massatoewijzing is zichtbaar naast de instellingen. Dit controleert de gegevensinvoer en interface; de rekenkern is niet gewijzigd en er is geen nieuwe fysieke validatie uitgevoerd.
