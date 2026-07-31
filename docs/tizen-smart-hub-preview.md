# Samsung Smart Hub Preview

This fork adds a personalized Samsung Smart Hub Preview to the packaged Tizen WGT.

## Preview layout

The preview contains at most 21 tiles in this order:

1. **Continuar viendo** — 3 titles from the active Nuvio profile.
2. **Porque viste · Películas** — 2 live Xperience results.
3. **Porque viste · Series** — 2 live Xperience results.
4. **Top 100 hoy · Películas** — 2 live Xperience results.
5. **Top 100 hoy · Series** — 2 live Xperience results.
6. **Studios** — Marvel, DC, A24, Pixar, and Disney Animated.
7. **Streaming** — Netflix, Prime Video, Disney+, HBO Max, and Apple TV+.

Media tiles deep-link to their Nuvio detail screen. Continue Watching tiles pass the saved
episode and resume state so Nuvio can continue playback. Collection tiles open the imported
Xperience folder when it exists and otherwise open that folder's primary movie catalog.

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
