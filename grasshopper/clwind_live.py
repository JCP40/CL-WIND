#! python3
# -*- coding: utf-8 -*-
"""CL-WIND Live : liaison Grasshopper -> CL-WIND en temps réel.

A coller dans un composant « Script » Python 3 de Grasshopper (Rhino 8 ou 9).
A chaque recalcul de la définition, les volumes sont coupés horizontalement
(par défaut à 1,5 m au-dessus de leur point le plus bas), puis envoyés à CL-WIND,
qui remplace la scène et relance le calcul du vent.

Le composant démarre un petit serveur local (http://127.0.0.1:8765/) qui sert
l'application CL-WIND et la scène. Ouvrir CL-WIND par cette adresse, pas en
double-cliquant sur index.html.

Entrées (clic droit sur le composant pour les créer ; noms exacts, en minuscules) :
  volumes    Arbre (accès « arbre », aplati par le script). Breps, extrusions, maillages, SubD, boîtes : bâtiments, coupés à « hauteur ».
  ecrans     Arbre. Volumes trop fins pour la grille (briques, lames, claustras) : non pleins, soudés
             en bandes poreuses ; CL-WIND mesure leur porosité face au vent et applique une perte de charge.
  murs       Arbre. Courbes : murs, clôtures (polylignes, épaisseur « epaisseur »).
  arbres     Arbre. Points, cercles, courbes fermées ou volumes : arbres. Un houppier donné en volume garde sa
             vraie hauteur (au-dessus de la coupe, il ne compte que dans le calcul 3D et pour l'ombre).
  hauteur    Nombre, m. Hauteur de coupe au-dessus du point le plus bas des volumes. Défaut 1,5.
  epaisseur  Nombre, m. Epaisseur des murs. Défaut 0,3.
  rayon      Nombre, m. Rayon des arbres donnés par des points. Défaut 5.
  joint      Nombre, m, facultatif. Rayon de soudure des éléments d'écran (auto : d'après leur espacement).
  brique     Brep, facultatif. UNE brique (cadre) dans son repère local : X largeur, Y épaisseur du mur
             (-Y = face extérieure, +Y = face intérieure), Z hauteur. Ses ouvertures sont mesurées par
             coupes successives (effet Venturi compris) pour le refroidissement de l'air dans CL-WIND.
  lames      Arbre, facultatif. Les lames posées : leur orientation par rapport au vent radial donne
             leur fermeture (0 = dans le sens de l'air, 1 = en travers).
  densite    Nombre, 1/m. Densité de feuillage des arbres. Défaut 0,15.
  saison     Booléen ou texte, facultatif. True / « ete » = géométrie d'été, False / « hiver » = géométrie d'hiver.
             CL-WIND garde une géométrie par saison et s'en sert pour les jours de cette saison.
  plantes    Arbre, facultatif. Fils ou courbes verticales des plantes grimpantes : chacun devient une colonne
             de feuillage poreuse (rayon « plantes_rayon », densité « plantes_densite »), à sa vraie hauteur.
  plantes_rayon    Nombre, m. Rayon du feuillage autour du fil. Défaut 0,15.
  plantes_densite  Nombre, 1/m. Densité de feuillage des grimpantes. Défaut 0,6 (rideau dense).
  briques    Arbre, facultatif. Les briques posées : CL-WIND en tire, pour chacune des 8 orientations, le nombre de
             briques, leur profondeur moyenne et la part de paroi couverte (murs d'épaisseur variable, murets).
  collecte   Nombre, m². Surface de toit qui recueille la pluie (récupérateur d'eau de pluie → réservoir).
             Sans elle, CL-WIND estime la collecte d'après la surface couverte.
  station    Arbre de nombres, facultatif. Seuils de la commande automatique (station météo), dans cet ordre :
             pompe en marche si air ≥ T (°C) ; arrêtée si humidité ≥ HR (%) ; clapets fermés si vent ≥ V (m/s) ;
             pompe arrêtée si niveau du réservoir < N (%) ; arrêtée si pluie ≥ P (mm/h). CL-WIND règle alors le
             goutte-à-goutte en mode sonde avec ces seuils et ferme les clapets par vent de tempête.
  lames_toit Arbre, facultatif. Les lames du toit (boîtes ou volumes) : leur centre, leur axe (plus grande dimension),
             leur largeur et leur épaisseur. CL-WIND les fait tourner HEURE PAR HEURE dans le calcul thermique
             (ombre au sol, part de ciel) selon la règle « lames_regle », au lieu de garder la position envoyée.
  lames_regle Arbre de nombres, facultatif, dans cet ordre : hiver, ouvertes à partir de Hd (h solaire) ; fermées
             après Hf (h solaire) ; été, ventilées si l'air > Ts (°C) ; angle de ventilation Av (°) ; été si la
             moyenne de l'air sur 3 jours ≥ Te (°C). Hiver : lames dans l'axe des rayons entre Hd et Hf, sinon
             fermées ; été : Av si l'air > Ts, sinon fermées.
  atlas     Texte, facultatif. Adresse de l'atlas (défaut http://localhost:8000/) ou son dossier : CL-WIND y lit
             les mesures horaires Météo-France pour simuler une année réelle, une canicule ou un grand froid.
  vitesse    Nombre, m/s, facultatif. Vitesse de référence du vent.
  direction  Nombre, degrés, facultatif. Vent « venant de » (0 = nord, 90 = est).
  actif      Booléen. Faux arrête le serveur. Défaut vrai.
  port       Entier. Défaut 8765.
  dossier    Texte, facultatif. Dossier de CL-WIND (celui qui contient index.html). Par défaut :
             un dossier CL-WIND à côté du fichier .gh, sinon DEFAULT_APP_DIR.
Sorties :
  info       Etat de la liaison.
  url        Adresse à ouvrir dans Chrome ou Edge.
  coupe      Contours de coupe (aperçu dans Rhino).

Coordonnées : X vers l'est, Y vers le nord, Z vertical, comme dans Rhino.
Les unités du document sont converties en mètres.
"""
import json
import math
import os
import threading
import time
import subprocess
import webbrowser
import urllib.parse
import urllib.request
import http.server

