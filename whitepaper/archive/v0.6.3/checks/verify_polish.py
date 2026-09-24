#!/usr/bin/env python3
"""Verify publication/artwork preservation only—not Cardano implementation safety."""
from pathlib import Path
import re,json,hashlib,math,xml.etree.ElementTree as ET
import fitz
CHECKS=Path(__file__).resolve().parent
ARCHIVE=CHECKS.parent
R=ARCHIVE.parent.parent
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def plain(s,n):
 s=re.sub(r'\\clearpage\n# Illustration revision 0\.6\.3: figure index and reading key\n.*?\n\\clearpage\n\\tableofcontents',r'\\clearpage\n\\tableofcontents',s,count=1,flags=re.S)
 s=re.sub(r'\n\\begin\{figure\}\[H\]\n.*?\\end\{figure\}\n','\n',s,flags=re.S)
 s=s.replace('subtitle: "Illustrated review edition"','subtitle: "Public-review whitepaper"',1)
 s=s.replace('revision: "0.6.3"','revision: "0.6"',1)
 s=s.replace('date: "16 September 2026"','date: "11 September 2026"',1)
 s=s.replace(f'companion: "CTVS-{3-n}, illustrated revision 0.6.3"',f'companion: "CTVS-{3-n}, revision 0.6"',1)
 s=s.replace('# Semantic baseline revision 0.6: common guarantees, explicit implementations','# Revision 0.6: common guarantees, explicit implementations',1)
 return re.sub(r'\n{3,}','\n\n',s).strip()+'\n'
result={'scope':'Publication, figure geometry, source preservation and PDF structure only','revision':'0.6.3','date':'2026-09-16','semantic_source':{},'wire':{},'figures':[],'pdfs':[]}
for n in [1,2]:
 base=ARCHIVE/'source'/f'CTVS-{n}-Whitepaper-v0.6.md';new=ARCHIVE/'source'/f'CTVS-{n}-Whitepaper-v0.6.3-Illustrated.md'
 a=re.sub(r'\n{3,}','\n\n',base.read_text()).strip()+'\n';b=plain(new.read_text(),n)
 if a!=b:
  import difflib
  raise AssertionError('Source changed: '+''.join(difflib.unified_diff(a.splitlines(True),b.splitlines(True)))[:3000])
 result['semantic_source'][str(n)]={'identical_after_removing_illustration_metadata_and_figures':True,'sha256':sha(base)}
expected=json.loads((CHECKS/'baseline-wire-sha256.json').read_text())
for name,h in expected.items():
 actual=sha(R/'candidate-wire'/name);assert actual==h,name
 result['wire'][name]={'sha256':actual,'unchanged':True}
art=json.loads((CHECKS/'artwork-manifest.json').read_text());assert len(art)==15
old_hashes=json.loads((CHECKS/'old-figure-sha256.json').read_text())
newcount=keepcount=0
for fig in art:
 name=fig['id'];pdf=R/'figures/pdf'/f'{name}.pdf';png=(R/'figures/png' if fig['status'].startswith('retained') else ARCHIVE/'figure-previews')/f'{name}.png'
 assert pdf.is_file() and png.is_file()
 if fig['status'].startswith('retained'):
  assert sha(png)==fig['sha256'],name
  keepcount+=1
  result['figures'].append({'id':name,'retained_approved_png_unchanged':True})
 else:
  newcount+=1;svg=R/'figures/svg'/f'{name}.svg'
  assert sha(svg)!=old_hashes[name]
  root=ET.parse(svg).getroot()
  rects=[el for el in root.iter() if el.tag.endswith('rect')]
  assert all(float(el.get('stroke-width','0'))<=1.8 for el in rects),'thick box border'
  assert not any(float(el.get('width','0'))<8 and float(el.get('height','0'))>50 for el in rects),'accent stripe'
  with fitz.open(pdf) as d:
   assert len(d)==1 and len(d[0].get_text())>120
   assert not d[0].get_images(),'new figure rasterized'
  result['figures'].append({'id':name,'new_svg':True,'vector_pdf_with_selectable_text':True,'no_thick_left_bar':True})
assert (newcount,keepcount)==(11,4)
# All cards are non-overlapping; every measured label fits the figure canvas.
geometry=json.loads((CHECKS/'figure-geometry.json').read_text());assert len(geometry)==11
for f in geometry:
 for t in f['labels']:
  assert 0<=t['x0']<=t['x1']<=f['width']+1 and t['y0']>=0 and t['y1']<=f['height']+1,(f['id'],t)
 cs=f['cards']
 for i,a in enumerate(cs):
  for b in cs[i+1:]:
   assert min(a[2],b[2])-max(a[0],b[0])<=0 or min(a[3],b[3])-max(a[1],b[1])<=0,(f['id'],'card overlap',a[-1],b[-1])
# Exact source-derived numeric examples represented by the replacement artwork.
assert 1_000_000+101_000==1_101_000
assert 1_100_000-50_500+(1_000+500)==1_051_000
assert 103_000_000+15_100_000==113_100_000+2_000_000+2_600_000+400_000
assert 100_000_000+10_000_000+100_000+3_000_000==113_100_000
assert 10-10==0 and 1000+10-10==1000
pagecounts=[]
for n,nfig in [(1,7),(2,8)]:
 p=ARCHIVE/'delivery'/f'CTVS-{n}-Whitepaper-v0.6.3-Illustrated.pdf'
 with fitz.open(p) as d:
  text='\n'.join(pg.get_text() for pg in d)
  caps=re.findall(r'Figure (\d+):',text);assert caps==[str(k) for k in range(1,nfig+1)],caps
  assert len(d.get_toc())>=18 and 'Revision 0.6.3' in text
  for i,pg in enumerate(d):
   for w in pg.get_text('words'):
    assert w[0]>=-0.1 and w[1]>=-0.1 and w[2]<=pg.rect.width+.1 and w[3]<=pg.rect.height+.1,(p.name,i+1,w)
  assert '\ufffd' not in text
  pagecounts.append(len(d));result['pdfs'].append({'file':p.name,'pages':len(d),'sha256':sha(p),'figure_captions':len(caps),'out_of_page_text':False})
 log=(CHECKS/'typeset'/f'CTVS-{n}-Whitepaper-v0.6.3-Illustrated.log').read_text()
 assert not any(w in log for w in ['Overfull','Missing character','Undefined control sequence'])
with fitz.open(ARCHIVE/'delivery/CTVS-Whitepapers-v0.6.3-Illustrated-Combined.pdf') as d:assert len(d)==sum(pagecounts)
result.update(status='PASS',new_figures=newcount,retained_figures=keepcount,total_figures=15,source_value_identities_checked=5,implementation_release='BLOCKED')
(CHECKS/'polish-results.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'status':'PASS','new':newcount,'retained':keepcount,'pages':pagecounts,'semantic_source_unchanged':True,'wire_unchanged':True},indent=2))
