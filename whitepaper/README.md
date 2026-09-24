# Cardano Tokenized Vault Standards Whitepapers

## Start here

| To do this | Open this file |
| --- | --- |
| Read both papers | [Combined PDF](output/CTVS-Whitepapers-Combined.pdf) |
| Edit the synchronous paper | [CTVS-1.md](CTVS-1.md) |
| Edit the asynchronous paper | [CTVS-2.md](CTVS-2.md) |
| Find or edit a figure | [Figure guide](figures/README.md) |

**Edit the two Markdown files above.** They are the current source of the whitepapers; the PDFs in `output/` are generated publication files.

The Cardano Tokenized Vault Standards (CTVS) whitepapers propose common accounting, operation, and integration requirements for tokenized vaults on Cardano. They describe how fungible shares represent pooled economic exposure and how wallets, allocators, lending applications, and analytics providers can identify vaults, construct bounded transactions, and reconstruct their outcomes.

The proposal expresses these requirements through Cardano's extended UTxO model, with explicit rules for authenticated identity, asset backing, share supply, user ownership, and economic conservation.

## The papers

- **CTVS-1: Synchronous Tokenized Vaults on Cardano** defines vault identity, backing and liability accounting, share conversion and rounding, direct deposits and redemptions, and common integration requirements. It distinguishes the shared economic guarantees from the choices made by the reference implementation profile.
- **CTVS-2: Asynchronous Requests, Settlement, and Claims** extends that accounting model to operations where user commitment, economic settlement, and delivery occur separately. It covers request ownership, batch settlement, pricing, cancellation, funded claims, and recovery.

Read CTVS-1 first for the shared accounting and integration model, then CTVS-2 for the asynchronous lifecycle. The combined PDF contains both papers in that order.

## Reading the whitepapers

The current PDFs are in [`output/`](output/): the [combined edition](output/CTVS-Whitepapers-Combined.pdf), [CTVS-1](output/CTVS-1-Whitepaper.pdf), and [CTVS-2](output/CTVS-2-Whitepaper.pdf). The prior illustrated edition, its exact PDFs, and its illustrative JSON companions are retained under [`archive/v0.6.3/`](archive/v0.6.3/).

The papers include worked examples, diagrams, reference data structures, and explicit conformance boundaries. Supporting material is available in:

- [`figures/README.md`](figures/README.md): which figure files are originals, generated assets, and PDF inputs, with a figure index.
- [`archive/v0.6.3/evidence/`](archive/v0.6.3/evidence/): the human-readable validation evidence accompanying the prior edition.
- [`candidate-wire/`](candidate-wire/): the proposed on-chain encoding, type declarations, and golden bytes. Its JSON is part of the cited wire candidate, not an off-chain response fixture.
- [`tools/`](tools/): PDF build, figure drawing, visual review, template, and publication dependencies.
- [Reference integration package](../reference/packages/integration/README.md): the maintained Direct Custody Profile reader, response types, transport serialization, and local tests.
- [Reference validation record](../reference/VALIDATION.md): dated local implementation results and remaining acceptance work.
- [`archive/v0.6.3/`](archive/v0.6.3/): historical response schema, illustrative responses, evidence snapshots, dated checks, Markdown sources, PDFs, and generated PNG previews from the prior edition.

CTVS is a proposed standard, not an adopted CIP. The publication describes requirements and a candidate reference profile. The linked implementation has compiled and signed local tests; node-backed acceptance, independent interoperability, external review, and deployment remain unverified.

The common integration contract and worked response interpretations are stated in the papers. The current edition does not maintain a separate illustrative response schema or fixture set. The older JSON files are frozen in the archive for readers of the prior edition and for its historical checker. For a human-readable account of those earlier results, start with [`archive/v0.6.3/evidence/CTVS-Validation-Evidence.md`](archive/v0.6.3/evidence/CTVS-Validation-Evidence.md).

## Source and artwork

[`tools/template-illustrated.tex`](tools/template-illustrated.tex) controls PDF layout, and [`tools/breakcode.lua`](tools/breakcode.lua) handles code typography during Markdown conversion. [`tools/publication-links.lua`](tools/publication-links.lua) resolves source-file links from the PDF output directory. Numbered citations link to anchored entries in each paper’s References section; evidence and candidate-artifact links require the accompanying source package.

Figure PDFs in [`figures/pdf/`](figures/pdf/) are embedded in the papers. The eleven vector figures are authored by [`tools/draw_figures.py`](tools/draw_figures.py), which produces their SVG and PDF assets. The [`figures/png/`](figures/png/) directory contains only four authoritative raster originals:

- `ctvs1-f01-native-mapping.png`
- `ctvs1-f02-object-model.png`
- `ctvs2-f01-lifecycle-cutover.png`
- `ctvs2-f04-settlement-anatomy.png`

The drawing script regenerates vector SVGs and PDFs and writes disposable PNG previews to ignored `qa/figure-previews/`. It does not alter the four raster originals. Archived previews needed by the dated artwork checker live under `archive/v0.6.3/figure-previews/`.

## Build

Run the following commands from this directory. The build requires Python 3, the packages in [`tools/requirements-publication.txt`](tools/requirements-publication.txt), Pandoc, XeLaTeX with the packages used by the template, and fontconfig. Required fonts are Liberation Sans, Liberation Serif, DejaVu Sans Mono, and Latin Modern Math. Fonts are not distributed with the package.

```sh
python -m pip install -r tools/requirements-publication.txt
python tools/build_whitepapers.py
```

The build script typesets `CTVS-1.md` and `CTVS-2.md`, merges them into the combined PDF in `output/`, and writes disposable typesetting logs under ignored `build/`. Publication filenames are configured in the build script.

To regenerate vector artwork before building:

```sh
python tools/draw_figures.py
```

## Verification and visual review

After building, render and inspect the paper pages:

```sh
python tools/render_review.py
```

- `tools/render_review.py` renders individual paper pages, generates contact sheets, and generates a figure-page index for visual inspection.

The scripts and saved results in [`archive/v0.6.3/checks/`](archive/v0.6.3/checks/) are pinned to the historical publication and its archived illustrative JSON. They do not validate the current paper's implementation links or establish a fresh implementation result. Inspect rendered pages after changes to text, artwork, layout, or fonts.

Page images, contact sheets, and the figure-page index are generated by `tools/render_review.py` under ignored `qa/` and are not bundled. The current edition was manually reviewed after typesetting; the saved historical check records do not establish that a later edit has been verified.

[`SHA256SUMS`](SHA256SUMS) records hashes for the bundled files. Refresh it after changing or regenerating package contents.