import System
import Rhino
import Rhino.Geometry as rg
import scriptcontext as sc

VERSION = 19
# dossier de l'application : ce fichier est dans CL-WIND/grasshopper/
DEFAULT_APP_DIR = r"D:\Dropbox\06 - ENSA\L3\Francis\Refuge climatique urbain\CL-WIND"
# atlas du site (mesures Météo-France) : serveur de l'atlas, sinon lecture directe dans son dossier
DEFAULT_ATLAS_URL = "http://localhost:8000/"
DEFAULT_ATLAS_DIR = r"D:\Dropbox\06 - ENSA\L3\S1 - Projet\Site\application\atlas-site-hotel-de-ville v8"
ATLAS_FILES = {"meteofrance_44020001_horaire.csv": "data/meteo/meteofrance_44020001_horaire.csv",
               "extremes.json": "data/meteo/extremes.json"}


# ---------------------------------------------------------------- entrées
def _inp(name, default=None):
    v = globals().get(name, None)
    return default if v is None else v


def _as_list(v):
    if v is None:
        return []
    if isinstance(v, (list, tuple)):
        return list(v)
    if hasattr(v, "AllData") and hasattr(v, "BranchCount"):  # DataTree (accès « arbre ») : aplati
        return [x for x in v.AllData() if x is not None]
    try:
        if isinstance(v, System.Collections.IEnumerable) and not isinstance(v, (str, rg.GeometryBase, rg.Polyline)):
            return list(v)
    except Exception:
        pass
    return [v]


def _inp_geoms(name):
    """Géométrie d'une entrée, lue dans les données du paramètre Grasshopper lui-même (toutes branches).
    Sans indication de type, le composant Script peut ne transmettre que des Guid, inutilisables pour
    une géométrie calculée qui n'existe pas dans le document Rhino."""
    comp = getattr(globals().get("ghenv"), "Component", None)
    if comp is not None:
        for p in comp.Params.Input:
            if p.Name.lower() == name or p.NickName.lower() == name:
                out = []
                for goo in p.VolatileData.AllData(True):
                    v = None
                    try:
                        v = goo.ScriptVariable()
                    except Exception:
                        v = getattr(goo, "Value", None)
                    if v is not None:
                        out.append(v)
                return out
    return [x for x in _as_list(_inp(name)) if x is not None]


def _geom(x):
    """Ramène une entrée Grasshopper à un objet RhinoCommon."""
    if x is None:
        return None
    if isinstance(x, System.Guid):
        o = Rhino.RhinoDoc.ActiveDoc.Objects.FindId(x)
        return o.Geometry if o else None
    if hasattr(x, "ScriptVariable") and not isinstance(x, rg.GeometryBase):
        try:
            return x.ScriptVariable()
        except Exception:
            pass
    return x


# ---------------------------------------------------------------- géométrie
def _bbox(g):
    if isinstance(g, rg.Box):
        return g.BoundingBox
    if isinstance(g, rg.Point3d):
        return rg.BoundingBox(g, g)
    if isinstance(g, rg.Circle):
        return g.BoundingBox
    if isinstance(g, rg.GeometryBase):
        return g.GetBoundingBox(True)
    return rg.BoundingBox.Empty


def _to_volume(g):
    """Brep ou Mesh coupables, ou None."""
    if isinstance(g, rg.Box):
        return g.ToBrep()
    if isinstance(g, rg.Extrusion):
        return g.ToBrep(True)
    if isinstance(g, rg.SubD):
        try:
            return rg.Mesh.CreateFromSubD(g, 2)
        except Exception:
            return None
    if isinstance(g, rg.Surface):
        return g.ToBrep()
    if isinstance(g, (rg.Brep, rg.Mesh)):
        return g
    return None


def _curve_pts(c, tol):
    ok, pl = c.TryGetPolyline()
    if not ok:
        pc = c.ToPolyline(tol, 0.1, 0.0, 0.0)
        if pc is None:
            return []
        pl = pc.ToPolyline()
    return [pl[i] for i in range(pl.Count)]


