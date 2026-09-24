from pathlib import Path
import fitz,json,re
from PIL import Image,ImageDraw
R=Path(__file__).resolve().parent.parent;Q=R/'qa';Q.mkdir(exist_ok=True)
summary=[]
for n in (1,2):
 d=fitz.open(R/'output'/f'CTVS-{n}-Whitepaper.pdf')
 folder=Q/f'ctvs{n}';folder.mkdir(exist_ok=True)
 for i,p in enumerate(d):
  p.get_pixmap(matrix=fitz.Matrix(1.30,1.30),alpha=False).save(folder/f'page-{i+1:02d}.png')
  text=p.get_text()
  captions=re.findall(r'Figure (\d+): ([^\n]+)',text)
  if captions:summary.append({'paper':n,'page':i+1,'figures':captions})
 for start in range(0,len(d),6):
  sheet=Image.new('RGB',(1500,2010),'#e7ebef');dr=ImageDraw.Draw(sheet)
  for j in range(start,min(start+6,len(d))):
   im=Image.open(folder/f'page-{j+1:02d}.png').convert('RGB');im.thumbnail((480,952))
   x=10+(j-start)%3*500;y=30+(j-start)//3*1000
   sheet.paste(im,(x,y));dr.text((x,y-20),f'CTVS-{n} | PDF {j+1}',fill='#112e43')
  sheet.save(Q/f'contact-{n}-{start//6+1:02d}.jpg',quality=89)
 print('CTVS',n,len(d),'pages')
(Q/'figure-pages.json').write_text(json.dumps(summary,indent=2))
print(json.dumps(summary,indent=2))
