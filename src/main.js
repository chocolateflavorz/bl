import { Map, NavigationControl, setWorkerUrl } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  TerraDraw,
  TerraDrawPointMode,
  TerraDrawPolygonMode,
  TerraDrawPolyLineMode,
  TerraDrawSelectMode,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import "./style.css";

// Vite cannot infer MapLibre v6's lazily-built worker URL, so point it at the
// bundled asset explicitly.
setWorkerUrl(maplibreWorkerUrl);

const map = new Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/positron",
  center: [13.39, 52.52],
  zoom: 11.5,
  attributionControl: { compact: true },
});

map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");

const drawButton = document.getElementById("draw");
const lineButton = document.getElementById("draw-line");
const pointButton = document.getElementById("draw-point");
const selectButton = document.getElementById("select");
const clearButton = document.getElementById("clear");
const hintDraw = document.getElementById("hint-draw");
const hintLine = document.getElementById("hint-line");
const hintPoint = document.getElementById("hint-point");
const hintSelect = document.getElementById("hint-select");
const countEl = document.getElementById("count");
const outEl = document.getElementById("out");
const jsonEl = document.getElementById("json");
const copyButton = document.getElementById("copy");

const styles = {
  lineStringColor: "#2563eb",
  lineStringWidth: 2,
  lineStringOpacity: 1,
  pointColor: "#2563eb",
  pointOpacity: 1,
  pointWidth: 7,
  pointOutlineColor: "#ffffff",
  pointOutlineOpacity: 1,
  pointOutlineWidth: 2,
  fillColor: "#2563eb",
  fillOpacity: 0.12,
  outlineColor: "#1d4ed8",
  outlineOpacity: 1,
  outlineWidth: 2,
  closingPointColor: "#1d4ed8",
  closingPointOpacity: 1,
  closingPointWidth: 7,
  closingPointOutlineColor: "#ffffff",
  closingPointOutlineOpacity: 1,
  closingPointOutlineWidth: 2,
  snappingPointColor: "#f59e0b",
  snappingPointOpacity: 1,
  snappingPointWidth: 7,
  snappingPointOutlineColor: "#ffffff",
  snappingPointOutlineOpacity: 1,
  snappingPointOutlineWidth: 2,
  editedPointColor: "#1d4ed8",
  editedPointOpacity: 1,
  editedPointWidth: 7,
  editedPointOutlineColor: "#ffffff",
  editedPointOutlineOpacity: 1,
  editedPointOutlineWidth: 2,
  coordinatePointColor: "#ffffff",
  coordinatePointOpacity: 1,
  coordinatePointWidth: 6,
  coordinatePointOutlineColor: "#1d4ed8",
  coordinatePointOutlineOpacity: 1,
  coordinatePointOutlineWidth: 2,
  selectedPolygonColor: "#2563eb",
  selectedPolygonFillOpacity: 0.18,
  selectedPolygonOutlineColor: "#1d4ed8",
  selectedPolygonOutlineOpacity: 1,
  selectedPolygonOutlineWidth: 2.5,
  selectedLineStringColor: "#2563eb",
  selectedLineStringWidth: 2.5,
  selectedLineStringOpacity: 1,
  selectedPointColor: "#2563eb",
  selectedPointWidth: 8,
  selectedPointOpacity: 1,
  selectedPointOutlineColor: "#ffffff",
  selectedPointOutlineOpacity: 1,
  selectedPointOutlineWidth: 2,
  selectionPointColor: "#1d4ed8",
  selectionPointOpacity: 1,
  selectionPointWidth: 8,
  selectionPointOutlineColor: "#ffffff",
  selectionPointOutlineOpacity: 1,
  selectionPointOutlineWidth: 2,
  midPointColor: "#f59e0b",
  midPointOpacity: 1,
  midPointWidth: 7,
  midPointOutlineColor: "#ffffff",
  midPointOutlineOpacity: 1,
  midPointOutlineWidth: 2,
};