def _ring(pts, k):
    """Points 3D -> anneau 2D en mètres, sans point de fermeture en double."""
    r = [[round(p.X * k, 3), round(p.Y * k, 3)] for p in pts]
    if len(r) > 1 and r[0] == r[-1]:
        r.pop()
    out = []
    for p in r:  # doublons consécutifs
        if not out or out[-1] != p:
            out.append(p)
    return out


def brick_metrics(k, tol):
    """Brique et lames réelles -> mesures pour l'échange air / brique de CL-WIND (mètres)."""
    out = {}
    bq = [_to_volume(_geom(x)) for x in _inp_geoms("brique")]
    bq = [g for g in bq if isinstance(g, rg.Brep)]
    if bq:
        b = bq[0]
        bb = b.GetBoundingBox(True)
        depth = bb.Max.Y - bb.Min.Y
        sl = []
        for f in (0.06, 0.25, 0.5, 0.75, 0.94):  # de la face extérieure (-Y) à la face intérieure (+Y)
            y = bb.Min.Y + f * depth
            pl = rg.Plane(rg.Point3d(0, y, 0), rg.Vector3d(0, 1, 0))
            try:
                ok, crvs, _pts = rg.Intersect.Intersection.BrepPlane(b, pl, tol)
            except Exception:
                ok, crvs = False, None
            if not ok or not crvs:
                continue
            loops = []
            for c in rg.Curve.JoinCurves(crvs, tol * 10):
                if not c.IsClosed:
                    continue
                amp = rg.AreaMassProperties.Compute(c)
                if amp is not None:
                    loops.append((abs(amp.Area), c.GetLength()))
            if len(loops) < 2:
                continue
            loops.sort(reverse=True)
            sl.append((sum(l[0] for l in loops[1:]), sum(l[1] for l in loops[1:])))  # trous = ouvertures
        if sl:
            out["brick"] = {"depth": round(depth * k, 4), "w": round((bb.Max.X - bb.Min.X) * k, 4), "h": round((bb.Max.Z - bb.Min.Z) * k, 4),
                            "aOpen": round(sum(s[0] for s in sl) / len(sl) * k * k, 6), "pWet": round(sum(s[1] for s in sl) / len(sl) * k, 4),
                            "aExt": round(sl[0][0] * k * k, 6), "aInt": round(sl[-1][0] * k * k, 6)}
    lm = [_to_volume(_geom(x)) for x in _inp_geoms("lames")]
    lm = [g for g in lm if isinstance(g, rg.Brep)]
    if lm:
        cs = [g.GetBoundingBox(True).Center for g in lm]
        cx = sum(c.X for c in cs) / len(cs)
        cy = sum(c.Y for c in cs) / len(cs)
        bl = []
        for g, c in zip(lm, cs):
            best, ba = None, 0.0
            for fc in g.Faces:
                amp = rg.AreaMassProperties.Compute(fc)
                if amp is not None and amp.Area > ba:
                    ba, best = amp.Area, fc
            if best is None:
                continue
            u = best.Domain(0).Mid
            v = best.Domain(1).Mid
            n = best.NormalAt(u, v)
            rx, ry = c.X - cx, c.Y - cy
            rn, nn = math.hypot(rx, ry), math.hypot(n.X, n.Y)
            closed = abs(n.X * rx + n.Y * ry) / (rn * nn) if rn > 1e-9 and nn > 1e-9 else 0.0
            bl.append([round(math.degrees(math.atan2(rx, ry)) % 360, 1), round(closed, 3), round(ba * k * k, 5)])
        out["blades"] = bl
    return out


def wall_metrics(k):
    """Briques posées -> par orientation (8 secteurs de 45°, 0 = nord, autour du centre des briques) :
    nombre, profondeur moyenne (m), part de la paroi couverte (0 à 1). Sert aux murs d'épaisseur variable."""
    bq = [_to_volume(_geom(x)) for x in _inp_geoms("briques")]
    bq = [g for g in bq if isinstance(g, (rg.Brep, rg.Mesh))]
    if not bq:
        return {}
    data = []
    for g in bq:
        pts = [v.Location for v in g.Vertices] if isinstance(g, rg.Brep) else [rg.Point3d(p) for p in g.Vertices]
        if len(pts) < 4:
            continue
        data.append(pts)
    if not data:
        return {}
    cx = sum(p.X for ps in data for p in ps) / sum(len(ps) for ps in data)
    cy = sum(p.Y for ps in data for p in ps) / sum(len(ps) for ps in data)
    zlo = min(p.Z for ps in data for p in ps)
    zhi = max(p.Z for ps in data for p in ps)
    sec = [{"n": 0, "d": 0.0, "a": 0.0, "r": 0.0} for _ in range(8)]
    for ps in data:
        mx = sum(p.X for p in ps) / len(ps)
        my = sum(p.Y for p in ps) / len(ps)
        az0 = math.atan2(mx - cx, my - cy)
        rs = [math.hypot(p.X - cx, p.Y - cy) for p in ps]
        angs = [((math.atan2(p.X - cx, p.Y - cy) - az0 + math.pi) % (2 * math.pi)) - math.pi for p in ps]
        rmean = sum(rs) / len(rs)
        depth = max(rs) - min(rs)
        width = (max(angs) - min(angs)) * rmean
        height = max(p.Z for p in ps) - min(p.Z for p in ps)
        s = sec[int(round((math.degrees(az0) % 360) / 45.0)) % 8]
        s["n"] += 1
        s["d"] += depth
        s["a"] += width * height
        s["r"] += rmean
    H = max(1e-6, zhi - zlo)
    out = []
    for i, s in enumerate(sec):
        if s["n"]:
            rm = s["r"] / s["n"]
            cover = min(1.0, s["a"] / (rm * math.pi / 4 * H))
            out.append({"az": 45 * i, "n": s["n"], "depth": round(s["d"] / s["n"] * k, 4), "cover": round(cover, 3)})
        else:
            out.append({"az": 45 * i, "n": 0, "depth": 0, "cover": 0})
    return {"wallK": out, "wallH": round(H * k, 3)}


