# Vectorises the terrain class raster into src/terrain.json (run in the QGIS Python console, or via the QGIS MCP).
# Input:  assets/world/terrain/terrain_geo.png + .json from `node tools/world/terrain-classify.mjs`
# Output: assets/world/terrain/terrain.geojson -> copy to src/terrain.json
# Per class: polygonize -> drop specks (atlas text leaves some) -> smooth -> simplify. Land (everything but sea) is one underlay.
import json, processing
from osgeo import gdal, osr
from qgis.core import QgsVectorLayer, QgsFeature, QgsVectorFileWriter, QgsProject, QgsWkbTypes

base = 'assets/world/terrain'
meta = json.load(open(base + '/terrain_geo.json'))
src = gdal.Open(base + '/terrain_geo.png'); arr = src.GetRasterBand(1).ReadAsArray(); src = None  # keep src alive while reading
srs = osr.SpatialReference(); srs.ImportFromEPSG(4326)
o = gdal.GetDriverByName('GTiff').Create(base + '/terrain_geo.tif', meta['width'], meta['height'], 1, gdal.GDT_Byte, ['COMPRESS=LZW'])
o.SetGeoTransform((meta['lon0'], meta['step'], 0, meta['lat1'], 0, -meta['step'])); o.SetProjection(srs.ExportToWkt())
b = o.GetRasterBand(1); b.WriteArray(arr); b.SetNoDataValue(0); o.FlushCache(); o = None

T = 'TEMPORARY_OUTPUT'
poly = processing.run('gdal:polygonize', {'INPUT': base + '/terrain_geo.tif', 'BAND': 1, 'FIELD': 'c', 'EIGHT_CONNECTEDNESS': False, 'OUTPUT': base + '/terrain_poly.gpkg'})['OUTPUT']
MIN = {3: 0.05, 4: 0.05, 5: 0.05, 6: 0.04, 7: 0.03, 8: 0.2}  # deg^2 per class: forest, swamp, desert, hills, mountains, snow
NAMES = {3: 'forest', 4: 'swamp', 5: 'desert', 6: 'hills', 7: 'mountains', 8: 'snow'}

def clean(layer, keep, tol=0.035):
    sp = processing.run('native:multiparttosingleparts', {'INPUT': layer, 'OUTPUT': T})['OUTPUT']
    k = processing.run('native:extractbyexpression', {'INPUT': sp, 'EXPRESSION': 'area($geometry) >= %f' % keep, 'OUTPUT': T})['OUTPUT']
    s = processing.run('native:smoothgeometry', {'INPUT': k, 'ITERATIONS': 2, 'OFFSET': 0.25, 'MAX_ANGLE': 180, 'OUTPUT': T})['OUTPUT']
    return processing.run('native:simplifygeometries', {'INPUT': s, 'METHOD': 0, 'TOLERANCE': tol, 'OUTPUT': T})['OUTPUT']

out = QgsVectorLayer('MultiPolygon?crs=EPSG:4326&field=c:string', 'terrain_vector', 'memory'); pr = out.dataProvider(); feats = []
def add(layer, name):
    for f in layer.getFeatures():
        # snap to the written precision first: rounding collapses thin necks into lines, which the writer would emit as collections
        g = f.geometry().snappedToGrid(0.01, 0.01).makeValid(); g.convertGeometryCollectionToSubclass(QgsWkbTypes.PolygonGeometry); g.convertToMultiType()
        if g.isEmpty(): continue
        nf = QgsFeature(out.fields()); nf.setGeometry(g); nf.setAttributes([name]); feats.append(nf)

land = processing.run('native:extractbyexpression', {'INPUT': poly, 'EXPRESSION': '"c" > 1', 'OUTPUT': T})['OUTPUT']
land = processing.run('native:dissolve', {'INPUT': land, 'OUTPUT': T})['OUTPUT']
land = processing.run('native:deleteholes', {'INPUT': land, 'MIN_AREA': 0.02, 'OUTPUT': T})['OUTPUT']
add(clean(land, 0.006), 'plains')
for cid, name in NAMES.items():
    lay = processing.run('native:extractbyexpression', {'INPUT': poly, 'EXPRESSION': '"c" = %d' % cid, 'OUTPUT': T})['OUTPUT']
    lay = processing.run('native:dissolve', {'INPUT': lay, 'OUTPUT': T})['OUTPUT']
    add(clean(lay, MIN[cid]), name)
pr.addFeatures(feats); out.updateExtents()
opts = QgsVectorFileWriter.SaveVectorOptions(); opts.driverName = 'GeoJSON'; opts.layerOptions = ['COORDINATE_PRECISION=2', 'RFC7946=YES']
print(QgsVectorFileWriter.writeAsVectorFormatV3(out, base + '/terrain.geojson', QgsProject.instance().transformContext(), opts))
