/**
 * @module ol/interaction/Draw
 */
import {inherits} from '../index.js';
import Feature from '../Feature.js';
import MapBrowserEventType from '../MapBrowserEventType.js';
import BaseObject from '../Object.js';
import _ol_coordinate_ from '../coordinate.js';
import _ol_events_ from '../events.js';
import Event from '../events/Event.js';
import _ol_events_condition_ from '../events/condition.js';
import {boundingExtent, getBottomLeft, getBottomRight, getTopLeft, getTopRight} from '../extent.js';
import {TRUE, FALSE} from '../functions.js';
import Circle from '../geom/Circle.js';
import GeometryType from '../geom/GeometryType.js';
import LineString from '../geom/LineString.js';
import MultiLineString from '../geom/MultiLineString.js';
import MultiPoint from '../geom/MultiPoint.js';
import MultiPolygon from '../geom/MultiPolygon.js';
import Point from '../geom/Point.js';
import Polygon, {fromCircle, makeRegular} from '../geom/Polygon.js';
import DrawEventType from '../interaction/DrawEventType.js';
import _ol_interaction_Pointer_ from '../interaction/Pointer.js';
import _ol_interaction_Property_ from '../interaction/Property.js';
import VectorLayer from '../layer/Vector.js';
import VectorSource from '../source/Vector.js';
import _ol_style_Style_ from '../style/Style.js';

/**
 * @classdesc
 * Interaction for drawing feature geometries.
 *
 * @constructor
 * @extends {ol.interaction.Pointer}
 * @fires ol.interaction.Draw.Event
 * @param {olx.interaction.DrawOptions} options Options.
 * @api
 */