def _station():
    """Seuils de la commande automatique (liste de nombres de l'entrée « station »)."""
    v = []
    for x in _inp_geoms("station"):
        try:
            v.append(float(x))
        except Exception:
            pass
    if len(v) < 5:
        return None
    return {"Ton": v[0], "HRoff": v[1], "Vstorm": v[2], "Nmin": v[3], "Prain": v[4]}


def _roof(k, z0):
    """Lames du toit (entrée « lames_toit ») et leur règle (« lames_regle ») : CL-WIND les fait tourner heure par heure."""
    blades = []
    for x in _inp_geoms("lames_toit"):
        g = _geom(x)
        if isinstance(g, rg.Brep) and g.IsSolid and g.Faces.Count == 6:
            bb = g.GetBoundingBox(True)
            g = rg.Box(bb)
        if not isinstance(g, rg.Box):
            continue
        pl = g.Plane
        dims = sorted([(g.X.Length, pl.XAxis), (g.Y.Length, pl.YAxis), (g.Z.Length, pl.ZAxis)], key=lambda d: -d[0])
        u = rg.Vector3d(dims[0][1].X, dims[0][1].Y, 0)
        if not u.Unitize():
            continue
        c = g.Center
        blades.append({"c": [round(c.X * k, 3), round(c.Y * k, 3), round(c.Z * k - z0, 3)], "u": [round(u.X, 4), round(u.Y, 4)],
                       "L": round(dims[0][0] * k, 3), "W": round(dims[1][0] * k, 3), "t": round(dims[2][0] * k, 3)})
    v = []
    for x in _inp_geoms("lames_regle"):
        try:
            v.append(float(x))
        except Exception:
            pass
    rule = {"Hd": v[0], "Hf": v[1], "Ts": v[2], "Av": v[3], "Te": v[4] if len(v) > 4 else None} if len(v) >= 4 else None
    return {"roofBlades": blades or None, "roofRule": rule if blades else None}


def _saison():
    v = _inp("saison")
    if v is None:
        return None
    if isinstance(v, bool):
        return "ete" if v else "hiver"
    t = str(v).strip().lower()
    if t in ("true", "1", "ete", "été", "e", "summer"):
        return "ete"
    if t in ("false", "0", "hiver", "h", "winter"):
        return "hiver"
    return None


