# Samsung Smart Hub Preview

This fork adds a personalized Samsung Smart Hub Preview to the packaged Tizen WGT.

## Preview layout

The preview contains at most 21 tiles in this order:

1. **Continuar viendo** — 3 titles from the active Nuvio profile.
2. **Porque viste · Películas** — 2 live Xperience results.
3. **Porque viste · Series** — 2 live Xperience results.
4. **Top 10 de Netflix · Películas** — 2 live Xperience results.
5. **Top 10 de Netflix · Series** — 2 live Xperience results.
6. **Studios** — Marvel, DC, A24, Pixar, and Disney Animated.
7. **Streaming** — Netflix, Prime Video, Disney+, HBO Max, and Apple TV+.

Media tiles deep-link to their Nuvio detail screen. Continue Watching tiles pass the saved
episode and resume state so Nuvio can continue playback. Collection tiles open the imported
Xperience folder when it exists and otherwise open that folder's primary movie catalog.

## Card text

Samsung draws the card itself. The only things this app controls are `title`, `subtitle`,
`image_url`, `image_ratio` and `is_playable` — there is no way to place a custom badge or button
on the artwork, so the wording has to do that work. Setting `is_playable: true` is what makes the
launcher draw its own play affordance, which is why only Continue Watching tiles carry it.

Tizen 6.5's launcher flattens the sections into one strip and hides the row headers, so each tile
states its own reason. The badge on the title is kept short because the card truncates at roughly
thirty characters, and anything spent on the category is taken from the title the viewer is
actually scanning for:

| Row                 | Title                           | Subtitle                       |
| ------------------- | ------------------------------- | ------------------------------ |
| Continuar viendo    | `▶ Sigue viendo · MasterChef`   | `T16 E2 · faltan 33 min`       |
| Porque viste        | `★ Para ti · Blade Runner 2049` | `Porque viste · Película`      |
| Top 10 de Netflix   | `#1 Netflix · Wicked`           | `Top 10 de Netflix · Película` |
| Studios / Streaming | `Marvel`                        | `Studios`                      |

Badge glyphs come from the geometric-shapes block (`▶`, `★`) rather than colour emoji, which
render as an empty box on some AU8000 firmware. Continue Watching says how much time is left
rather than a percentage watched, falling back to the percentage for entries saved without a
duration. Sections still declare `title_display_mode: "AlwaysOn"` for launchers that do show
headers.

The foreground app sends each personalized snapshot to the preview service through both
AppControl data and package-private storage. The service keeps the last valid personalized
snapshot; it never replaces missing data with generic placeholder cards. Some AU8000 firmware
versions report the web-service capability as unavailable even though the service works, so the
packaged app verifies the real model before allowing that known false-negative.

## Building

```sh
npm install
npm run package:tizen
```

The generated file is `NuvioTV001_<version>.wgt`.

## TV setup

Smart Hub Preview is officially supported on Samsung's 2016–2021 TV models.

1. Install the custom WGT using the Nuvio WebTV Installer or a configured Tizen development
   workflow.
2. Add Nuvio TV to the Samsung Home launcher.
3. Open Nuvio TV once and select the profile whose Continue Watching data should be shown.
4. Return to Samsung Home and focus the Nuvio TV tile.
5. If the preview is not immediately visible, wait at least 10 minutes and fully power-cycle the
   TV. Samsung rate-limits preview updates to one every 10 minutes.

Samsung documents that Smart Hub Preview is unavailable for applications installed from a USB
removable drive on 2017 and newer televisions. Use a network/developer installation method.