var Draw = function(options) {

  _ol_interaction_Pointer_.call(this, {
    handleDownEvent: Draw.handleDownEvent_,
    handleEvent: Draw.handleEvent,
    handleUpEvent: Draw.handleUpEvent_
  });

  /**
   * @type {boolean}
   * @private
   */
  this.shouldHandle_ = false;

  /**
   * @type {ol.Pixel}
   * @private
   */
  this.downPx_ = null;

  /**
   * @type {boolean}
   * @private
   */
  this.freehand_ = false;

  /**
   * Target source for drawn features.
   * @type {ol.source.Vector}
   * @private
   */
  this.source_ = options.source ? options.source : null;

  /**
   * Target collection for drawn features.
   * @type {ol.Collection.<ol.Feature>}
   * @private
   */
  this.features_ = options.features ? options.features : null;

  /**
   * Pixel distance for snapping.
   * @type {number}
   * @private
   */
  this.snapTolerance_ = options.snapTolerance ? options.snapTolerance : 12;

  /**
   * Geometry type.
   * @type {ol.geom.GeometryType}
   * @private
   */
  this.type_ = /** @type {ol.geom.GeometryType} */ (options.type);

  /**
   * Drawing mode (derived from geometry type.
   * @type {ol.interaction.Draw.Mode_}
   * @private
   */
  this.mode_ = Draw.getMode_(this.type_);

  /**
   * Stop click, singleclick, and doubleclick events from firing during drawing.
   * Default is `false`.
   * @type {boolean}
   * @private
   */
  this.stopClick_ = !!options.stopClick;

  /**
   * The number of points that must be drawn before a polygon ring or line
   * string can be finished.  The default is 3 for polygon rings and 2 for
   * line strings.
   * @type {number}
   * @private
   */
  this.minPoints_ = options.minPoints ?
    options.minPoints :
    (this.mode_ === Draw.Mode_.POLYGON ? 3 : 2);

  /**
   * The number of points that can be drawn before a polygon ring or line string
   * is finished. The default is no restriction.
   * @type {number}
   * @private
   */
  this.maxPoints_ = options.maxPoints ? options.maxPoints : Infinity;

  /**
   * A function to decide if a potential finish coordinate is permissible
   * @private
   * @type {ol.EventsConditionType}
   */
  this.finishCondition_ = options.finishCondition ? options.finishCondition : TRUE;

  var geometryFunction = options.geometryFunction;
  if (!geometryFunction) {
    if (this.type_ === GeometryType.CIRCLE) {
      /**
       * @param {!Array.<ol.Coordinate>} coordinates
       *     The coordinates.
       * @param {ol.geom.SimpleGeometry=} opt_geometry Optional geometry.
       * @return {ol.geom.SimpleGeometry} A geometry.
       */
      geometryFunction = function(coordinates, opt_geometry) {
        var circle = opt_geometry ? /** @type {ol.geom.Circle} */ (opt_geometry) :
          new Circle([NaN, NaN]);
        var squaredLength = _ol_coordinate_.squaredDistance(
            coordinates[0], coordinates[1]);
        circle.setCenterAndRadius(coordinates[0], Math.sqrt(squaredLength));
        return circle;
      };
    } else {
      var Constructor;
      var mode = this.mode_;
      if (mode === Draw.Mode_.POINT) {
        Constructor = Point;
      } else if (mode === Draw.Mode_.LINE_STRING) {
        Constructor = LineString;
      } else if (mode === Draw.Mode_.POLYGON) {
        Constructor = Polygon;
      }
      /**
       * @param {!Array.<ol.Coordinate>} coordinates
       *     The coordinates.
       * @param {ol.geom.SimpleGeometry=} opt_geometry Optional geometry.
       * @return {ol.geom.SimpleGeometry} A geometry.
       */
      geometryFunction = function(coordinates, opt_geometry) {
        var geometry = opt_geometry;
        if (geometry) {
          if (mode === Draw.Mode_.POLYGON) {
            if (coordinates[0].length) {
              // Add a closing coordinate to match the first
              geometry.setCoordinates([coordinates[0].concat([coordinates[0][0]])]);
            } else {
              geometry.setCoordinates([]);
            }
          } else {
            geometry.setCoordinates(coordinates);
          }
        } else {
          geometry = new Constructor(coordinates);
        }
        return geometry;
      };
    }
  }

  /**
   * @type {ol.DrawGeometryFunctionType}
   * @private
   */
  this.geometryFunction_ = geometryFunction;

  /**
   * Finish coordinate for the feature (first point for polygons, last point for
   * linestrings).
   * @type {ol.Coordinate}
   * @private
   */
  this.finishCoordinate_ = null;

  /**
   * Sketch feature.
   * @type {ol.Feature}
   * @private
   */
  this.sketchFeature_ = null;

  /**
   * Sketch point.
   * @type {ol.Feature}
   * @private
   */
  this.sketchPoint_ = null;

  /**
   * Sketch coordinates. Used when drawing a line or polygon.
   * @type {ol.Coordinate|Array.<ol.Coordinate>|Array.<Array.<ol.Coordinate>>}
   * @private
   */
  this.sketchCoords_ = null;

  /**
   * Sketch line. Used when drawing polygon.
   * @type {ol.Feature}
   * @private
   */
  this.sketchLine_ = null;

  /**
   * Sketch line coordinates. Used when drawing a polygon or circle.
   * @type {Array.<ol.Coordinate>}
   * @private
   */
  this.sketchLineCoords_ = null;

  /**
   * Squared tolerance for handling up events.  If the squared distance
   * between a down and up event is greater than this tolerance, up events
   * will not be handled.
   * @type {number}
   * @private
   */
  this.squaredClickTolerance_ = options.clickTolerance ?
    options.clickTolerance * options.clickTolerance : 36;

  /**
   * Draw overlay where our sketch features are drawn.
   * @type {ol.layer.Vector}
   * @private
   */
  this.overlay_ = new VectorLayer({
    source: new VectorSource({
      useSpatialIndex: false,
      wrapX: options.wrapX ? options.wrapX : false
    }),
    style: options.style ? options.style :
      Draw.getDefaultStyleFunction()
  });

  /**
   * Name of the geometry attribute for newly created features.
   * @type {string|undefined}
   * @private
   */
  this.geometryName_ = options.geometryName;

  /**
   * @private
   * @type {ol.EventsConditionType}
   */
  this.condition_ = options.condition ?
    options.condition : _ol_events_condition_.noModifierKeys;

  /**
   * @private
   * @type {ol.EventsConditionType}
   */
  this.freehandCondition_;
  if (options.freehand) {
    this.freehandCondition_ = _ol_events_condition_.always;
  } else {
    this.freehandCondition_ = options.freehandCondition ?
      options.freehandCondition : _ol_events_condition_.shiftKeyOnly;
  }

  _ol_events_.listen(this,
      BaseObject.getChangeEventType(_ol_interaction_Property_.ACTIVE),
      this.updateState_, this);

};