// ---------------------------------------------------------------------------
// Custom overlap selection
// ---------------------------------------------------------------------------
//
// Terra Draw's built-in select mode picks the last polygon returned by its
// RBush spatial index, which is not predictable for overlapping features.
// We disable its manual selection and pick from MapLibre's rendered features
// instead, using this priority order:
//
//   1. properties.important === true
//   2. points
//   3. lines (LineString / polyline)
//   4. polygons, smallest area first
//
// "Area" means geodesic polygon area (holes subtracted).

const SELECTION_LAYERS = [
  "td-polygon",
  "td-polygon-outline",
  "td-linestring",
  "td-point",
  "td-point-marker",
];

const GUIDANCE_PROPERTIES = [
  "selectionPoint",
  "midPoint",
  "coordinatePoint",
  "closingPoint",
  "snappingPoint",
  "edited",
  "currentlyDrawing",
];

const GEOMETRY_PRIORITY = {
  Point: 0,
  LineString: 1,
  Polygon: 2,
};

const SELECTABLE_MODES = new Set([
  "polygon",
  "polyline",
  "linestring",
  "point",
]);

const EARTH_RADIUS = 6378137;
const AREA_FACTOR = (EARTH_RADIUS * EARTH_RADIUS) / 2;
const RADIANS = Math.PI / 180;

function ringArea(ring) {
  if (ring.length < 3) return 0;

  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const lower = ring[i];
    const middle = ring[(i + 1) % ring.length];
    const upper = ring[(i + 2) % ring.length];

    total +=
      (upper[0] * RADIANS - lower[0] * RADIANS) *
      Math.sin(middle[1] * RADIANS);
  }

  return Math.abs(total * AREA_FACTOR);
}

function polygonArea(polygon) {
  const [outer, ...holes] = polygon.coordinates;
  if (!outer) return 0;

  return Math.max(
    0,
    ringArea(outer) - holes.reduce((sum, ring) => sum + ringArea(ring), 0),
  );
}

function isGuidanceFeature(feature) {
  const properties = feature.properties ?? {};
  return GUIDANCE_PROPERTIES.some((key) => Boolean(properties[key]));
}

function isSelectableFeature(feature) {
  const properties = feature.properties ?? {};

  if (!SELECTABLE_MODES.has(properties.mode)) return false;
  if (isGuidanceFeature(feature)) return false;

  return Object.hasOwn(GEOMETRY_PRIORITY, feature.geometry.type);
}

function compareSelectionCandidates(a, b) {
  const aImportant = a.properties?.important === true ? 0 : 1;
  const bImportant = b.properties?.important === true ? 0 : 1;
  if (aImportant !== bImportant) return aImportant - bImportant;

  const aGeometry = GEOMETRY_PRIORITY[a.geometry.type];
  const bGeometry = GEOMETRY_PRIORITY[b.geometry.type];
  if (aGeometry !== bGeometry) return aGeometry - bGeometry;

  const aArea = a.geometry.type === "Polygon" ? polygonArea(a.geometry) : 0;
  const bArea = b.geometry.type === "Polygon" ? polygonArea(b.geometry) : 0;

  return aArea - bArea;
}

function findFeatureAtPoint(point) {
  const layers = SELECTION_LAYERS.filter((layerId) => map.getLayer(layerId));
  if (!layers.length) return undefined;

  const hits = map.queryRenderedFeatures(point, { layers });

  // If the pointer is over a Terra Draw editing handle, let Terra Draw's
  // normal drag/edit behavior win instead of changing the selection.
  if (hits.some((hit) => isGuidanceFeature(hit) && hit.geometry.type === "Point")) {
    return undefined;
  }

  const byId = new Map();
  const addHit = (hit) => {
    if (!isSelectableFeature(hit)) return;

    const id = hit.id ?? hit.properties?.id;
    if (id === undefined || id === null) return;
    if (!byId.has(id)) byId.set(id, hit);
  };

  // A polygon can be returned both by its fill and outline layer, so dedupe.
  hits.forEach(addHit);

  // Give points and lines the same click tolerance Terra Draw uses, rather
  // than requiring a pixel-perfect hit on the rendered stroke.
  const tolerance = 10;
  const nearLayers = ["td-point", "td-point-marker", "td-linestring"].filter(
    (layerId) => map.getLayer(layerId),
  );

  if (nearLayers.length) {
    const toleranceBox = [
      [point.x - tolerance, point.y - tolerance],
      [point.x + tolerance, point.y + tolerance],
    ];

    map
      .queryRenderedFeatures(toleranceBox, { layers: nearLayers })
      .forEach(addHit);
  }

  return [...byId.values()].sort(compareSelectionCandidates)[0];
}

