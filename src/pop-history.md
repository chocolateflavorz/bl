# Popping the Latest Terra Draw History Entry

Terra Draw 1.38.0 has no public `popHistory()` method. Use the internal history stacks below to remove the most recent entry **without changing the map state**.

## Pop helper

```js
function popHistory(draw) {
  if (!draw) return false;

  // While actively drawing, Terra Draw uses the mode-level history.
  if (draw.getModeState() === "drawing") {
    const history = draw._mode?.undoRedo?.undoHistory;
    if (!history?.length) return false;
    history.pop();
    return true;
  }

  // Otherwise, use the session-level feature history.
  const history = draw.sessionUndoRedo?.undoStack;
  if (!history?.length) return false;
  history.pop();
  return true;
}
```

## Enable session history

Session history only exists when it is configured explicitly:

```js
import {
  TerraDraw,
  TerraDrawModeUndoRedo,
  TerraDrawSessionUndoRedo,
} from "terra-draw";

const draw = new TerraDraw({
  adapter,
  modes,
  undoRedo: {
    modeLevel: new TerraDrawModeUndoRedo(),
    sessionLevel: new TerraDrawSessionUndoRedo(),
  },
});
```

## Caveats

- `pop()` removes the newest history entry without changing the map state.
- It does not emit Terra Draw's `history` event, so update any history UI manually.
- These are private internals (`_mode`, `undoHistory`, `undoStack`) and may break on upgrade.
- If you also want to discard the redo stack, clear it separately.
- For a version-safe implementation, provide a custom `TerraDrawSessionUndoRedo` implementation through `undoRedo.sessionLevel` that exposes `pop()`.
