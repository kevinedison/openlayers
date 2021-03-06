import Map from '../src/ol/Map.js';
import View from '../src/ol/View.js';
import {defaults as defaultControls} from '../src/ol/control.js';
import TileLayer from '../src/ol/layer/Tile.js';
import OSM from '../src/ol/source/OSM.js';


var map = new Map({
  layers: [
    new TileLayer({
      source: new OSM()
    })
  ],
  target: 'map',
  controls: defaultControls({
    attributionOptions: {
      collapsible: false
    }
  }),
  view: new View({
    center: [0, 0],
    zoom: 2
  })
});

document.getElementById('zoom-out').onclick = function() {
  var view = map.getView();
  var zoom = view.getZoom();
  view.setZoom(zoom - 1);
};

document.getElementById('zoom-in').onclick = function() {
  var view = map.getView();
  var zoom = view.getZoom();
  view.setZoom(zoom + 1);
};