let draw;

map.on("load", () => {
  draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({
      map,
      coordinatePrecision: 9,
    }),
    modes: [
      new TerraDrawPolygonMode({
        styles,
        snapping: true,
        editable: true,
        showCoordinatePoints: true,
      }),
      new TerraDrawPolyLineMode({
        styles,
        snapping: true,
        showCoordinatePoints: true,
      }),
      new TerraDrawPointMode({
        styles,
        editable: true,
      }),
      new TerraDrawSelectMode({
        styles,
        // We perform our own overlap-aware hit testing below.
        allowManualSelection: false,
        flags: {
          polygon: {
            feature: {
              draggable: true,
              rotateable: true,
              scaleable: true,
              coordinates: {
                midpoints: true,
                draggable: true,
                deletable: true,
                snappable: true,
              },
            },
          },
          polyline: {
            feature: {
              draggable: true,
              rotateable: true,
              scaleable: true,
              coordinates: {
                midpoints: true,
                draggable: true,
                deletable: true,
                snappable: true,
              },
            },
          },
          linestring: {
            feature: {
              draggable: true,
              rotateable: true,
              scaleable: true,
              coordinates: {
                midpoints: true,
                draggable: true,
                deletable: true,
                snappable: true,
              },
            },
          },
          point: {
            feature: {
              draggable: true,
            },
          },
        },
      }),
    ],
  });

  draw.start();

  let mode = "static";
  const drawingModes = new Set(["polygon", "polyline", "point"]);

  const setMode = (next) => {
    mode = next;
    draw.setMode(next);
    drawButton.setAttribute("aria-pressed", String(next === "polygon"));
    lineButton.setAttribute("aria-pressed", String(next === "polyline"));
    pointButton.setAttribute("aria-pressed", String(next === "point"));
    selectButton.setAttribute("aria-pressed", String(next === "select"));
    map.getCanvas().style.cursor = drawingModes.has(next) ? "crosshair" : "";
    hintDraw.hidden = next !== "polygon";
    hintLine.hidden = next !== "polyline";
    hintPoint.hidden = next !== "point";
    hintSelect.hidden = next !== "select";
  };

  setMode("static");

  drawButton.addEventListener("click", () => {
    setMode(mode === "polygon" ? "static" : "polygon");
  });

  lineButton.addEventListener("click", () => {
    setMode(mode === "polyline" ? "static" : "polyline");
  });

  pointButton.addEventListener("click", () => {
    setMode(mode === "point" ? "static" : "point");
  });

  selectButton.addEventListener("click", () => {
    setMode(mode === "select" ? "static" : "select");
  });

  map.on("click", (event) => {
    if (mode !== "select") return;

    const feature = findFeatureAtPoint(event.point);
    if (feature) draw.selectFeature(feature.id);
  });

  clearButton.addEventListener("click", () => {
    draw.clear();
  });

  const featureModes = new Set(["polygon", "polyline", "linestring", "point"]);

  const refresh = () => {
    const features = draw.getSnapshot().filter((feature) => {
      const properties = feature.properties ?? {};
      return featureModes.has(properties.mode) && !isGuidanceFeature(feature);
    });

    countEl.textContent = String(features.length);
    outEl.hidden = features.length === 0;
    jsonEl.textContent = JSON.stringify(
      { type: "FeatureCollection", features },
      null,
      2,
    );
  };

  draw.on("change", refresh);
  draw.on("finish", refresh);

  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(jsonEl.textContent);
      copyButton.textContent = "copied";
    } catch {
      copyButton.textContent = "failed";
    }
    setTimeout(() => (copyButton.textContent = "copy"), 1200);
  });

  refresh();
});
