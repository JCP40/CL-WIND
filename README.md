# Analyse du vent (CL-WIND)

Simulation ultra simplifiée du vent en plan, pour étudiants en architecture en phase d'esquisse.
Ce n'est ni une étude CFD ni une soufflerie : résultats approximatifs, à comparer entre variantes.

Le guide destiné aux étudiants est dans [LISEZMOI.txt](LISEZMOI.txt).

## Lancement

- Windows : `LANCER-CL-WIND.bat` (Chrome, sinon Edge, sinon navigateur par défaut).
- Partout : ouvrir `index.html`, en `file://` ou servi en HTTPS. Pas de build, pas de dépendance, pas de CDN.
- Paramètres d'URL de test : `?cpu=1` force le processeur, `?gpu=force` accepte un adaptateur WebGPU logiciel (SwiftShader), ignoré par défaut car plus lent que le solveur processeur.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html`, `css/style.css` | interface |
| `js/raster.js` | grille, rasterisation des obstacles, préparation du réseau D2Q9 (tables partagées par les deux solveurs) |
| `js/solver_cpu.js` | solveur processeur, dans un Worker créé depuis un Blob (fonctionne en `file://`), repli par tranches dans la page |
| `js/solver_gpu.js` | même algorithme en WGSL, `@workgroup_size(16, 16)` |
| `js/osm.js` | localisation, Overpass par relais de serveurs, conversion en mètres |
| `js/epw.js` | rose des vents EPW, loi de puissance vers 1,5 m |
| `js/import.js` | DXF ASCII, GeoJSON, GLB |
| `js/export.js` | PNG 1800 px, DXF R12 en millimètres avec isovitesses |
| `js/main.js` | état, dessin, outils, moteur, moyenne |
| `js/live.js` | liaison Grasshopper : attend chaque scène sur `live/scene` (requête longue) et remplace les objets `src: 'live'` |
| `js/solver3d_gpu.js` | solveur 3D D3Q19 WebGPU, moyenne sur la carte, extraction de plans de coupe |
| `js/vox3d.js` | découpage en cubes : maillages Grasshopper (parité verticale), écrans poreux couche par couche (`Screen.analyse` + `Screen.toGrid`), extrusion des objets du plan |
| `js/view3d.js` | vue 3D WebGL sans bibliothèque : maillages ou faces des cubes pleins, coupes texturées, lignes de courant (RK2 sur le champ allégé `readCoarse`) |
| `js/variantes.js` | variantes mémorisées, référence, écart carte (même signature de grille) et écarts du bilan |
| `js/soleil.js` (coupe solaire) | zoom à la molette, glisser pour déplacer, double clic pour la coupe entière ; échelle ajustée, fixe (1/20 à 1/500, à 96 points par pouce) ou libre (≈ 1/N affiché), barre d'échelle ; « Agrandir » : coupe sur 40, 70 ou 100 % de la vue (`--cuth`) ; « PNG » : export à 300 dpi, coupe entière à l'échelle si elle est fixée (`CLW.Sun.exportCut`) ; mémorisé (`clwind-suncut`) |
| onglet ⚙ Réglages | domaine et méthode (déplacés de l'étape Vent) et zone Ressenti / UTCI (déplacée de l'Affichage) |
| `js/sonde.js` | sonde P liée entre les panneaux (outil Sonde, touche P) : clic dans le plan ou la coupe verticale (en 3D, la coupe horizontale passe à la hauteur de P), repère dans le plan, la coupe (projeté avec sa distance au trait) et la 3D (`CLW.View3D.project`), fiche de valeurs repliable (vent, air, ressenti, UTCI, température dans la coupe), « Coupe par P » ; mémorisée (`clwind-sonde`) |
| `js/etapes.js` | barre latérale par étapes de travail (1 Modèle, 2 Météo, 3 Vent, 4 Soleil et chaleur, 5 Confort, 6 Comparer et exporter) : résultats de droite filtrés par étape (`data-steps`, case « Tous les résultats », `clwind-res-all`), boutons « Voir », « Étape suivante », état de chaque étape relu chaque seconde ; anciens noms d'onglets acceptés par `CLW.showTab` |
| `js/bilan.js` | bilan intérieur / extérieur : enveloppe convexe des écrans, zone intérieure, flux à travers la ligne de contrôle (polyligne fermée, −vx·dy + vy·dx) par secteur, part briques / ouvertures |
| `grasshopper/clwind_live.py` | composant Script Python 3 (Rhino 8/9) : coupe RhinoCommon à 1,5 m, serveur local `127.0.0.1:8765` qui sert l'application et la scène |
| `scripts/make_examples.js` | génère `exemples/` (`node scripts/make_examples.js`) |
| `scripts/build_kit.ps1` | produit `dist/CL-WIND-kit.zip` |