inherits(Draw, _ol_interaction_Pointer_);


/**
 * @return {ol.StyleFunction} Styles.
 */
Draw.getDefaultStyleFunction = function() {
  var styles = _ol_style_Style_.createDefaultEditing();
  return function(feature, resolution) {
    return styles[feature.getGeometry().getType()];
  };
};


/**
 * @inheritDoc
 */
Draw.prototype.setMap = function(map) {
  _ol_interaction_Pointer_.prototype.setMap.call(this, map);
  this.updateState_();
};


/**
 * Handles the {@link ol.MapBrowserEvent map browser event} and may actually
 * draw or finish the drawing.
 * @param {ol.MapBrowserEvent} event Map browser event.
 * @return {boolean} `false` to stop event propagation.
 * @this {ol.interaction.Draw}
 * @api
 */
Draw.handleEvent = function(event) {
  this.freehand_ = this.mode_ !== Draw.Mode_.POINT && this.freehandCondition_(event);
  var pass = true;
  if (this.freehand_ &&
      event.type === MapBrowserEventType.POINTERDRAG &&
      this.sketchFeature_ !== null) {
    this.addToDrawing_(event);
    pass = false;
  } else if (this.freehand_ &&
      event.type === MapBrowserEventType.POINTERDOWN) {
    pass = false;
  } else if (event.type === MapBrowserEventType.POINTERMOVE) {
    pass = this.handlePointerMove_(event);
  } else if (event.type === MapBrowserEventType.DBLCLICK) {
    pass = false;
  }
  return _ol_interaction_Pointer_.handleEvent.call(this, event) && pass;
};


/**
 * @param {ol.MapBrowserPointerEvent} event Event.
 * @return {boolean} Start drag sequence?
 * @this {ol.interaction.Draw}
 * @private
 */
Draw.handleDownEvent_ = function(event) {
  this.shouldHandle_ = !this.freehand_;

  if (this.freehand_) {
    this.downPx_ = event.pixel;
    if (!this.finishCoordinate_) {
      this.startDrawing_(event);
    }
    return true;
  } else if (this.condition_(event)) {
    this.downPx_ = event.pixel;
    return true;
  } else {
    return false;
  }
};


/**
 * @param {ol.MapBrowserPointerEvent} event Event.
 * @return {boolean} Stop drag sequence?
 * @this {ol.interaction.Draw}
 * @private
 */
Draw.handleUpEvent_ = function(event) {
  var pass = true;

  this.handlePointerMove_(event);

  var circleMode = this.mode_ === Draw.Mode_.CIRCLE;

  if (this.shouldHandle_) {
    if (!this.finishCoordinate_) {
      this.startDrawing_(event);
      if (this.mode_ === Draw.Mode_.POINT) {
        this.finishDrawing();
      }
    } else if (this.freehand_ || circleMode) {
      this.finishDrawing();
    } else if (this.atFinish_(event)) {
      if (this.finishCondition_(event)) {
        this.finishDrawing();
      }
    } else {
      this.addToDrawing_(event);
    }
    pass = false;
  } else if (this.freehand_) {
    this.finishCoordinate_ = null;
    this.abortDrawing_();
  }
  if (!pass && this.stopClick_) {
    event.stopPropagation();
  }
  return pass;
};


/**
 * Handle move events.
 * @param {ol.MapBrowserEvent} event A move event.
 * @return {boolean} Pass the event to other interactions.
 * @private
 */
Draw.prototype.handlePointerMove_ = function(event) {
  if (this.downPx_ &&
      ((!this.freehand_ && this.shouldHandle_) ||
      (this.freehand_ && !this.shouldHandle_))) {
    var downPx = this.downPx_;
    var clickPx = event.pixel;
    var dx = downPx[0] - clickPx[0];
    var dy = downPx[1] - clickPx[1];
    var squaredDistance = dx * dx + dy * dy;
    this.shouldHandle_ = this.freehand_ ?
      squaredDistance > this.squaredClickTolerance_ :
      squaredDistance <= this.squaredClickTolerance_;
  }

  if (this.finishCoordinate_) {
    this.modifyDrawing_(event);
  } else {
    this.createOrUpdateSketchPoint_(event);
  }
  return true;
};