def build_scene(k, tol):
    vols = [_geom(x) for x in _inp_geoms("volumes")]
    ecr = [_geom(x) for x in _inp_geoms("ecrans")]
    murs = [_geom(x) for x in _inp_geoms("murs")]
    arbres = [_geom(x) for x in _inp_geoms("arbres")]
    h = float(_inp("hauteur", 1.5))
    thick = float(_inp("epaisseur", 0.3))
    r_def = float(_inp("rayon", 5.0))
    dens = float(_inp("densite", 0.15))
    joint = _inp("joint")

    rings, screens, walls, trees, preview = [], [], [], [], []
    n_skip = 0
    cut_m = None

    def to_volumes(items):
        out, skip = [], 0
        for g in items:
            v = _to_volume(g)
            if v is None:
                if g is not None:
                    skip += 1
                continue
            out.append(v)
        return out, skip

    volumes, s1 = to_volumes(vols)
    ecrans, s2 = to_volumes(ecr)
    n_skip += s1 + s2

    # tolérance fine pour la coupe : les parois de brique et les lames (1 cm ou moins) sont souvent plus
    # minces que la tolérance du document ; avec elle, les contours se raccordent mal et restent ouverts
    ftol = min(tol, 0.0005 / k) if k > 0 else tol

    def section(items, plane):
        """Contours fermés (anneaux en m) de la coupe horizontale ; renvoie (anneaux, nb ouverts)."""
        res, n_open = [], 0
        for v in items:
            if isinstance(v, rg.Brep):
                try:
                    ok, crvs, _p = rg.Intersect.Intersection.BrepPlane(v, plane, ftol)
                    crvs = list(crvs) if ok and crvs else []
                except Exception:
                    crvs = list(rg.Brep.CreateContourCurves(v, plane) or [])
                crvs = rg.Curve.JoinCurves(crvs, ftol) or crvs
                polys = []
                for c in crvs:
                    if not c.IsClosed:
                        n_open += 1
                        continue
                    polys.append(_curve_pts(c, ftol))
            else:
                polys = []
                for pl in rg.Intersect.Intersection.MeshPlane(v, plane) or []:
                    if not pl.IsClosed:
                        n_open += 1
                        continue
                    polys.append([pl[i] for i in range(pl.Count)])
            for pts in polys:
                r = _ring(pts, k)
                if len(r) >= 3:
                    res.append(r)
                    preview.append(rg.PolylineCurve(pts))
        return res, n_open

    n_open = 0
    allv = volumes + ecrans
    if allv:
        zmin = min(_bbox(v).Min.Z for v in allv)
        zmax = max(_bbox(v).Max.Z for v in allv)
        z = zmin + h / k
        cut_m = h
        if z < zmax:
            plane = rg.Plane(rg.Point3d(0, 0, z), rg.Vector3d.ZAxis)
            rings, o1 = section(volumes, plane)
            screens, o2 = section(ecrans, plane)
            n_open = o1 + o2

    # maillages 3D (mètres, z depuis le point le plus bas) pour le calcul 3D de CL-WIND
    mesh3d = None
    if allv:
        z0 = zmin * k

        def pack(v):
            try:
                if isinstance(v, rg.Mesh):
                    m = v.DuplicateMesh()
                else:
                    parts = rg.Mesh.CreateFromBrep(v, rg.MeshingParameters.FastRenderMesh) or []
                    m = rg.Mesh()
                    for q in parts:
                        m.Append(q)
                m.Faces.ConvertQuadsToTriangles()
                vv, ff = [], []
                for p in m.Vertices:
                    vv += [round(p.X * k, 3), round(p.Y * k, 3), round(p.Z * k - z0, 3)]
                for fc in m.Faces:
                    ff += [fc.A, fc.B, fc.C]
                return [vv, ff] if ff else None
            except Exception:
                return None

        mv = [x for x in (pack(v) for v in volumes) if x]
        me = [x for x in (pack(v) for v in ecrans) if x]
        mesh3d = {"volumes": mv, "ecrans": me, "zmin": round(z0, 3)}

    for g in murs:
        if isinstance(g, rg.Line):
            g = rg.LineCurve(g)
        if isinstance(g, rg.Polyline):
            g = rg.PolylineCurve(g)
        if not isinstance(g, rg.Curve):
            if g is not None:
                n_skip += 1
            continue
        pts = _curve_pts(g, tol)
        p2 = [[round(p.X * k, 3), round(p.Y * k, 3)] for p in pts]
        if len(p2) >= 2:
            walls.append({"pts": p2, "thick": thick})

    for g in arbres:
        x = y = r = None
        if isinstance(g, rg.Point):
            g = g.Location
        if isinstance(g, rg.Point3d):
            x, y, r = g.X * k, g.Y * k, r_def
        elif isinstance(g, rg.Circle):
            x, y, r = g.Center.X * k, g.Center.Y * k, g.Radius * k
        elif isinstance(g, rg.Curve):
            ok, circ = g.TryGetCircle()
            if ok:
                x, y, r = circ.Center.X * k, circ.Center.Y * k, circ.Radius * k
        zc = rz = None
        if x is None and g is not None:
            b = _bbox(g)
            if b.IsValid:
                x, y = (b.Min.X + b.Max.X) / 2 * k, (b.Min.Y + b.Max.Y) / 2 * k
                r = max(b.Max.X - b.Min.X, b.Max.Y - b.Min.Y) / 2 * k
                if r < 0.5:
                    r = r_def
                elif b.Max.Z - b.Min.Z > 0.5:
                    # houppier donné en volume : sa vraie hauteur (centre et demi-hauteur, depuis le point le plus bas)
                    zb = zmin if allv else 0.0
                    zc, rz = ((b.Min.Z + b.Max.Z) / 2 - zb) * k, (b.Max.Z - b.Min.Z) / 2 * k
        if x is None:
            if g is not None:
                n_skip += 1
            continue
        tr = {"x": round(x, 3), "y": round(y, 3), "r": round(r, 3), "a": dens}
        if zc is not None:
            tr["zc"], tr["rz"] = round(zc, 3), round(rz, 3)
        trees.append(tr)

    # plantes grimpantes : une colonne de feuillage par fil, à sa vraie hauteur (z depuis le point le plus bas)
    zbase = zmin if allv else 0.0
    p_r = float(_inp("plantes_rayon", 0.15))
    p_a = float(_inp("plantes_densite", 0.6))
    n_pl = 0
    for g in [_geom(x) for x in _inp_geoms("plantes")]:
        if isinstance(g, rg.Line):
            g = rg.LineCurve(g)
        b = _bbox(g)
        if not b.IsValid:
            if g is not None:
                n_skip += 1
            continue
        z0, z1 = (b.Min.Z - zbase) * k, (b.Max.Z - zbase) * k
        if z1 - z0 < 0.05:
            continue
        trees.append({"x": round((b.Min.X + b.Max.X) / 2 * k, 3), "y": round((b.Min.Y + b.Max.Y) / 2 * k, 3),
                      "r": round(max(0.03, p_r), 3), "a": max(0.0, p_a), "z0": round(z0, 3), "z1": round(z1, 3), "kind": "plante"})
        n_pl += 1

    wind = None
    v, d = _inp("vitesse"), _inp("direction")
    if v is not None or d is not None:
        wind = {"speed": float(v) if v is not None else None, "dir": float(d) % 360 if d is not None else None}

    warn = []
    if allv and cut_m is not None and not rings and not screens and not n_open:
        warn.append("La coupe passe au-dessus de tous les volumes : baissez « hauteur ».")
    if n_skip:
        warn.append("%d objet(s) non reconnu(s), ignoré(s)." % n_skip)
    if vols and not volumes:
        warn.append("Aucun des %d objets de « volumes » n'est un volume reconnu (type %s)." % (len(vols), type(vols[0]).__name__))
    scene = {"rings": rings, "screens": screens, "walls": walls, "trees": trees, "wind": wind,
             "joint": float(joint) if joint is not None and float(joint) > 0 else None,
             "cut": cut_m, "open": n_open, "warn": " ".join(warn) or None, "mesh3d": mesh3d,
             "saison": _saison(), "plantes": n_pl, "station": _station(),
             "catch": (float(_inp("collecte")) if _inp("collecte") is not None and float(_inp("collecte")) > 0 else None)}
    try:
        scene.update(brick_metrics(k, tol))
    except Exception as e:
        scene["warn"] = ((scene["warn"] or "") + " Mesure de la brique impossible : %s" % e).strip()
    try:
        scene.update(_roof(k, mesh3d["zmin"] if mesh3d else 0.0))
    except Exception as e:
        scene["warn"] = ((scene["warn"] or "") + " Lecture des lames du toit impossible : %s" % e).strip()
    try:
        scene.update(wall_metrics(k))
    except Exception as e:
        scene["warn"] = ((scene["warn"] or "") + " Mesure des briques par orientation impossible : %s" % e).strip()
    return scene, preview


