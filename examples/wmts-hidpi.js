import Map from '../src/ol/Map.js';
import View from '../src/ol/View.js';
import _ol_format_WMTSCapabilities_ from '../src/ol/format/WMTSCapabilities.js';
import _ol_has_ from '../src/ol/has.js';
import TileLayer from '../src/ol/layer/Tile.js';
import WMTS from '../src/ol/source/WMTS.js';


var capabilitiesUrl = 'https://www.basemap.at/wmts/1.0.0/WMTSCapabilities.xml';

// HiDPI support:
// * Use 'bmaphidpi' layer (pixel ratio 2) for device pixel ratio > 1
// * Use 'geolandbasemap' layer (pixel ratio 1) for device pixel ratio == 1
var hiDPI = _ol_has_.DEVICE_PIXEL_RATIO > 1;
var layer = hiDPI ? 'bmaphidpi' : 'geolandbasemap';
var tilePixelRatio = hiDPI ? 2 : 1;

var map = new Map({
  target: 'map',
  view: new View({
    center: [1823849, 6143760],
    zoom: 11
  })
});

fetch(capabilitiesUrl).then(function(response) {
  return response.text();
}).then(function(text) {
  var result = new _ol_format_WMTSCapabilities_().read(text);
  var options = WMTS.optionsFromCapabilities(result, {
    layer: layer,
    matrixSet: 'google3857',
    style: 'normal'
  });
  options.tilePixelRatio = tilePixelRatio;
  map.addLayer(new TileLayer({
    source: new WMTS(/** @type {!olx.source.WMTSOptions} */ (options))
  }));
});