/**
 * Determine if an event is within the snapping tolerance of the start coord.
 * @param {ol.MapBrowserEvent} event Event.
 * @return {boolean} The event is within the snapping tolerance of the start.
 * @private
 */
Draw.prototype.atFinish_ = function(event) {
  var at = false;
  if (this.sketchFeature_) {
    var potentiallyDone = false;
    var potentiallyFinishCoordinates = [this.finishCoordinate_];
    if (this.mode_ === Draw.Mode_.LINE_STRING) {
      potentiallyDone = this.sketchCoords_.length > this.minPoints_;
    } else if (this.mode_ === Draw.Mode_.POLYGON) {
      potentiallyDone = this.sketchCoords_[0].length >
          this.minPoints_;
      potentiallyFinishCoordinates = [this.sketchCoords_[0][0],
        this.sketchCoords_[0][this.sketchCoords_[0].length - 2]];
    }
    if (potentiallyDone) {
      var map = event.map;
      for (var i = 0, ii = potentiallyFinishCoordinates.length; i < ii; i++) {
        var finishCoordinate = potentiallyFinishCoordinates[i];
        var finishPixel = map.getPixelFromCoordinate(finishCoordinate);
        var pixel = event.pixel;
        var dx = pixel[0] - finishPixel[0];
        var dy = pixel[1] - finishPixel[1];
        var snapTolerance = this.freehand_ ? 1 : this.snapTolerance_;
        at = Math.sqrt(dx * dx + dy * dy) <= snapTolerance;
        if (at) {
          this.finishCoordinate_ = finishCoordinate;
          break;
        }
      }
    }
  }
  return at;
};


/**
 * @param {ol.MapBrowserEvent} event Event.
 * @private
 */
Draw.prototype.createOrUpdateSketchPoint_ = function(event) {
  var coordinates = event.coordinate.slice();
  if (!this.sketchPoint_) {
    this.sketchPoint_ = new Feature(new Point(coordinates));
    this.updateSketchFeatures_();
  } else {
    var sketchPointGeom = /** @type {ol.geom.Point} */ (this.sketchPoint_.getGeometry());
    sketchPointGeom.setCoordinates(coordinates);
  }
};


/**
 * Start the drawing.
 * @param {ol.MapBrowserEvent} event Event.
 * @private
 */
Draw.prototype.startDrawing_ = function(event) {
  var start = event.coordinate;
  this.finishCoordinate_ = start;
  if (this.mode_ === Draw.Mode_.POINT) {
    this.sketchCoords_ = start.slice();
  } else if (this.mode_ === Draw.Mode_.POLYGON) {
    this.sketchCoords_ = [[start.slice(), start.slice()]];
    this.sketchLineCoords_ = this.sketchCoords_[0];
  } else {
    this.sketchCoords_ = [start.slice(), start.slice()];
    if (this.mode_ === Draw.Mode_.CIRCLE) {
      this.sketchLineCoords_ = this.sketchCoords_;
    }
  }
  if (this.sketchLineCoords_) {
    this.sketchLine_ = new Feature(
        new LineString(this.sketchLineCoords_));
  }
  var geometry = this.geometryFunction_(this.sketchCoords_);
  this.sketchFeature_ = new Feature();
  if (this.geometryName_) {
    this.sketchFeature_.setGeometryName(this.geometryName_);
  }
  this.sketchFeature_.setGeometry(geometry);
  this.updateSketchFeatures_();
  this.dispatchEvent(new Draw.Event(DrawEventType.DRAWSTART, this.sketchFeature_));
};


/**
 * Modify the drawing.
 * @param {ol.MapBrowserEvent} event Event.
 * @private
 */