# ---------------------------------------------------------------- serveur
class LiveState(object):
    def __init__(self):
        self.cond = threading.Condition()
        self.rev = 0
        self.key = None
        self.body = b'{"rev":0}'
        self.closing = False
        self.last_seen = 0.0
        self.atlas_url = DEFAULT_ATLAS_URL
        self.atlas_dir = DEFAULT_ATLAS_DIR

    def atlas_file(self, name):
        """Fichier de l'atlas (liste fermée ATLAS_FILES) : par son serveur, sinon dans son dossier.
        Renvoie (octets, source) ou lève une erreur explicite."""
        rel = ATLAS_FILES.get(name)
        if rel is None:
            raise KeyError(name)
        errs = []
        if self.atlas_url:
            try:
                u = self.atlas_url.rstrip("/") + "/" + urllib.parse.quote(rel)
                with urllib.request.urlopen(u, timeout=8) as r:
                    return r.read(), "serveur de l'atlas (%s)" % self.atlas_url
            except Exception as e:
                errs.append("serveur %s : %s" % (self.atlas_url, e))
        if self.atlas_dir:
            p = os.path.join(self.atlas_dir, *rel.split("/"))
            if os.path.isfile(p):
                with open(p, "rb") as f:
                    return f.read(), "dossier de l'atlas"
            errs.append("fichier absent : %s" % p)
        raise IOError(" ; ".join(errs) or "atlas non renseigné")

    def publish(self, scene):
        key = json.dumps(scene, sort_keys=True, ensure_ascii=False)
        with self.cond:
            if key == self.key:
                return False
            self.key = key
            self.rev += 1
            d = dict(scene)
            d["rev"] = self.rev
            self.body = json.dumps(d, ensure_ascii=False).encode("utf-8")
            self.cond.notify_all()
        return True


