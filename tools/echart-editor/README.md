# ECharts visual editor

A local editor that works alongside `scripts/filters/echarts-fence.js`: drag points and change
values in the browser, and every edit is written straight back into the source file. No
dependencies, so there is nothing to `npm install`.

## Getting started

```bash
npm run echart                                    # blank canvas, pick a file in the browser
npm run echart -- --file "source/_posts/xxx.md"   # open one article straight away
```

`ec` is a short alias for the same command. On start it prints the address and opens your
browser. Available options:

| Option          | What it does                                                                       |
| --------------- | ---------------------------------------------------------------------------------- |
| `--file <path>` | Target file, relative to the site root. Omit it and you get a blank canvas.        |
| `--port <port>` | Defaults to 7788; if that is taken it moves on and prints the port it settled on.    |
| `--no-open`     | Do not open the browser.                                                           |
| `--keep-alive`  | Stay running when the page closes. By default it quits 3 seconds after the last tab goes. |

When you close the tab the page tells the server to shut down via `sendBeacon`, so the terminal
comes back to the prompt and nothing is left squatting on port 7788. Reloading is safe — the
fresh page pings immediately and cancels the countdown. If the browser crashes and goes quiet,
120 seconds without a heartbeat is the backstop.

## Workspace: open a file, or start a new chart

Started without `--file` you get a blank canvas (420px tall, axes 0–10). From there you can:

1. Press “+ Add” on the canvas, drag points about and recolour them until the chart looks right.
2. Press “Open…” in the top bar, then search for and pick a project file. Tick “Charts only” to
   narrow the list to articles that already contain ```echarts fences, with a count for each:
   - `.md` — the top of the file, every heading and the end of the file are offered as **insert
     positions**; choose one and press “Insert current chart” to write a fresh fence there and
     jump straight into editing it
   - `echarts.js` / `*.json` — just press “Open” to edit an existing chart
3. Opening an article that has **no chart at all** gives you the same blank canvas, so you can
   build the whole chart first and then insert it with one click.

Inserting only touches that one spot in the target file; everything else is left alone. The file
then becomes the current target, and further edits sync automatically.

## The three supported targets

| Format         | How it is recognised         | How edits are written back                                                   |
| -------------- | ---------------------------- | ---------------------------------------------------------------------------- |
| JS script      | contains `const nodes = [...]` | Only the `nodes` block is rewritten; untouched entries keep their exact text   |
| Plain-JSON option | file starts with `{`       | Series data is rebuilt and the whole file re-serialised                       |
| Markdown       | `.md` extension              | Only the body of the selected ```echarts fence is replaced                   |

When one markdown file holds several charts, the dropdown in the top bar lists every fence by
“number · line · nearest heading”, and switching loads that chart.

Node data is always taken from the series whose `type` is `scatter`: position, name, colour and
label position are edited point by point. Any `line` series is rebuilt from the node order and
closed back to its starting point.

## Editing

- **Drag** — drag a bubble on the canvas; dragging a selected point moves the whole selection
- **Marquee** — drag on empty space to select several, `Shift`-drag to add to the selection,
  `Shift`-click a single point to toggle it
- **Align and distribute** — a toolbar floats up once something is selected: align level (same Y),
  align upright (same X), distribute across (even X spacing) and distribute down (even Y spacing);
  the outermost points stay put
- **Bulk edits** — change colour, label position or delete every selected node at once
- **Nudge** — arrow keys move by 0.1, `Shift` plus an arrow by 0.5
- **Undo / redo** — `⌘Z` and `⇧⌘Z`
- **Reference grid and snap** — the grid draws one-unit lines; snapping rounds coordinates to 0.5
- **Shortcuts** — `⌘S` saves, `⌘A` selects everything, `Esc` clears the selection

Edits are debounced by 350ms and then written back, with the result shown in the status bar. Turn
off “Auto-sync” to save by hand instead.

## Matching what the blog renders

The editor deliberately mirrors the blog's rendering environment, so a chart does not look one
way while you edit it and another once published:

- **ECharts version** — `vendor/echarts.min.js` is pinned to 6.1.0, the same `echarts@6` that
  `echarts-fence.js` loads
- **Container size** — the width is the 786px post column worked out from the theme layout, and
  the height comes from the option's `height` field (420 if absent), exactly like
  `#article-container .echarts-wrap`
- **Colour rewriting** — `blogTune()` tracks `tune()` in `echarts-fence.js`: the background is
  forced to `transparent` and text, axis lines and radar are recoloured for light or dark

“Render as blog” switches back to the raw option for comparison, and “Dark” mirrors the blog's dark
theme. Neither toggle is ever written to the file.

> One thing worth knowing: because the theme forces `backgroundColor` to `transparent`, any
> background colour set in the option has no effect on the live site. Palettes that rely on a dark
> background — white labels, for instance — become hard to read in the light theme.

## Layout

```
tools/echart-editor/
├── server.js          # local server: parses the source, writes it back, serves assets
├── public/
│   ├── index.html     # the interface
│   ├── app.js         # dragging, marquee, bulk actions, syncing
│   ├── style.css
│   └── favicon.svg
└── vendor/
    └── echarts.min.js # same version as the site, so it works offline
```

For JS sources the server runs the file in a `vm` to pull out the real `option`; JSON and markdown
are simply `JSON.parse`d. Writes go through a temporary file and a rename, so a half-written file
is never left behind.

## Known limitations

- Saving JSON and markdown targets re-serialises the whole option, so the first save produces a
  broad diff (stable increments after that). Only the JS format keeps untouched entries verbatim.
- The editor only touches the data in `series`; titles, legends, axes and other styling still have
  to be edited in the source file.
- Charts with a `scatter` series are edited node by node. Radar and pie charts switch to **data
  mode** instead, listing the numbers in `series` on the right (radar values follow the indicator
  order and show the indicator name on hover). Those edits are written back the same way.
