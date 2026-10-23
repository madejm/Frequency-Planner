[https://madejm.github.io/Frequency-Planner/](https://madejm.github.io/Frequency-Planner/)

# Frequency

A small mobile IEM frequency planner for two Phenyx PTM-10 transmitters and the four outputs of a PTM-33. Written in TypeScript with Preact; Vite produces a static GitHub Pages site. No server or account required.

## Use

Enter the venue's occupied transmitter frequencies in MHz, separated by commas, spaces, or newlines. Set channel spacing and the IM3 guard in kHz, optionally restrict the frequency range, then choose **Find frequencies**. Each result includes the device, frequency, group, and channel. **Copy frequency plan** includes the inputs and guards.

The chart assigns each carrier a distinct color, matching the channel badges, with equal-height carrier poles. Carrier poles remain 7 pixels wide on mobile; hovering, focusing, or tapping a channel row highlights its carrier at 12 pixels. Tapping selects it until another row is selected or the selection is cleared. Each row has its own **Show intermodulation products (IM3)** switch, remembered locally by device/output. Enabling a row shows smaller dashed third-order products involving that carrier and other selected or occupied carriers. When several rows are enabled, their products are combined without duplicate poles. Only products inside the configured chart range are drawn. Hover a pole for its frequency and source formula.

Ghost heights illustrate an equal-input, memoryless cubic amplitude model: the coefficient for `f₁ + f₂ − f₃` is twice that of `2f₁ − f₂` (6 versus 3 permutations). The displayed scale is arbitrary, not dBm or a measured/predicted level relative to the carriers. Real levels require transmitter powers, coupling, equipment nonlinearities, and phases. Coincident products display the largest model height without summing their unknown phases; the tooltip gives their count.

Inputs and parameters save automatically to this browser's local storage and restore on reopening. Clearing site data removes them; private browsing or blocked storage may prevent persistence. Results are recalculated rather than saved. This is input persistence, not offline website caching.

The original charts are in `public/data/`. PTM-33 groups 3 and 8 are split between outputs: the second output uses group channels 6–10. Two stereo PTM-10 transmitters use two RF carriers, even when their left/right feeds serve four separate listeners. Together with the PTM-33 this means six carriers for eight mono monitor feeds.

## Planning limits

- Uses integer kHz and checks minimum carrier spacing, `2f₁ − f₂`, and `f₁ + f₂ − f₃` against selected and occupied carriers. Entered occupied frequencies participate as transmitters and protected receivers.
- Existing conflicts solely among occupied carriers are ignored because this tool cannot move those transmitters.
- A bounded beam search retains up to 48 partial assignments, prioritizing the smallest surplus above the guards. It is approximate: “No plan found” does not prove that no feasible plan exists. Maximum 24 occupied frequencies.
- Defaults (350 kHz spacing, 100 kHz IM3 guard) are adjustable planning assumptions, not certified compatibility settings. The minimum/maximum range only filters the charts; it is not a legal band declaration.
- Does not model RF power, occupied bandwidth, receiver selectivity, higher-order products, TV channel bandwidths, antenna placement, or overload. A list of carrier centres cannot represent all venue interference. Verify local frequency rules, scan the venue, and check the complete rig before use.

## Local setup

Requires Node.js 22.12+ and npm.

```sh
npm install
npm run dev
```

For a production build, run `npm run build`; the output is `dist/`. The build also checks TypeScript. No dependencies were installed, and no build or tests were run while creating this project, as requested.

## GitHub Pages

1. Push this folder to a GitHub repository on the `main` branch.
2. In **Settings → Pages → Build and deployment**, select **GitHub Actions**.
3. The included workflow installs the declared packages, builds the app, and deploys `dist/` on pushes to `main` or a manual run. If your default branch has another name, update the workflow.

Vite uses relative asset paths so the site works at both a repository URL (`https://USER.github.io/REPO/`) and a custom domain. No router fallback is needed. The workflow follows the [Vite GitHub Pages guide](https://vite.dev/guide/static-deploy.html#github-pages).

The project declares only Preact at runtime and TypeScript/Vite for development. After the first install, commit the generated `package-lock.json` and change the workflow's install command to `npm ci` for repeatable dependency resolution.