# température et charge de la carte graphique NVIDIA (nvidia-smi), relues au plus toutes les 2 s ; le navigateur
# ne peut pas les lire lui-même. Sans carte NVIDIA ou sans nvidia-smi : {"ok": false}.
_GPU = {"t": 0.0, "v": {"ok": False}}
def gpu_info():
    if time.time() - _GPU["t"] < 2.0:
        return _GPU["v"]
    _GPU["t"] = time.time()
    try:
        import subprocess
        out = subprocess.run(["nvidia-smi", "--query-gpu=name,temperature.gpu,utilization.gpu,power.draw",
                              "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=3,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout.strip().splitlines()
        c = [x.strip() for x in out[0].split(",")]
        def num(s):
            try:
                return float(s)
            except ValueError:
                return None
        _GPU["v"] = {"ok": True, "name": c[0], "temp": num(c[1]), "load": num(c[2]), "power": num(c[3]) if len(c) > 3 else None}
    except Exception as e:
        _GPU["v"] = {"ok": False, "erreur": str(e)}
    return _GPU["v"]


def make_handler(state, app_dir):
    class Handler(http.server.SimpleHTTPRequestHandler):
        extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map)
        extensions_map.update({".js": "text/javascript", ".css": "text/css", ".html": "text/html; charset=utf-8",
                               ".wasm": "application/wasm", ".json": "application/json"})

        def __init__(self, *a, **kw):
            super().__init__(*a, directory=app_dir, **kw)

        def log_message(self, *a):
            pass

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def _json(self, code, body):
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            u = urllib.parse.urlparse(self.path)
            if u.path == "/live/ping":
                state.last_seen = time.time()
                return self._json(200, json.dumps({"clwind": True, "rev": state.rev, "version": VERSION}).encode())
            if u.path == "/live/scene":
                q = urllib.parse.parse_qs(u.query)
                try:
                    since = int(q.get("since", ["0"])[0])
                except ValueError:
                    since = 0
                state.last_seen = time.time()
                deadline = time.time() + 15.0
                with state.cond:
                    # rev < since : le serveur a redémarré, on renvoie la scène tout de suite
                    while (state.rev == since or state.rev == 0) and not state.closing and time.time() < deadline:
                        state.cond.wait(max(0.05, deadline - time.time()))
                    rev, body = state.rev, state.body
                state.last_seen = time.time()
                if rev == since or rev == 0:
                    self.send_response(204)
                    self.end_headers()
                    return
                return self._json(200, body)
            if u.path == "/live/gpu":
                return self._json(200, json.dumps(gpu_info(), ensure_ascii=False).encode("utf-8"))
            if u.path.startswith("/live/atlas/"):
                name = urllib.parse.unquote(u.path[len("/live/atlas/"):])
                try:
                    data, src = state.atlas_file(name)
                except KeyError:
                    return self._json(404, json.dumps({"erreur": "fichier non autorisé : %s" % name}, ensure_ascii=False).encode("utf-8"))
                except Exception as e:
                    return self._json(502, json.dumps({"erreur": "atlas injoignable : %s" % e}, ensure_ascii=False).encode("utf-8"))
                self.send_response(200)
                self.send_header("Content-Type", "text/csv; charset=utf-8" if name.endswith(".csv") else "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("X-Atlas-Source", urllib.parse.quote(src))
                self.end_headers()
                self.wfile.write(data)
                return
            return super().do_GET()
    return Handler


def stop_server(srv):
    st = srv["state"]
    with st.cond:
        st.closing = True
        st.cond.notify_all()
    try:
        srv["httpd"].shutdown()
        srv["httpd"].server_close()
    except Exception:
        pass


def ensure_server(port, app_dir):
    key = "clwind_live_%d" % port
    srv = sc.sticky.get(key)
    if srv and (srv.get("version") != VERSION or srv.get("app") != app_dir):
        stop_server(srv)
        srv = None
    if srv is None:
        state = LiveState()
        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), make_handler(state, app_dir))
        httpd.daemon_threads = True
        t = threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.25}, daemon=True)
        t.start()
        srv = {"httpd": httpd, "state": state, "version": VERSION, "app": app_dir, "opened": False}
        sc.sticky[key] = srv
    return srv


