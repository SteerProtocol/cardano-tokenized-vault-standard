# Whitepaper figures

The papers embed the 15 PDFs in [`pdf/`](pdf/). The index below maps each figure to its paper and page in the individual illustrated PDF.

For figures 1 and 2 in CTVS-1 and figures 1 and 4 in CTVS-2, the files in [`png/`](png/) are the authoritative raster originals. Their matching PDFs are wrappers used for typesetting. If one of these four figures changes, update its PNG original and matching PDF wrapper together.

The other 11 figures are authored in [`../tools/draw_figures.py`](../tools/draw_figures.py). Running that script regenerates their [`svg/`](svg/) and [`pdf/`](pdf/) files. Treat the script as the source of those figures; direct edits to a generated SVG will be overwritten. The script also writes disposable PNG previews under ignored `../qa/figure-previews/`.

The prior edition's generated previews are preserved in [`../archive/v0.6.3/figure-previews/`](../archive/v0.6.3/figure-previews/) for its dated artwork check.

| Paper | Figure | Individual PDF page | Source |
| --- | ---: | ---: | --- |
| CTVS-1 | 1 | 10 | PNG original |
| CTVS-1 | 2 | 14 | PNG original |
| CTVS-1 | 3 | 15 | Drawing script |
| CTVS-1 | 4 | 23 | Drawing script |
| CTVS-1 | 5 | 26 | Drawing script |
| CTVS-1 | 6 | 27 | Drawing script |
| CTVS-1 | 7 | 33 | Drawing script |
| CTVS-2 | 1 | 10 | PNG original |
| CTVS-2 | 2 | 13 | Drawing script |
| CTVS-2 | 3 | 17 | Drawing script |
| CTVS-2 | 4 | 18 | PNG original |
| CTVS-2 | 5 | 21 | Drawing script |
| CTVS-2 | 6 | 23 | Drawing script |
| CTVS-2 | 7 | 27 | Drawing script |
| CTVS-2 | 8 | 29 | Drawing script |

In the combined PDF, add 44 to the CTVS-2 page numbers above.
