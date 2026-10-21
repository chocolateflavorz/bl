# Custom Overlap Selection in Terra Draw

This is the minimal pattern used by the demo to select overlapping **polygons,
polylines, and points** deterministically.

## How it works

The demo is built with **Vite + MapLibre GL + Terra Draw + Terra Draw MapLibre adapter**.

Custom selection has three parts:

1. Disable Terra Draw's built-in click selection with `allowManualSelection: false`.
2. On map click, ask MapLibre which rendered features are under the cursor.
3. Apply your own priority and call `draw.selectFeature(id)`.

After `draw.start()`, the MapLibre adapter creates these layers:

```text
td-polygon
td-polygon-outline
td-linestring
td-point
td-point-marker   // only when marker styles are used
```

The default layer prefix is `td`. If the adapter is created with
`prefixId: "foo"`, the layers become `foo-polygon`, `foo-linestring`, etc.

## Selection priority

```text
1. properties.important === true
2. Points
3. Lines (LineString / polyline)
4. Polygons — smallest area first
```

If two polygons overlap, the smaller polygon wins. If either feature has
`properties.important === true`, it wins over everything else.

## Minimal sample

```js
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawPolyLineMode,
  TerraDrawPointMode,
  TerraDrawSelectMode,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { area } from "@turf/area";

const LAYERS = [
  "td-polygon",
  "td-polygon-outline",
  "td-linestring",
  "td-point",
];

const GUIDANCE = [
  "selectionPoint",
  "midPoint",
  "coordinatePoint",
  "closingPoint",
  "snappingPoint",
  "edited",
  "currentlyDrawing",
];

const MODES = new Set(["polygon", "polyline", "linestring", "point"]);

const GEOMETRY_RANK = {
  Point: 0,
  LineString: 1,
  Polygon: 2,
};

map.on("load", () => {
  const draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map }),
    modes: [
      new TerraDrawPolygonMode(),
      new TerraDrawPolyLineMode(),
      new TerraDrawPointMode(),
      new TerraDrawSelectMode({
        // We do selection ourselves.
        allowManualSelection: false,
        flags: {
          polygon: { feature: { draggable: true } },
          polyline: { feature: { draggable: true } },
          point: { feature: { draggable: true } },
        },
      }),
    ],
  });

  draw.start();
  draw.setMode("select");

  map.on("click", (event) => {
    if (draw.getMode() !== "select") return;

    const byId = new Map();

    const hits = map.queryRenderedFeatures(event.point, {
      layers: LAYERS.filter((id) => map.getLayer(id)),
    });

    for (const feature of hits) {
      const properties = feature.properties ?? {};

      // Ignore Terra Draw handles and drawing helpers.
      if (!MODES.has(properties.mode)) continue;
      if (GUIDANCE.some((key) => properties[key])) continue;

      // A polygon appears in both the fill and outline layer.
      if (feature.id != null && !byId.has(feature.id)) {
        byId.set(feature.id, feature);
      }
    }

    const best = [...byId.values()].sort(compareFeatures)[0];
    if (best) draw.selectFeature(best.id);
  });
});

function compareFeatures(a, b) {
  // 1. important: true wins
  const aImportant = a.properties?.important === true ? 0 : 1;
  const bImportant = b.properties?.important === true ? 0 : 1;
  if (aImportant !== bImportant) return aImportant - bImportant;

  // 2. point, then line, then polygon
  const aRank = GEOMETRY_RANK[a.geometry.type];
  const bRank = GEOMETRY_RANK[b.geometry.type];
  if (aRank !== bRank) return aRank - bRank;

  // 3. smaller polygon wins
  return area(a) - area(b);
}
```

## Why `allowManualSelection: false` is required

Without it, Terra Draw also processes the same click and may select its own
overlap winner. Its built-in polygon hit-testing keeps the **last polygon
returned by the RBush spatial index**, which is not related to visual order,
area, or the `important` property.

Disabling built-in manual selection makes this custom handler the only path
that selects features:

```js
draw.selectFeature(best.id);
```

Terra Draw still handles selection points, dragging, deleting, and editing
after the feature is selected.

## Imported GeoJSON

Imported features must include `properties.mode` so Terra Draw can style them
and so select-mode flags apply:

```json
{
  "type": "Feature",
  "properties": {
    "mode": "polygon",
    "important": true
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": [
      [
        [13.38, 52.51],
        [13.4, 52.51],
        [13.4, 52.53],
        [13.38, 52.53],
        [13.38, 52.51]
      ]
    ]
  }
}
```

## Notes

- `important` is matched strictly as a boolean: `properties.important === true`.
- To prefer the **largest** polygon instead, reverse the area comparison:
  `return bArea - aArea;`.
- Area comes from `@turf/area`: geodesic area in square metres, with holes
  subtracted. Install it with `npm install @turf/area`.
- `queryRenderedFeatures` only sees rendered features. If polygon fill opacity
  is `0`, the fill layer may not be hit-testable; query the outline layer or
  use geometry-based hit-testing instead.
- To add click tolerance for points and lines, query a small bbox around the
  click and include `td-point`, `td-point-marker`, and `td-linestring`:

```js
const tolerance = 10;
const box = [
  [event.point.x - tolerance, event.point.y - tolerance],
  [event.point.x + tolerance, event.point.y + tolerance],
];

const nearby = map.queryRenderedFeatures(box, {
  layers: ["td-point", "td-point-marker", "td-linestring"],
});
```