Draw.prototype.modifyDrawing_ = function(event) {
  var coordinate = event.coordinate;
  var geometry = /** @type {ol.geom.SimpleGeometry} */ (this.sketchFeature_.getGeometry());
  var coordinates, last;
  if (this.mode_ === Draw.Mode_.POINT) {
    last = this.sketchCoords_;
  } else if (this.mode_ === Draw.Mode_.POLYGON) {
    coordinates = this.sketchCoords_[0];
    last = coordinates[coordinates.length - 1];
    if (this.atFinish_(event)) {
      // snap to finish
      coordinate = this.finishCoordinate_.slice();
    }
  } else {
    coordinates = this.sketchCoords_;
    last = coordinates[coordinates.length - 1];
  }
  last[0] = coordinate[0];
  last[1] = coordinate[1];
  this.geometryFunction_(/** @type {!Array.<ol.Coordinate>} */ (this.sketchCoords_), geometry);
  if (this.sketchPoint_) {
    var sketchPointGeom = /** @type {ol.geom.Point} */ (this.sketchPoint_.getGeometry());
    sketchPointGeom.setCoordinates(coordinate);
  }
  var sketchLineGeom;
  if (geometry instanceof Polygon &&
      this.mode_ !== Draw.Mode_.POLYGON) {
    if (!this.sketchLine_) {
      this.sketchLine_ = new Feature(new LineString(null));
    }
    var ring = geometry.getLinearRing(0);
    sketchLineGeom = /** @type {ol.geom.LineString} */ (this.sketchLine_.getGeometry());
    sketchLineGeom.setFlatCoordinates(
        ring.getLayout(), ring.getFlatCoordinates());
  } else if (this.sketchLineCoords_) {
    sketchLineGeom = /** @type {ol.geom.LineString} */ (this.sketchLine_.getGeometry());
    sketchLineGeom.setCoordinates(this.sketchLineCoords_);
  }
  this.updateSketchFeatures_();
};


/**
 * Add a new coordinate to the drawing.
 * @param {ol.MapBrowserEvent} event Event.
 * @private
 */
Draw.prototype.addToDrawing_ = function(event) {
  var coordinate = event.coordinate;
  var geometry = /** @type {ol.geom.SimpleGeometry} */ (this.sketchFeature_.getGeometry());
  var done;
  var coordinates;
  if (this.mode_ === Draw.Mode_.LINE_STRING) {
    this.finishCoordinate_ = coordinate.slice();
    coordinates = this.sketchCoords_;
    if (coordinates.length >= this.maxPoints_) {
      if (this.freehand_) {
        coordinates.pop();
      } else {
        done = true;
      }
    }
    coordinates.push(coordinate.slice());
    this.geometryFunction_(coordinates, geometry);
  } else if (this.mode_ === Draw.Mode_.POLYGON) {
    coordinates = this.sketchCoords_[0];
    if (coordinates.length >= this.maxPoints_) {
      if (this.freehand_) {
        coordinates.pop();
      } else {
        done = true;
      }
    }
    coordinates.push(coordinate.slice());
    if (done) {
      this.finishCoordinate_ = coordinates[0];
    }
    this.geometryFunction_(this.sketchCoords_, geometry);
  }
  this.updateSketchFeatures_();
  if (done) {
    this.finishDrawing();
  }
};


/**
 * Remove last point of the feature currently being drawn.
 * @api
 */
Draw.prototype.removeLastPoint = function() {
  if (!this.sketchFeature_) {
    return;
  }
  var geometry = /** @type {ol.geom.SimpleGeometry} */ (this.sketchFeature_.getGeometry());
  var coordinates, sketchLineGeom;
  if (this.mode_ === Draw.Mode_.LINE_STRING) {
    coordinates = this.sketchCoords_;
    coordinates.splice(-2, 1);
    this.geometryFunction_(coordinates, geometry);
    if (coordinates.length >= 2) {
      this.finishCoordinate_ = coordinates[coordinates.length - 2].slice();
    }
  } else if (this.mode_ === Draw.Mode_.POLYGON) {
    coordinates = this.sketchCoords_[0];
    coordinates.splice(-2, 1);
    sketchLineGeom = /** @type {ol.geom.LineString} */ (this.sketchLine_.getGeometry());
    sketchLineGeom.setCoordinates(coordinates);
    this.geometryFunction_(this.sketchCoords_, geometry);
  }

  if (coordinates.length === 0) {
    this.finishCoordinate_ = null;
  }

  this.updateSketchFeatures_();
};


