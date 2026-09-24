#!/usr/bin/env python3
"""Render review documents; no contract compilation or ledger verification."""
from pathlib import Path
import subprocess,shutil
import fitz
from publication_pdf import resolve_named_links
ROOT=Path(__file__).resolve().parent.parent
TOOLS=ROOT/'tools'
BUILD=ROOT/'build';OUT=ROOT/'output'
BUILD.mkdir(exist_ok=True);OUT.mkdir(exist_ok=True)
(BUILD/'figures').mkdir(exist_ok=True)
for p in (ROOT/'figures/pdf').glob('*.pdf'):shutil.copy2(p,BUILD/'figures'/p.name)
for n in (1,2):
 name=f'CTVS-{n}-Whitepaper'
 source=ROOT/f'CTVS-{n}.md';tex=BUILD/f'{name}.tex'
 cmd=['pandoc',str(source),'--from=markdown+raw_tex','--to=latex','--standalone',f'--template={TOOLS/"template-illustrated.tex"}',f'--lua-filter={TOOLS/"breakcode.lua"}',f'--lua-filter={TOOLS/"publication-links.lua"}','--no-highlight','--wrap=none','-o',str(tex)]
 subprocess.run(cmd,check=True)
 s=tex.read_text().replace(r'\[',r'\begin{equation}').replace(r'\]',r'\end{equation}')
 tex.write_text(s)
 for k in range(3):
  with (BUILD/f'{name}-pass{k+1}.log').open('w') as log:
   subprocess.run(['xelatex','-interaction=nonstopmode','-halt-on-error',tex.name],cwd=BUILD,stdout=log,stderr=subprocess.STDOUT,check=True)
 shutil.copy2(BUILD/f'{name}.pdf',OUT/f'{name}.pdf')
merged=fitz.open();toc=[]
for n in (1,2):
 p=OUT/f'CTVS-{n}-Whitepaper.pdf';d=fitz.open(p);start=len(merged)
 toc.append([1,f'CTVS-{n}',start+1])
 toc.extend([l+1,t,pg+start] for l,t,pg in d.get_toc() if pg>0)
 resolve_named_links(d)
 merged.insert_pdf(d,links=True,annots=True);d.close()
merged.set_toc(toc)
merged.set_metadata({'title':f'CTVS-1 and CTVS-2','author':'Prepared for Steer Protocol','subject':'Cardano tokenized vault standard proposal; implementation links pinned; local reference validation is separate from publication checks'})
merged.save(OUT/f'CTVS-Whitepapers-Combined.pdf',garbage=4,deflate=True);merged.close()
for p in sorted(OUT.glob('CTVS-*.pdf')):
 with fitz.open(p) as d:print(f'{p.name}: {len(d)} pages')
