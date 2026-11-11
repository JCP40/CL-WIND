# CL-WIND : état des lieux (8 novembre 2026)

Application de navigateur (Chrome ou Edge, carte graphique NVIDIA conseillée) pour étudier le vent, le soleil et la
chaleur autour et dans le refuge climatique (anneau de briques à lames pivotantes). Elle se lance par
`LANCER-CL-WIND.bat` ou par le composant Grasshopper « CL-WIND Live » (adresse http://127.0.0.1:8765/).

---

## 1. D'où vient la scène

| Source | Ce qu'elle apporte | Où |
|---|---|---|
| Liaison Grasshopper (V1.gh) | volumes, briques/lames (écrans), murs, arbres, vent ; mise à jour à chaque recalcul ; maillages 3D | onglet Projet › Liaison Grasshopper |
| Import 3DM (Rhino) | même chose que Grasshopper, sans Rhino ; usage par calque, unités lues, blocs éclatés | Projet › Importer |
| Import DXF, GeoJSON, GLB | plans 2D (bâtiments, murs, arbres par calque) ; GLB coupé à une hauteur | Projet › Importer |
| OpenStreetMap | bâtiments et arbres du quartier autour d'une adresse | Projet › Site |
| Dessin | outils Sélection, Rectangle, Bâtiment, Arbre, Mur, Coupe ; Annuler, Supprimer, Cadrer | barre d'outils |
| Exemples | plans DXF, GeoJSON, maquette GLB, météo fictive | dossier `exemples/` |

## 2. Vent

**Calcul**
- Méthode de Boltzmann sur réseau (LBM), sur la carte graphique (WebGPU), ou sur le processeur à défaut.
- **2D** : écoulement en plan à une hauteur de coupe (1,5 m par défaut). Résolution réglable.
- **3D** : hauteur réelle, sol glissant, profil de vent en loi de puissance, turbulence d'entrée 20 %. Cellules d'environ 10 cm pour le refuge (« Finesse 3D »).
- **Briques et lames trop fines pour la grille** : remplacées par une « bande poreuse ». Sa perte de charge K vient de la surface ouverte mesurée face au vent (59 % aujourd'hui, K = 2,2).
- **Vent** : vitesse et direction réglables, ou lues dans un fichier météo EPW (Nantes fourni) par saison, heures et environnement (rugosité). Moyenne sur 6 traversées.

**Affichages** (vues Plan, Coupe, Plan + coupe, 3D)

| Affichage | Ce qu'il montre |
|---|---|
| Vitesse | vitesse du vent |
| Rapport | vitesse rapportée au vent libre |
| Confort | classes calme, debout, marche… |
| Écart | différence avec une variante mémorisée |

S'y ajoutent :
- des particules animées ;
- une sonde au survol ;
- une coupe verticale libre ;
- en 3D, des lignes de courant sur le champ allégé (25 cm).

**Résultats chiffrés**
- **Bilan intérieur / extérieur** : vitesse moyenne et maximale à l'intérieur, part de surface par classe de confort, air entrant (part par les briques et par les ouvertures), taux de pénétration et renouvellement d'air indicatif.
- **Profil selon la hauteur.**
- **Variantes** : mémoriser un état et comparer (affichage « Écart »).

## 3. Zoom sur un pan de mur (vue « Zoom mur »)
- **Un calcul 3D à part**, où chaque brique est un obstacle plein.
  - La boîte suit le mur : longueur le long du mur × profondeur à travers, de 1 à 20 m, 10 × 5 m par défaut.
  - Les cellules font environ 3 cm à 10 × 5 m, et environ 0,9 cm à 1,2 × 1,2 m.
- **On choisit le point du mur** par son azimut, ou avec les boutons Face au vent, De côté, Sous le vent.
- **Affichage « Coupes »** : coupe horizontale (mur horizontal, extérieur en haut) et coupe verticale dans l'axe du vent, avec des flèches.
- **Affichage « 3D »** : la vue 3D seule.
  - Briques et lignes de courant tracées au centimètre, colorées selon la vitesse.
  - Tirets animés au ralenti × 20.
  - Départs en grille face au vent, sur ±50 cm ou toute la hauteur, ou en nappe ; un départ tous les 2,5, 5 ou 10 cm.
- **Chiffres** : vide dans le mur, vitesse dans les joints (moyenne, maximum), devant et derrière le mur, débit d'air qui traverse par m² de mur.

## 4. Soleil et chaleur (onglet Soleil, vue Soleil)

**Soleil**
- Date et heure, avec une animation de la journée.
- Course du soleil, ombres portées en 3D et coupe solaire avec les rayons.
- Taches de soleil au sol intérieur, calculées sur la géométrie : briques, toit, ouverture du toit.

**Paroi**
- Matériau et épaisseur des briques.
- 8 orientations, chacune avec son soleil.
- Air qui entre par les joints du côté du vent.
- Échanges entre les faces intérieures, le sol et le toit.

**Eau**
- Goutte-à-goutte sur la façade.
- Brumisation de l'air entrant, avec son efficacité, le débit des buses et un arrêt au-delà d'une humidité maximale.

**Réservoir**
- Volume et surface de collecte de la pluie (pluie du fichier EPW).
- L'eau se coupe quand le réservoir est vide.

**Sur 24 h**
- Courbes heure par heure : air dehors et dedans, faces de la brique, sol, ressenti.
- Humidité intérieure, point de rosée et heures de condensation.

**Ressenti en plan**
- Affichage « Ressenti » : température apparente de Steadman, avec le soleil sur la personne, la part de ciel vue, le sol et le vent local.
- Affichage « Temp. » : températures de surface.

**Été (juin à septembre)**
- Heures de ressenti au-dessus de 26 °C et de 32 °C, dedans et dehors.
- Eau consommée et pluie recueillie.
- Jours de réservoir vide, et taille de réservoir nécessaire pour ne jamais manquer.

## 5. Exports
- **Planche A3 vent** (PNG) : plan, coupe, 3D, bilan, limites du modèle.
- **Planche A3 soleil et chaleur** : vues soleil, courbes, faces, humidité, ressenti, été.
- **Image PNG** de la vue, et **plan DXF** en mm.

## 6. Grasshopper (V1.gh, rangé le 8/11/2026)

**Groupes du canevas**
- 1 · Paramètres du cercle
- 2 · Module
- 2b · Brique à lame pivotante (type 3)
- 3 · Tronçon (arc et grille de modules)
- 4 · Réservoir (évidé, sous le tronçon)
- 5 · Répétition autour du cercle
- 6 · Sol + toit, avec l'ouverture du toit de 2 m (curseur « Toit ouverture Ø »)
- 7 · Structure (rails en arc 5 × 2 cm et montants)
- 8 · Matériaux et textures
- 9 · Vent : orientation des lames
- 10 · CL-WIND Live

**Composant CL-WIND Live** (`grasshopper/clwind_live.py`)
- Entrées : volumes, ecrans, murs, arbres, hauteur, epaisseur, rayon, joint, densite, vitesse, direction, actif, port, dossier.
- Il sert l'application et la scène sur le port 8765.

## 7. Fichiers

| Fichier | Rôle |
|---|---|
| `index.html`, `css/style.css` | interface |
| `js/main.js` | état, outils, affichages, boucle de calcul |
| `js/solver_gpu.js`, `js/solver_cpu.js` | calcul 2D |
| `js/solver3d_gpu.js`, `js/vox3d.js` | calcul 3D, découpage des volumes |
| `js/raster.js` | grille du plan, écrans poreux |
| `js/bilan.js`, `js/variantes.js` | bilan intérieur / extérieur, variantes |
| `js/view3d.js` | vue 3D d'ensemble |
| `js/zoom.js`, `js/zoom3d.js` | zoom sur un pan de mur, vue 3D et lignes |
| `js/soleil.js` | soleil, ombres, coupe solaire |
| `js/thermique.js` | paroi, eau, humidité, ressenti, été |
| `js/epw.js`, `meteo/` | météo EPW |
| `js/import.js`, `js/import3dm.js`, `js/lib/rhino3dm/` | imports |
| `js/osm.js` | OpenStreetMap |
| `js/live.js`, `grasshopper/clwind_live.py` | liaison Grasshopper |
| `js/export.js` | planches et exports |
| `tests/autotest.js` | essai automatique (banc d'essai) |
| `LISEZMOI.txt`, `README.md` | mode d'emploi et notes techniques |

## 8. Limites connues et points relevés

**Vent**
- Le calcul d'ensemble ne voit pas les joints : la bande poreuse les remplace, et ses réglages (K, largeur de soudure) pèsent sur le résultat. Le zoom les voit, mais seulement dans une boîte, sans le reste de l'ouvrage.
- Vent moyen, sans rafales. La turbulence d'entrée et le profil sont fixés. Il n'y a pas de bâtiments voisins réels sauf par OpenStreetMap.
- En 2D, l'air ne peut ni passer par-dessus ni ressortir par le toit, ce qui exagère le débit traversant. En 3D, c'est réaliste, mais à 10 cm.
- Le renouvellement d'air utilisé par la thermique vient du bilan 2D : environ 1 100 volumes par heure avec 59 % d'ouverture. C'est probablement surestimé.

**Chaleur**
- Le modèle est à une seule zone : l'air intérieur est uniforme, la paroi est représentée par deux nœuds par orientation, et le toit est simplifié.
- La brumisation refroidit peu l'air, à cause du très fort renouvellement d'air. Le gain du refuge vient surtout de l'ombre.
- Le réservoir automatique est vide 92 jours sur 122 en été : il faudrait environ 9,4 m³ pour ne jamais manquer.
- Il n'y a ni validation par la mesure, ni comparaison avec un logiciel de référence.

**Zoom**
- Le calcul a tourné à 13–19 pas par seconde aujourd'hui, contre environ 100 avant. Une partie vient de D5 Lite qui occupait la carte graphique. Le reste est à vérifier.
- Les lignes sont provisoires tant que la moyenne n'est pas stabilisée.

**Import 3DM**
- Faces courbes sans maillage enregistré : reconstituées sans leurs découpes.
- Volumes ouverts : à fermer dans Rhino.

**Banc d'essai**
- L'image de la coupe verticale est sortie vide une fois. La cause n'a pas été cherchée.