/**
 * Stop drawing and add the sketch feature to the target layer.
 * The {@link ol.interaction.DrawEventType.DRAWEND} event is dispatched before
 * inserting the feature.
 * @api
 */
Draw.prototype.finishDrawing = function() {
  var sketchFeature = this.abortDrawing_();
  var coordinates = this.sketchCoords_;
  var geometry = /** @type {ol.geom.SimpleGeometry} */ (sketchFeature.getGeometry());
  if (this.mode_ === Draw.Mode_.LINE_STRING) {
    // remove the redundant last point
    coordinates.pop();
    this.geometryFunction_(coordinates, geometry);
  } else if (this.mode_ === Draw.Mode_.POLYGON) {
    // remove the redundant last point in ring
    coordinates[0].pop();
    this.geometryFunction_(coordinates, geometry);
    coordinates = geometry.getCoordinates();
  }

  // cast multi-part geometries
  if (this.type_ === GeometryType.MULTI_POINT) {
    sketchFeature.setGeometry(new MultiPoint([coordinates]));
  } else if (this.type_ === GeometryType.MULTI_LINE_STRING) {
    sketchFeature.setGeometry(new MultiLineString([coordinates]));
  } else if (this.type_ === GeometryType.MULTI_POLYGON) {
    sketchFeature.setGeometry(new MultiPolygon([coordinates]));
  }

  // First dispatch event to allow full set up of feature
  this.dispatchEvent(new Draw.Event(DrawEventType.DRAWEND, sketchFeature));

  // Then insert feature
  if (this.features_) {
    this.features_.push(sketchFeature);
  }
  if (this.source_) {
    this.source_.addFeature(sketchFeature);
  }
};


/**
 * Stop drawing without adding the sketch feature to the target layer.
 * @return {ol.Feature} The sketch feature (or null if none).
 * @private
 */
Draw.prototype.abortDrawing_ = function() {
  this.finishCoordinate_ = null;
  var sketchFeature = this.sketchFeature_;
  if (sketchFeature) {
    this.sketchFeature_ = null;
    this.sketchPoint_ = null;
    this.sketchLine_ = null;
    this.overlay_.getSource().clear(true);
  }
  return sketchFeature;
};


/**
 * Extend an existing geometry by adding additional points. This only works
 * on features with `LineString` geometries, where the interaction will
 * extend lines by adding points to the end of the coordinates array.
 * @param {!ol.Feature} feature Feature to be extended.
 * @api
 */
Draw.prototype.extend = function(feature) {
  var geometry = feature.getGeometry();
  var lineString = /** @type {ol.geom.LineString} */ (geometry);
  this.sketchFeature_ = feature;
  this.sketchCoords_ = lineString.getCoordinates();
  var last = this.sketchCoords_[this.sketchCoords_.length - 1];
  this.finishCoordinate_ = last.slice();
  this.sketchCoords_.push(last.slice());
  this.updateSketchFeatures_();
  this.dispatchEvent(new Draw.Event(DrawEventType.DRAWSTART, this.sketchFeature_));
};


/**
 * @inheritDoc
 */
Draw.prototype.shouldStopEvent = FALSE;


/**
 * Redraw the sketch features.
 * @private
 */
Draw.prototype.updateSketchFeatures_ = function() {
  var sketchFeatures = [];
  if (this.sketchFeature_) {
    sketchFeatures.push(this.sketchFeature_);
  }
  if (this.sketchLine_) {
    sketchFeatures.push(this.sketchLine_);
  }
  if (this.sketchPoint_) {
    sketchFeatures.push(this.sketchPoint_);
  }
  var overlaySource = this.overlay_.getSource();
  overlaySource.clear(true);
  overlaySource.addFeatures(sketchFeatures);
};


/**
 * @private
 */
Draw.prototype.updateState_ = function() {
  var map = this.getMap();
  var active = this.getActive();
  if (!map || !active) {
    this.abortDrawing_();
  }
  this.overlay_.setMap(active ? map : null);
};