## Liaison Grasshopper

Coller `grasshopper/clwind_live.py` dans un composant Script Python 3 (entrées `volumes`, `murs`, `arbres`, facultatives `hauteur`, `epaisseur`, `rayon`, `densite`, `vitesse`, `direction`, `actif`, `port`, `dossier`), puis ouvrir `http://127.0.0.1:8765/`.
Le composant démarre un `ThreadingHTTPServer` gardé dans `scriptcontext.sticky` (redémarré si `VERSION` change), publie la scène en JSON (anneaux en mètres, Y nord) seulement quand elle change, et `GET /live/scene?since=rev` attend jusqu'à 15 s une nouvelle révision.
La page ne s'active qu'en `http(s)` si `live/ping` répond `{"clwind": true}`. Le domaine ne fait que grandir, l'origine est fixée au premier envoi (bouton Recentrer).
`127.0.0.1` est un contexte sécurisé : WebGPU reste disponible.

## Écrans poreux

Objets `building` avec `screen: true` (entrée Grasshopper `ecrans`) : non pleins. `CLW.Screen.analyse` (raster.js) les rasterise sur une grille fine (≤ 1600², ≥ 4 mm),
les soude par fermeture morphologique (dilatation de `joint`, érosion de `joint / 2` ; `joint` auto = 0,6 × 90e centile des arêtes de l'arbre couvrant minimal des centres),
étiquette les bandes connexes, puis calcule φ = Σ cols / Σ pas sur les arêtes de l'arbre soudées (col = distance minimale entre polygones voisins), globalement et par cases de max(0,5 m, 4 joint).
Perte de charge K(φ) = (0,707 √(1−φ) + 1 − φ)² / φ² (Idelchik, grille mince), traînée quadratique a = K / (2 W_r) avec W_r = aire de bande rasterisée / longueur de chaîne :
la perte de pression intégrée à la traversée vaut K ½ ρ U² indépendamment de la grille. Mode `d-scr` : `auto` rend les éléments pleins (élargis à 0,71 dx s'ils sont plus fins) dès que leur épaisseur médiane 2A/P ≥ dx, sinon bande poreuse.
Résolutions GPU 256 à 2048 (`MAX_GPU`), bornées par `GPU_MAX_CELLS` = limite de tampon / 36 octets ; domaine minimum 10 m.
Mesuré sur Intel Iris Xe : 140 à 180 MLUPS jusqu'à 1024², 62 MLUPS en 1536², effondrement en 2048² (mémoire partagée saturée). Validé : lattes 50 % → φ = 0,500, K = 4,00 (écran droit ou tourné) ; lames 0°, 45°, 90° → 0,944, 0,655, 0,363 (théorie 0,944, 0,651, 0,363).

## Modèle

Lattice-Boltzmann D2Q9, BGK + Smagorinsky (`tau0 = 0.51`, `Cs = 0.2`), forçage Exact-Difference, `U_LAT = 0.08`, `y` vers le bas.
Forces : rappel vers le vent libre `lam = U_LAT × cellule / 120 m` (valeur de réglage, non calibrée),
amortissement du mode parasite `gam = 0.05`, traînée quadratique implicite des arbres `d = a × cellule` (`a = 0,15 /m` par défaut).
Entrée seulement où le vent entre franchement (composante > 0,2 |vent|), autres bords ouverts (recopie de la population intérieure), éponges `max(8, 7 %)`.

La propagation utilise une table `src` (9 entrées par cellule : indice source, rebond ou équilibre d'entrée) calculée une fois par `buildLattice`,
et partagée telle quelle par le solveur processeur et le shader : les deux appliquent le même algorithme.

Moyenne affichée : 2 traversées de mise en régime (moyenne glissante 0,12), puis moyenne cumulée pondérée par le nombre de pas ;
« Moyenne stabilisée » à 6 traversées. La vitesse affichée est la moyenne de |u|.

## Sources et licences

- Données OpenStreetMap © contributeurs OpenStreetMap, ODbL. Services : Nominatim, Overpass (overpass-api.de, maps.mail.ru, overpass.private.coffee, overpass.kumi.systems).
- Fichiers EPW gratuits : climate.onebuilding.org, energyplus.net.

## Bilan intérieur / extérieur

Validé sur champs analytiques : vent uniforme dans 4 directions → débit entrant = U × largeur projetée de la ligne de contrôle (écart 0,00 %), entrant = sortant, pénétration 100 % ;
tourbillon centré → flux net nul ; intérieur freiné à 35 % → pénétration 35 %. Résolution « Ultra » 3072² (`MAX_GPU[6]`) : 8,1 mm sur 25 m, 340 Mo par tampon de populations.

## Calcul 3D

`js/solver3d_gpu.js` : D3Q19, BGK + Smagorinsky (`tau0 = 0,51`, `Cs = 0,2`), forçage Exact-Difference, `gam = 0,05`, WebGPU seulement (`@workgroup_size(8, 8, 4)`).
Axes x est, y nord, z haut ; drapeaux bit 1 plein, bit 2 sol. Sol glissant (réflexion miroir) : un sol lisse collant laisse se former une couche ralentie qui reflue et rend le calcul instable.
Profil d'entrée en loi de puissance, rappel doux vers le profil (`lam = uref / lamL`, 120 m), sorties à pression fixée sans retour d'air, éponges 10 % vers le profil,
turbulence d'entrée par bruit lisse (intensité 20 %, échelle `zref`). Moyenne sur la carte (vec4), relecture des seules coupes.

Banc d'essai `tests/test3d.html` (vitesse, profil, cube), `tests/diag3d.html`, `tests/diagcube.html` : résultats envoyés par POST à l'adresse `?post=`.
Mesuré sur RTX 4060 portable (Chrome forcé sur la NVIDIA) : 75 à 99 pas/s pour 7,2 M cellules (540 à 710 MLUPS).
Profil en domaine vide : écart < 1,3 % au-dessus de 2 cellules (13 % sur la première, sol glissant).
Cube posé au sol, H = 20 cellules, décalé d'une cellule : recirculation 3,15 H sans turbulence d'entrée, 2,55 H à 10 %, 1,9 H à 20 % (essais publiés : 1,2 à 1,8 H) ;
tourbillon avant 0,55 H (essais : 0,6 à 1,0 H) ; survitesse sur le toit 1,3.

Intégration (`main.js`, `doReset3D`, `setSlice3D`, `frame3d`) : le plan affiche la couche `kOf(S.cut3d)` convertie dans les conventions 2D
(`E.grid`, `E.rast`, `E.mean` en unités `U_LAT`, j vers le bas) : couleurs, sonde, particules, bilan et export fonctionnent sans changement.
Profil : vitesse de référence à 1,5 m, `uref = min(0,06 ; 0,09 / (Htop / 1,5)^0,25)`, `lamL = 120 m / dx`, turbulence 20 % d'échelle max(8 cellules, hauteur de l'ouvrage).
Liaison : `clwind_live.py` (VERSION ≥ 12) envoie `mesh3d` (volumes et écrans maillés, mètres, z depuis le point le plus bas).
Essai de bout en bout : `?autotest=<banc>&mode3d=1&res3d=…&trav=…` charge `tests/autotest.js` (résumé JSON et images envoyés au banc).
Refuge, 3D Normale (260 × 260 × 105, 9,6 cm, écran sur 25 couches, découpage 0,8 s) : à 1,5 m, vent intérieur 13 % du vent libre, air entrant à 63 % par les briques.

## Interface

Onglets à gauche, colonne Résultats à droite, bascule Plan 2D / Vue 3D, outil Coupe (`S.section`, plan 3D mode 3 de `readPlanes` : échantillons le long d'un trait),
bandeau d'état, profil du bilan selon la hauteur (`updateProfile3D` : coupes relues à ~14 hauteurs), affichage « Écart » (`diffColor`, ± 0,5 du vent libre),
planche A3 (`Export.a3`). Essai de bout en bout : `?autotest=…&mode3d=1&ui=1` (variantes, écart, coupe libre, vue 3D, planche).

## Soleil et chaleur (js/soleil.js, js/thermique.js)

- `CLW.Sun` : position du soleil (NOAA, réfraction), `keyDays()` (solstices, équinoxes, jours extrêmes et types de l'EPW,
  ligne TYPICAL/EXTREME PERIODS), état date/heure partagé (`set`, `onChange`), vue WebGL avec carte d'ombre
  (profondeur empaquetée RGBA, 2048², PCF 3×3, projection orthogonale depuis le soleil), courses du soleil,
  coupe solaire 2D (coupe épaisse à ±5 cm, élévation au-delà rastérisée, rayons tracés jusqu'au premier obstacle).
- `CLW.EPW.parse` garde aussi les données horaires (8760 h : T, HR, GHI, DNI, DHI, IR, vent) et les périodes types.
- `CLW.Thermal` : géométrie (enveloppe des écrans, toit par projection zénithale), taches de soleil par projection
  des triangles sur le sol intérieur, modèle horaire au pas de 5 min (paroi à 2 nœuds, joints, air mélangé,
  sol à inertie, évaporation par la relation de Lewis, brumisation vers la température humide de Stull),
  ressenti opératif dehors au soleil et dedans à l'ombre, synthèse, courbes, carte (traceur passif émis par la
  paroi et transporté par le champ moyen, normalisé par la moyenne intérieure), surcouche de la coupe.
- Paroi en 8 orientations (`TboK`, `TbiK`), humidité intérieure et point de rosée, brumisation limitée par le débit des
  buses et une humidité maximale (`mistAir`), ressenti = température apparente de Steadman avec la température radiante
  moyenne (`mrt`, `apparent`).
- Carte « Ressenti » (`S.display === 'feel'`) : ciel visible à 1,1 m par 45 directions (`skyView`, ombres projetées sur
  la fenêtre du traceur, `shadeWin`), soleil sur la personne et sur le sol, vent local du champ moyen, face de brique en
  vis-à-vis ; `TH.probeText` pour la sonde.
- `TH.season()` : juin à septembre au pas de 10 min, pluie EPW (colonne 34 → `hourly.P`), réservoir, besoin maximal.
- Banc d'essai : `?autotest=…&soleil=1&jours=sol-ete,chaud,…&drip=1&mist=1` (capture aussi `plan_ressenti` et `ete`).

## Zoom 3D sur un pan de mur (js/zoom.js)

- `CLW.Zoom` : solveur WebGPU séparé (`CLW.Solver3D.create()`), boîte `size × size` centrée sur le mur à l'azimut
  `state.az` (rayon médian des écrans autour du centre de `CLW.Thermal.geometry()`), du sol à `hmax + 12 %`.
- Découpage : volumes par parité (`CLW.Vox3D.fillMesh`), écrans résolus couche par couche (`CLW.Vox3D.sliceMesh` puis
  remplissage pair-impair de chaque section), drapeau 1 = plein, couche 0 = sol glissant.
- Relecture : coupe horizontale (mode 0) et coupe verticale dans l'axe du vent (mode 3) ; statistiques des joints dans la
  bande `[rIn, rOut]` des écrans.
- Boucle : `main.js` appelle `CLW.Zoom.frame()` et suspend le calcul principal quand `S.viewMode === 'zoom'`.
- Banc d'essai : `?autotest=…&zoom=1&zaz=<azimut>&zmax=<s>` (images `zoom_plan`, `zoom_coupe`).
- Vue 3D du zoom (`js/zoom3d.js`, `CLW.Zoom3D`) : `Solver3D.readBox(k0, nk)` relit le champ moyen à pleine résolution sur
  une tranche de hauteur ; lignes RK2 (cellules pleines à vitesse nulle), temps de trajet par sommet pour les tirets
  animés (shader, ralenti × 20). Banc : `&z3=1&zseed=grille|grille-tout|nappe` (image `zoom_3d`).


## Import 3DM (js/import3dm.js)

- `CLW.Import3dm` : lit le .3dm avec rhino3dm.js 8.35.0 (`js/lib/rhino3dm/`, repli sur jsDelivr ; CDN seul en `file://`).
- Produit la même scène que `grasshopper/clwind_live.py` (`rings`, `screens`, `walls`, `trees`, `mesh3d {volumes, ecrans, zmin}`)
  et la passe à `CLW.Live.apply(scene, { src: '3dm', label, recenter: true })`.
- Maillages : `BrepFace.getMesh(Any)` / `Extrusion.getMesh`, sinon remaillage (faces planes par leurs boucles + earcut, faces
  courbes par grille UV). Sommets soudés à 1/100 mm ; coupes par intersection plan-triangles puis `Import.joinSegments`.
- `CLW.Live` : `rev` = version de la scène affichée (clé des caches 3D et soleil), `ghRev`/`ghLast` = dernier envoi Grasshopper.
- Banc d'essai : `?autotest=…&i3dm=<adresse du .3dm>&i3cut=<m>`.