def open_browser(url):
    cands = [os.path.expandvars(p) for p in (
        r"%ProgramFiles%\Google\Chrome\Application\chrome.exe",
        r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe",
        r"%LocalAppData%\Google\Chrome\Application\chrome.exe",
        r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe",
        r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe")]
    # profil dédié à CL-WIND + carte graphique haute performance (NVIDIA, AMD dédiée) : sous Windows,
    # la page ne peut pas choisir la carte, et l'option n'agit que sur un navigateur qui démarre
    profil = os.path.join(os.path.expandvars(r"%LocalAppData%"), "CL-WIND", "navigateur")
    for c in cands:
        if os.path.isfile(c):
            subprocess.Popen([c, "--user-data-dir=" + profil, "--force_high_performance_gpu",
                              "--no-first-run", "--no-default-browser-check", "--new-window", url])
            return
    webbrowser.open(url)


# ---------------------------------------------------------------- composant
LIST_INPUTS = ("volumes", "ecrans", "murs", "arbres")
TREE_OPTIONAL = ("lames", "brique", "plantes", "briques", "station", "lames_toit", "lames_regle")  # passées en accès « arbre » si présentes, jamais signalées absentes
KNOWN_INPUTS = LIST_INPUTS + TREE_OPTIONAL + ("hauteur", "epaisseur", "rayon", "densite", "joint", "vitesse", "direction", "actif", "port", "dossier",
                                              "saison", "plantes_rayon", "plantes_densite", "atlas", "collecte")


def check_component():
    """Passe volumes, murs et arbres en accès « arbre » : le script tourne une seule fois et aplatit
    lui-même les données (en accès élément ou liste, il tournerait une fois par objet ou par branche
    et enverrait des scènes partielles). Renvoie (corrigé_en_cours, entrées_manquantes)."""
    comp = globals().get("ghenv")
    comp = getattr(comp, "Component", None)
    if comp is None:  # exécution hors Grasshopper (test)
        return False, []
    try:
        import Grasshopper as gh
        params = {}
        for p in comp.Params.Input:
            params[p.NickName.lower()] = p
            params[p.Name.lower()] = p
        missing = [n for n in LIST_INPUTS if n not in params]
        fix = [params[n] for n in LIST_INPUTS + TREE_OPTIONAL if n in params and params[n].Access != gh.Kernel.GH_ParamAccess.tree]
        if fix:
            def cb(doc):
                for p in fix:
                    p.Access = gh.Kernel.GH_ParamAccess.tree
                comp.Params.OnParametersChanged()
                comp.ExpireSolution(False)
            comp.OnPingDocument().ScheduleSolution(5, gh.Kernel.GH_Document.GH_ScheduleDelegate(cb))
            return True, missing
        return False, missing
    except Exception:
        return False, []


# ---------------------------------------------------------------- exécution
info, url, coupe = "", "", []
fixing, missing = check_component()
port = int(_inp("port", 8765))
def _find_app_dir():
    """Dossier de CL-WIND : entrée « dossier », sinon un dossier CL-WIND à côté du fichier .gh,
    sinon le chemin par défaut."""
    d = _inp("dossier")
    if d:
        return d
    try:
        gh_path = ghenv.Component.OnPingDocument().FilePath  # noqa: F821 (fourni par Grasshopper)
        if gh_path:
            cand = os.path.join(os.path.dirname(gh_path), "CL-WIND")
            if os.path.isfile(os.path.join(cand, "index.html")):
                return cand
    except Exception:
        pass
    return DEFAULT_APP_DIR


app_dir = _find_app_dir()
key = "clwind_live_%d" % port

if not _inp("actif", True):
    srv = sc.sticky.pop(key, None)
    if srv:
        stop_server(srv)
    info = "Liaison Analyse du vent arrêtée."
elif fixing:
    info = "Entrées volumes, murs, arbres passées en accès « liste », recalcul…"
elif not os.path.isfile(os.path.join(app_dir, "index.html")):
    info = "Dossier de l'application (CL-WIND) introuvable : %s\nRenseignez l'entrée « dossier »." % app_dir
else:
    doc = Rhino.RhinoDoc.ActiveDoc
    k = Rhino.RhinoMath.UnitScale(doc.ModelUnitSystem, Rhino.UnitSystem.Meters)
    tol = doc.ModelAbsoluteTolerance
    try:
        srv = ensure_server(port, app_dir)
    except OSError as e:
        srv = None
        info = "Port %d indisponible (%s). Changez l'entrée « port »." % (port, e)
    if srv:
        url = "http://127.0.0.1:%d/" % port
        at = _inp("atlas")
        if at:
            at = str(at).strip()
            if at.lower().startswith("http"):
                srv["state"].atlas_url, srv["state"].atlas_dir = at, DEFAULT_ATLAS_DIR
            else:
                srv["state"].atlas_url, srv["state"].atlas_dir = DEFAULT_ATLAS_URL, at
        scene, coupe = build_scene(k, tol)
        scene["doc"] = doc.Name or None
        changed = srv["state"].publish(scene)
        if not srv["opened"]:
            # n'ouvre une fenêtre que si aucune page CL-WIND ne s'est reconnectée (redémarrage du serveur)
            srv["opened"] = True
            st0 = srv["state"]
            def _maybe_open():
                if time.time() - st0.last_seen > 6:
                    open_browser(url)
            threading.Timer(6.0, _maybe_open).start()
        seen = time.time() - srv["state"].last_seen < 20
        info = ("Envoi n° %d%s. %d contour(s) de bâtiment, %d élément(s) d'écran poreux, %d mur(s), %d arbre(s)%s.\n%s\nUnités : 1 unité = %g m."
                % (srv["state"].rev, "" if changed else " (inchangé)", len(scene["rings"]), len(scene["screens"]), len(scene["walls"]),
                   len(scene["trees"]), (", %d contour(s) ouvert(s) ignoré(s)" % scene["open"]) if scene["open"] else "",
                   ("Analyse du vent connectée : " if seen else "Ouvrez Analyse du vent : ") + url, k))
        extra = []
        if scene.get("saison"):
            extra.append("géométrie d'%s" % ("été" if scene["saison"] == "ete" else "hiver"))
        if scene.get("plantes"):
            extra.append("%d colonne(s) de plantes" % scene["plantes"])
        if scene.get("catch"):
            extra.append("collecte de pluie %.0f m²" % scene["catch"])
        if scene.get("station"):
            st = scene["station"]
            extra.append("station : pompe si air ≥ %g °C et humidité < %g %%, clapets fermés si vent ≥ %g m/s" % (st["Ton"], st["HRoff"], st["Vstorm"]))
        if scene.get("wallK"):
            extra.append("briques par orientation : " + ", ".join("%s %d cm" % (("N", "NE", "E", "SE", "S", "SO", "O", "NO")[i], round(w["depth"] * 100))
                                                                for i, w in enumerate(scene["wallK"]) if w["n"]))
        if extra:
            info += "\n" + " ; ".join(extra) + "."
        if scene["warn"]:
            info += "\n" + scene["warn"]
        if missing:
            info += "\nEntrée(s) absente(s) : %s (clic droit sur le composant, ajoutez-les avec ces noms)." % ", ".join(missing)