/**
 * Create a `geometryFunction` for `type: 'Circle'` that will create a regular
 * polygon with a user specified number of sides and start angle instead of an
 * `ol.geom.Circle` geometry.
 * @param {number=} opt_sides Number of sides of the regular polygon. Default is
 *     32.
 * @param {number=} opt_angle Angle of the first point in radians. 0 means East.
 *     Default is the angle defined by the heading from the center of the
 *     regular polygon to the current pointer position.
 * @return {ol.DrawGeometryFunctionType} Function that draws a
 *     polygon.
 * @api
 */
Draw.createRegularPolygon = function(opt_sides, opt_angle) {
  return (
    /**
         * @param {ol.Coordinate|Array.<ol.Coordinate>|Array.<Array.<ol.Coordinate>>} coordinates
         * @param {ol.geom.SimpleGeometry=} opt_geometry
         * @return {ol.geom.SimpleGeometry}
         */
    function(coordinates, opt_geometry) {
      var center = coordinates[0];
      var end = coordinates[1];
      var radius = Math.sqrt(
          _ol_coordinate_.squaredDistance(center, end));
      var geometry = opt_geometry ? /** @type {ol.geom.Polygon} */ (opt_geometry) :
        fromCircle(new Circle(center), opt_sides);
      var angle = opt_angle ? opt_angle :
        Math.atan((end[1] - center[1]) / (end[0] - center[0]));
      makeRegular(geometry, center, radius, angle);
      return geometry;
    }
  );
};


/**
 * Create a `geometryFunction` that will create a box-shaped polygon (aligned
 * with the coordinate system axes).  Use this with the draw interaction and
 * `type: 'Circle'` to return a box instead of a circle geometry.
 * @return {ol.DrawGeometryFunctionType} Function that draws a box-shaped polygon.
 * @api
 */
Draw.createBox = function() {
  return (
    /**
     * @param {Array.<ol.Coordinate>} coordinates
     * @param {ol.geom.SimpleGeometry=} opt_geometry
     * @return {ol.geom.SimpleGeometry}
     */
    function(coordinates, opt_geometry) {
      var extent = boundingExtent(coordinates);
      var geometry = opt_geometry || new Polygon(null);
      geometry.setCoordinates([[
        getBottomLeft(extent),
        getBottomRight(extent),
        getTopRight(extent),
        getTopLeft(extent),
        getBottomLeft(extent)
      ]]);
      return geometry;
    }
  );
};


/**
 * Get the drawing mode.  The mode for mult-part geometries is the same as for
 * their single-part cousins.
 * @param {ol.geom.GeometryType} type Geometry type.
 * @return {ol.interaction.Draw.Mode_} Drawing mode.
 * @private
 */
Draw.getMode_ = function(type) {
  var mode;
  if (type === GeometryType.POINT ||
      type === GeometryType.MULTI_POINT) {
    mode = Draw.Mode_.POINT;
  } else if (type === GeometryType.LINE_STRING ||
      type === GeometryType.MULTI_LINE_STRING) {
    mode = Draw.Mode_.LINE_STRING;
  } else if (type === GeometryType.POLYGON ||
      type === GeometryType.MULTI_POLYGON) {
    mode = Draw.Mode_.POLYGON;
  } else if (type === GeometryType.CIRCLE) {
    mode = Draw.Mode_.CIRCLE;
  }
  return /** @type {!ol.interaction.Draw.Mode_} */ (mode);
};


/**
 * Draw mode.  This collapses multi-part geometry types with their single-part
 * cousins.
 * @enum {string}
 * @private
 */
Draw.Mode_ = {
  POINT: 'Point',
  LINE_STRING: 'LineString',
  POLYGON: 'Polygon',
  CIRCLE: 'Circle'
};

/**
 * @classdesc
 * Events emitted by {@link ol.interaction.Draw} instances are instances of
 * this type.
 *
 * @constructor
 * @extends {ol.events.Event}
 * @implements {oli.DrawEvent}
 * @param {ol.interaction.DrawEventType} type Type.
 * @param {ol.Feature} feature The feature drawn.
 */
Draw.Event = function(type, feature) {

  Event.call(this, type);

  /**
   * The feature being drawn.
   * @type {ol.Feature}
   * @api
   */
  this.feature = feature;

};
inherits(Draw.Event, Event);

export default Draw;
