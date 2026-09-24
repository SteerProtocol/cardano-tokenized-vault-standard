#!/usr/bin/env python3
"""Publication artwork only. Exact source semantics; no contract-validation claims."""
from pathlib import Path
import math, json, re, textwrap
from PIL import ImageFont
import svgwrite, cairosvg

ROOT=Path(__file__).resolve().parent.parent
PREVIEWS=ROOT/'qa/figure-previews'
for p in ['figures/svg','figures/pdf','figures/png','qa/figure-previews']: (ROOT/p).mkdir(parents=True,exist_ok=True)
INK='#122C45'; MUTED='#52687C'; LINE='#8298AD'; RULE='#CEDBE6'
PAL={
 'blue':('#EEF5FD','#FCFDFE','#7D9FBE','#345E86'),
 'green':('#EDF7F2','#FCFEFC','#78A88F','#32765B'),
 'purple':('#F3EFFB','#FEFCFF','#A18BBE','#725294'),
 'sand':('#FBF5E8','#FFFDF9','#C7AD74','#947331'),
 'red':('#FAF0F0','#FFFCFC','#C39299','#A15564'),
 'slate':('#F1F5F9','#FFFFFF','#9CAEBD','#526A7E')}
FONT='/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf'
BOLD='/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf'
SERIF='/usr/share/fonts/truetype/liberation2/LiberationSerif-Bold.ttf'
# Resolve normal system font paths without distributing the fonts.
import subprocess
for key,name in [('FONT','Liberation Sans'),('BOLD','Liberation Sans:style=Bold'),('SERIF','Liberation Serif:style=Bold')]:
 globals()[key]=subprocess.check_output(['fc-match','-f','%{file}',name],text=True).strip()

def measure(s,size,bold=False,serif=False):
 return ImageFont.truetype(SERIF if serif else BOLD if bold else FONT,int(size)).getlength(s)

def wrap(s,size,width,bold=False,serif=False):
 result=[]
 for para in s.split('\n'):
  if not para: result.append('');continue
  line=''
  for word in para.split():
   assert measure(word,size,bold,serif)<=width+1,(word,size,width)
   trial=(line+' '+word).strip()
   if line and measure(trial,size,bold,serif)>width:
    result.append(line);line=word
   else:line=trial
  result.append(line)
 return result

class Fig:
 def __init__(self,name,title,scope,h=980):
  self.name=name;self.W=1480;self.H=h;self.regions=[];self.labels=[];self.edges=[];self.min_body=100
  self.d=svgwrite.Drawing(str(ROOT/'figures/svg'/f'{name}.svg'),size=(f'{self.W}px',f'{h}px'),viewBox=f'0 0 {self.W} {h}')
  self.d.add(self.d.rect((0,0),(self.W,h),fill='white'))
  self.layer_bg=self.d.g(id='background-panels');self.d.add(self.layer_bg)
  self.layer_edges=self.d.g(id='connectors');self.d.add(self.layer_edges)
  self.layer_nodes=self.d.g(id='cards');self.d.add(self.layer_nodes)
  self.layer_text=self.d.g(id='labels');self.d.add(self.layer_text)
  for theme,(a,b,stroke,ink) in PAL.items():
   gr=self.d.linearGradient(start=(0,0),end=(1,1),id='fill-'+theme)
   gr.add_stop_color(0,a);gr.add_stop_color(1,b);self.d.defs.add(gr)
   m=self.d.marker(id='arrow-'+theme,insert=(9,5),size=(10,10),orient='auto',markerUnits='userSpaceOnUse')
   m.add(self.d.path(d='M 0 0 L 9 5 L 0 10 Z',fill=ink));self.d.defs.add(m)
  self.text(740,40,scope.upper(),20,weight=600,color=MUTED,anchor='middle',tracking=1.5)
  self.text(740,101,title,45,weight=700,serif=True,anchor='middle')
 def text(self,x,y,s,size=24,weight=400,color=INK,anchor='start',serif=False,tracking=0):
  w=measure(s,size,weight>=600,serif)+max(0,len(s)-1)*tracking
  left=x-w/2 if anchor=='middle' else x-w if anchor=='end' else x
  assert left>=-1 and left+w<=self.W+1,(self.name,'outside horizontal',s,left,w)
  assert y-size>=-2 and y+size*.25<=self.H+2,(self.name,'outside vertical',s,y)
  kwargs=dict(insert=(x,y),font_family='Liberation Serif' if serif else 'Liberation Sans',font_size=size,font_weight=weight,fill=color,text_anchor=anchor)
  if tracking:kwargs['letter_spacing']=tracking
  self.layer_text.add(self.d.text(s,**kwargs));self.labels.append({'text':s,'x0':left,'y0':y-size,'x1':left+w,'y1':y+size*.25,'size':size})
 def para(self,x,y,s,width,size=24,color=MUTED,lh=None,weight=400,anchor='start'):
  lh=lh or size*1.34;lines=wrap(s,size,width,weight>=600)
  for j,line in enumerate(lines):self.text(x,y+j*lh,line,size,weight,color,anchor)
  self.min_body=min(self.min_body,size)
  return y+(len(lines)-1)*lh+size*.25
 def icon(self,name,x,y,theme='blue',size=42):
  color=PAL[theme][3]
  g=self.d.g(transform=f'translate({x},{y}) scale({size/48})',stroke=color,fill='none',stroke_width=2.25,stroke_linecap='round',stroke_linejoin='round')
  def path(s):g.add(self.d.path(d=s))
  def circle(cx,cy,r):g.add(self.d.circle((cx,cy),r))
  if name=='doc':
   path('M 11 5 H 29 L 38 14 V 43 H 11 Z M 29 5 V 14 H 38 M 17 23 H 31 M 17 30 H 31 M 17 36 H 26')
  elif name=='vault':
   g.add(self.d.ellipse((24,10),(16,6)));path('M 8 10 V 35 C 8 44 40 44 40 35 V 10 M 8 23 C 8 32 40 32 40 23 M 8 34 C 8 43 40 43 40 34')
  elif name=='wallet':
   path('M 6 14 H 39 V 40 H 6 Z M 6 14 L 34 6 V 14 M 30 23 H 43 V 33 H 30 Z');circle(35,28,1)
  elif name=='shield':
   path('M 24 4 L 40 11 V 25 C 40 35 33 41 24 45 C 15 41 8 35 8 25 V 11 Z M 15 24 L 21 30 L 33 17')
  elif name=='key':
   circle(15,18,9);path('M 21 25 L 39 43 M 30 34 L 35 29 M 35 39 L 40 34')
  elif name=='clock':
   circle(24,24,18);path('M 24 12 V 24 L 32 29')
  elif name=='token':
   circle(20,21,14);path('M 32 11 C 47 17 45 38 32 41 C 22 44 17 38 17 37 M 20 13 V 29 M 25 16 C 20 10 12 17 19 21 C 30 23 23 32 16 27')
  elif name=='package':
   path('M 24 4 L 43 14 V 35 L 24 45 L 5 35 V 14 Z M 5 14 L 24 25 L 43 14 M 24 25 V 45 M 15 9 L 33 19')
  elif name=='check':
   circle(24,24,18);path('M 14 24 L 21 31 L 35 17')
  elif name=='cross':
   circle(24,24,18);path('M 17 17 L 31 31 M 31 17 L 17 31')
  elif name=='link':
   path('M 20 29 L 14 35 C 3 43 -2 28 8 22 L 17 13 C 23 7 31 11 31 17 M 28 19 L 34 13 C 45 5 50 20 40 26 L 31 35 C 25 41 17 37 17 31 M 15 32 L 33 14')
  elif name=='code':
   path('M 16 13 L 6 24 L 16 35 M 32 13 L 42 24 L 32 35 M 27 9 L 21 39')
  elif name=='balance':
   path('M 24 7 V 42 M 10 42 H 38 M 7 15 H 41 M 12 15 L 5 29 H 19 Z M 36 15 L 29 29 H 43 Z');circle(24,8,3)
  elif name=='branch':
   circle(12,8,4);circle(36,40,4);circle(12,40,4);path('M 12 12 V 36 M 12 23 H 26 Q 36 23 36 33 V 36')
  elif name=='layers':
   path('M 24 6 L 44 17 L 24 28 L 4 17 Z M 6 26 L 24 37 L 42 26 M 6 35 L 24 46 L 42 35')
  elif name=='lock':
   path('M 14 21 V 13 C 14 0 34 0 34 13 V 21 M 9 21 H 39 V 43 H 9 Z M 24 29 V 35');circle(24,29,2)
  elif name=='info':
   circle(24,24,18);circle(24,14,1);path('M 24 21 V 34')
  self.layer_nodes.add(g)
 def card(self,x,y,w,h,title,body='',theme='blue',icon=None,title_size=29,body_size=24,dashed=False):
  a,b,stroke,ink=PAL[theme]
  # Very subtle depth, uniform outline: no left accent stripe.
  self.layer_nodes.add(self.d.rect((x,y+2),(w,h),rx=18,fill='#EDF1F5',opacity=.35))
  kw=dict(insert=(x,y),size=(w,h),rx=18,fill=f'url(#fill-{theme})',stroke=stroke,stroke_width=1.8)
  if dashed:kw['stroke_dasharray']='8 6'
  self.layer_nodes.add(self.d.rect(**kw));self.regions.append((x,y,x+w,y+h,title))
  tx=x+28+(56 if icon else 0);tw=w-56-(56 if icon else 0)
  lines=wrap(title,title_size,tw,True)
  ty=y+42
  if icon:self.icon(icon,x+25,y+16,theme,40)
  for k,l in enumerate(lines):self.text(tx,ty+k*title_size*1.12,l,title_size,700,INK)
  by=ty+(len(lines)-1)*title_size*1.12+40
  if body:
   bottom=self.para(x+28,by,body,w-56,body_size,lh=body_size*1.36)
   assert bottom<=y+h-17,(self.name,title,'body overflows',bottom,y+h)
  return (x,y,w,h)
 def panel(self,x,y,w,h,label,theme='blue',small=None):
  self.layer_bg.add(self.d.rect((x,y),(w,h),rx=20,fill='#FFFFFF',stroke=RULE,stroke_width=1.3))
  self.text(x+28,y+38,label,26,700,PAL[theme][3])
  if small:self.text(x+28,y+72,small,22,color=MUTED)
 def badge(self,x,y,text,theme='blue',w=None):
  w=w or measure(text,20,True)+32
  self.layer_nodes.add(self.d.rect((x,y),(w,36),rx=18,fill=PAL[theme][0],stroke=PAL[theme][2],stroke_width=1.2))
  self.text(x+w/2,y+25,text,20,600,PAL[theme][3],anchor='middle')
 def arrow(self,pts,theme='slate',label=None,lx=None,ly=None,dashed=False):
  # Rounded orthogonal joints rather than diagonal shortcuts through labels.
  d=f'M {pts[0][0]} {pts[0][1]}'
  for k in range(1,len(pts)):
   if k==len(pts)-1:d+=f' L {pts[k][0]} {pts[k][1]}';continue
   a,b,c=pts[k-1],pts[k],pts[k+1]
   l1=math.dist(a,b);l2=math.dist(b,c);r=min(16,l1/2,l2/2)
   p=(b[0]+(a[0]-b[0])*r/l1,b[1]+(a[1]-b[1])*r/l1)
   q=(b[0]+(c[0]-b[0])*r/l2,b[1]+(c[1]-b[1])*r/l2)
   d+=f' L {p[0]} {p[1]} Q {b[0]} {b[1]} {q[0]} {q[1]}'
  kw=dict(d=d,fill='none',stroke=PAL[theme][3],stroke_width=2.4,stroke_linecap='round',stroke_linejoin='round')
  if dashed:kw['stroke_dasharray']='7 6'
  p=self.d.path(**kw);p.update({'marker-end':f'url(#arrow-{theme})'});self.layer_edges.add(p)
  self.edges.append({'points':pts,'label':label})
  if label:
   assert lx is not None and ly is not None
   lines=wrap(label,21,220)
   for j,l in enumerate(lines):self.text(lx,ly+j*27,l,21,600,PAL[theme][3],anchor='middle')
 def note(self,y,title,body,theme='slate',h=120):
  self.layer_nodes.add(self.d.rect((48,y),(1384,h),rx=18,fill=f'url(#fill-{theme})',stroke=PAL[theme][2],stroke_width=1.5))
  self.icon('info',72,y+12,theme,34)
  self.text(122,y+37,title,27,700)
  b=self.para(76,y+78,body,1328,23)
  assert b <= y+h-5,(self.name,'note overflow',b,y+h)
 def metric(self,x,y,w,label,number,theme='blue',suffix=''):
  self.layer_nodes.add(self.d.rect((x,y),(w,128),rx=16,fill=f'url(#fill-{theme})',stroke=PAL[theme][2],stroke_width=1.5))
  self.text(x+24,y+35,label,23,600,PAL[theme][3]);self.text(x+24,y+82,number,36,700)
  if suffix:self.text(x+24,y+111,suffix,21,color=MUTED)
 def save(self):
  self.d.save(pretty=True)
  svg=ROOT/'figures/svg'/f'{self.name}.svg';pdf=ROOT/'figures/pdf'/f'{self.name}.pdf';png=PREVIEWS/f'{self.name}.png'
  cairosvg.svg2pdf(url=str(svg),write_to=str(pdf))
  cairosvg.svg2png(url=str(svg),write_to=str(png),output_width=2220,output_height=round(self.H*1.5))
  return {'id':self.name,'width':self.W,'height':self.H,'labels':self.labels,'cards':self.regions,'connectors':self.edges,'min_body_size':self.min_body}

ALL=[]
def genesis():
 g=Fig('ctvs1-f03-genesis-flow','Acyclic genesis & identity creation','CTVS-1  /  Direct Custody Profile',1010)
 g.text(48,176,'INPUTS',21,600,MUTED,tracking=1)
 g.text(535,176,'BUILD',21,600,MUTED,tracking=1)
 g.text(1040,176,'ONE-TIME TRANSACTION',21,600,MUTED,tracking=1)
 g.card(48,210,364,156,'Seed output r0','Existing UTxO\nConsumed once at genesis','purple','key',28,24)
 g.card(48,410,364,200,'Terms K','Assets, fees, modes, roles\nCommitment hK\nNo self-dependent hash','blue','doc',28,24)
 g.card(535,275,382,310,'Parameterize T','Compile F_lock and Q_claim first.\nApply r0 and hK to T.\nDerive policy / script hash P.','slate','code',28,24)
 g.card(1040,210,392,288,'Genesis mint','Consume r0.\nMint ID(1) and STATE(1).\nMint no SHARE.\nReject extra policy assets.','sand','shield',29,24)
 g.arrow([(412,288),(475,288),(475,338),(535,338)],'purple',label='r0',lx=470,ly=260)
 g.arrow([(412,510),(475,510),(475,465),(535,465)],'blue',label='hK',lx=475,ly=551)
 g.arrow([(917,353),(1040,353)],'slate',label='P',lx=978,ly=328)
 g.card(48,685,660,176,'Config at F_lock','ID(1) • Terms K and hK • exact reserve','blue','lock',30,25)
 g.card(772,685,660,176,'State at P','STATE(1) • A = S = F = 0 • positive reserve','green','vault',30,25)
 g.arrow([(1176,498),(1176,633),(378,633),(378,685)],'blue')
 g.arrow([(1276,498),(1276,656),(1102,656),(1102,685)],'green')
 g.para(740,921,'After genesis: only SHARE may change, coupled to an authentic State transition.\nID and STATE cannot be minted again or burned. Compiled deployment proof remains required.',1370,24,anchor='middle')
 ALL.append(g.save())

def allocation():
 g=Fig('ctvs1-f04-protected-obligations','Every protected obligation needs its own value','CTVS-1  /  Reference-profile payment allocation',890)
 g.panel(48,170,660,520,'REJECTED: payment reused','red')
 g.panel(772,170,660,520,'REQUIRED PATTERN: distinct outputs','green')
 g.card(76,252,245,132,'Obligation A','10 UNIT','red',None,27,27)
 g.card(76,454,245,132,'Obligation B','10 UNIT','red',None,27,27)
 g.card(445,352,235,156,'Output 0','10 UNIT\nSame receiver','red',None,27,26)
 g.arrow([(321,318),(374,318),(374,397),(445,397)],'red')
 g.arrow([(321,520),(398,520),(398,462),(445,462)],'red')
 g.card(800,252,245,132,'Obligation A','10 UNIT','green',None,27,27)
 g.card(800,454,245,132,'Obligation B','10 UNIT','green',None,27,27)
 g.card(1169,252,235,132,'Output 0','10 UNIT','green',None,27,27)
 g.card(1169,454,235,132,'Output 1','10 UNIT','green',None,27,27)
 g.arrow([(1045,318),(1169,318)],'green');g.arrow([(1045,520),(1169,520)],'green')
 g.text(378,642,'20 owed  ≠  10 funded',30,700,PAL['red'][3],anchor='middle')
 g.text(1102,642,'20 owed  =  20 funded',30,700,PAL['green'][3],anchor='middle')
 g.note(734,'Same receiver is allowed. Reusing protected value is not.','Each allocation must still match its amount, full destination and datum, within the closed transaction family.',h=112)
 ALL.append(g.save())

def direct():
 g=Fig('ctvs1-f05-direct-operation-anatomy','Deposit and redeem: opposite supply effects','CTVS-1  /  Worked examples 1 and 2',1110)
 g.panel(48,174,660,766,'1  DEPOSIT 101,000 UNIT','blue','Fee-exclusive admission; then share issuance')
 g.panel(772,174,660,766,'2  REDEEM 50,500 SHARE','purple','Uses the deposit’s successor state')
 g.card(76,280,604,168,'Consumed inputs','State: A = S = 1,000,000; F = 0\nUser: 101,000 UNIT + 6,000,000 lovelace','blue','wallet',30,24)
 g.card(800,280,604,168,'Consumed inputs','State: A = S = 1,100,000; F = 1,000\nHolder: 50,500 SHARE + 5,000,000 lovelace','purple','wallet',30,24)
 g.card(76,504,604,200,'Recompute & enforce bounds','Entry fee: 1,000 UNIT\nBacking +100,000; issue 100,000 SHARE\nMinimum: 99,900 SHARE','blue','balance',30,24)
 g.card(800,504,604,200,'Recompute & enforce bounds','Gross debit: 50,500; exit fee: 500 UNIT\nPay 50,000 UNIT; extinguish 50,500 SHARE\nMinimum: 49,900 UNIT','purple','balance',30,24)
 g.card(76,760,604,150,'Created outputs','State: 1,101,000 UNIT\nReceiver: 100,000 SHARE','green','package',30,24)
 g.card(800,760,604,150,'Created outputs','State: 1,051,000 UNIT\nReceiver: 50,000 UNIT','green','package',30,24)
 for x in [378,1102]:
  g.arrow([(x,448),(x,504)]);g.arrow([(x,704),(x,760)])
 g.note(979,'Fees remain separate from share backing.','UNIT and SHARE amounts are base units. State reserves, output ADA, funder change and network fees remain separately accounted for in Section 9.',h=122)
 ALL.append(g.save())

def ada():
 g=Fig('ctvs1-f06-ada-accounting-partitions','ADA: backing, fees and reserves are not interchangeable','CTVS-1  /  Worked example 3 • all ADA values in lovelace',1050)
 g.panel(48,171,660,380,'BEFORE DEPOSIT','blue')
 g.panel(772,171,660,380,'AFTER DEPOSIT','green')
 g.text(80,265,'103,000,000',44,700);g.text(804,265,'113,100,000',44,700)
 g.text(80,303,'Total State UTxO value',24,color=MUTED);g.text(804,303,'Total State UTxO value',24,color=MUTED)
 for x,vals in [(80,[('Backing A','100,000,000'),('Accrued fees F','0'),('Storage reserve R','3,000,000')]),(804,[('Backing A','110,000,000'),('Accrued fees F','100,000'),('Storage reserve R','3,000,000')])]:
  for i,(k,v) in enumerate(vals):
   y=377+61*i;g.text(x,y,k,25,color=MUTED);g.text(x+590,y,v,28,700,anchor='end')
 g.arrow([(708,263),(772,263)],'green')
 g.card(48,590,1384,144,'User funds 15,100,000 lovelace','Gross deposit 10,100,000 = 10,000,000 new backing + 100,000 fee. The remaining 5,000,000 funds the allocations below.','purple','wallet',30,25)
 g.metric(48,778,440,'Share-output reserve','2,000,000','blue','Receiver also gets 10,000,000 SHARE')
 g.metric(520,778,440,'Funder change','2,600,000','slate','Outside the vault’s backing')
 g.metric(992,778,440,'Network fee','400,000','sand','Illustrative - not a network estimate')
 g.text(740,981,'118,100,000 in  =  113,100,000 + 2,000,000 + 2,600,000 + 400,000 out',27,600,anchor='middle')
 g.text(740,1023,'Reserve R is unchanged; output storage does not buy extra shares.',24,color=MUTED,anchor='middle')
 ALL.append(g.save())

def managed():
 g=Fig('ctvs1-f07-managed-accounting-boundary','Managed backing is not the same as available liquidity','CTVS-1  /  Managed extension • outside Direct Custody Profile',955)
 g.card(48,245,394,317,'Custody evidence','Idle underlying\nAuthenticated positions\nRestricted assets\nActual downstream rights','green','layers',29,26)
 g.card(544,245,394,317,'Valuation & liabilities','Pinned position set\nDebt and accrued fees\nAccepted state-basis report\nReporter trust disclosed','blue','balance',29,25)
 g.card(1040,201,392,197,'Backing A','Recognized net equity\nNo double counting\nDeficits remain explicit','green','vault',29,24)
 g.card(1040,473,392,197,'Liquidity L','What can actually be paid\nAvailable underlying\nAuthorized unwind path','sand','wallet',29,24)
 g.arrow([(442,400),(544,400)],'blue')
 g.arrow([(938,351),(990,351),(990,299),(1040,299)],'green')
 g.arrow([(938,456),(990,456),(990,571),(1040,571)],'sand')
 g.card(48,720,1384,140,'Bind absolute NAV to its exact accounting-state basis','Otherwise use only a separately specified and proved cash-flow bridge; a stale absolute report cannot silently overwrite intervening flows.','purple','link',28,24)
 g.para(740,903,'A signature identifies the reporter - it does not establish truthful value.\nPositive backing does not guarantee immediate exit. Managed conformance still needs a real integration.',1360,24,anchor='middle')
 ALL.append(g.save())

def request():
 g=Fig('ctvs2-f02-request-creation-envelope','One request, two deliberately separate validation paths','CTVS-2  /  Direct Custody Profile • independent request creation',1010)
 g.card(48,205,392,178,'User inputs','Offered assets or shares\nStorage + execution budget','purple','wallet',29,24)
 g.card(544,205,392,178,'Create request','Create an independent UTxO.\nReturn user change.','slate','doc',29,24)
 g.card(1040,205,392,178,'Request UTxO','Stable identity: originating\ntransaction output reference','blue','package',29,24)
 g.arrow([(440,293),(544,293)]);g.arrow([(936,293),(1040,293)],'blue')
 g.badge(48,424,'ACCOUNTING STATE IS NOT CONSUMED','green',548)
 g.text(740,492,'SUPPORTED OUTER VERSION  +  RECOVERY  +  ECONOMIC BODY',24,600,MUTED,anchor='middle')
 g.card(48,540,660,304,'Stable Recovery envelope','Vault binding and controller\nFixed refund destination and datum\nDeadline\nRead before economic downcasting','blue','shield',30,25)
 g.card(772,540,660,304,'Settlement-only economic body','Terms, operation and offered quantity\nMinimum output and success receiver\nStorage, budget and exact settler fee\nValidate the complete economic intent','purple','code',30,25)
 g.para(740,911,'Creation does not change backing or supply, reserve capacity, or prove settlement eligibility.\nUnsupported economics can remain refundable only when the outer Recovery envelope is valid.',1370,24,anchor='middle')
 ALL.append(g.save())

def ack():
 g=Fig('ctvs2-f03-two-way-acknowledgment','Settlement requires agreement in both directions','CTVS-2  /  Direct Custody Profile • request / State coupling',940)
 g.card(48,239,556,334,'Consumed Request','RequestSpend:\nAcknowledge(state_ref)\n\nPoints to the actual consumed State\nand its StateSpend(Batch) action.','purple','doc',30,25)
 g.card(876,239,556,334,'Consumed State','StateSpend:\nBatch(entries)\n\nChecks every consumed Request\nand its matching acknowledgment.','blue','vault',30,25)
 g.arrow([(604,341),(876,341)],'purple',label='must name this State',lx=740,ly=302)
 g.arrow([(876,478),(604,478)],'blue',label='must cover this Request',lx=740,ly=516)
 g.card(48,631,1384,168,'Complete, unique coverage - not a batcher’s assertion','Unique entry references  +  exact set equality with all consumed Requests.\nPrice and validate the same covered set; every protected output remains separately allocated.','green','check',30,25)
 g.para(740,862,'Referencing State is insufficient. Pause or reserve top-up is not Batch.\nAn omitted request, duplicate entry, or Cancel branch cannot count as acknowledgment.',1370,24,anchor='middle')
 ALL.append(g.save())

def variants():
 g=Fig('ctvs2-f05-delivery-variants','Two delivery paths, one economic cutover','CTVS-2  /  Direct Custody Profile and a separate native semantic variant',985)
 g.panel(48,177,1384,281,'A  Direct Custody Profile  -  FUNDED CLAIM','blue')
 g.card(76,250,324,177,'Request','Direct Custody Profile\nConsent consumed in settlement','purple','doc',28,24)
 g.card(542,250,396,177,'Funded claim','100,000 SHARE + 2,000,000 lovelace\nShares already participate','blue','package',29,24)
 g.card(1080,250,324,177,'Final receiver','Exact destination and datum\nNo repricing or mint','green','wallet',28,24)
 g.arrow([(400,335),(542,335)],'blue',label='settle',lx=471,ly=312)
 g.arrow([(938,335),(1080,335)],'green',label='deliver later',lx=1009,ly=312)
 g.panel(48,505,1384,281,'B  NATIVE SEMANTIC VARIANT  -  DIRECT AT SETTLEMENT','sand')
 g.card(76,578,324,177,'Request','Explicit direct-delivery\nconsent and variant binding','purple','doc',28,24)
 g.card(542,578,396,177,'Settlement','Same quote, fees and supply change\nNo intermediate Claim UTxO','slate','balance',29,24)
 g.card(1080,578,324,177,'Final receiver','100,000 SHARE\n2,000,000 lovelace','green','wallet',28,24)
 g.arrow([(400,663),(542,663)],'sand',label='consume',lx=471,ly=640)
 g.arrow([(938,663),(1080,663)],'sand',label='pay now',lx=1009,ly=640)
 g.note(840,'A native variant cannot reinterpret an existing Direct Custody Profile request.','It needs its own reviewed consent, encoding and transaction rules. Both routes change economic participation at settlement - not at later claim delivery.',h=127)
 ALL.append(g.save())

def recovery():
 g=Fig('ctvs2-f06-recovery-flow','Recovery can succeed when settlement cannot','CTVS-2  /  Direct Custody Profile • fixed full-value refund',1025)
 g.card(48,231,394,241,'Actual Request value','101,000 UNIT\n3,500,000 lovelace\n7 EXTRA','purple','package',29,27)
 g.card(544,231,394,241,'Decode Recovery first','Supported outer version\nVault, controller, fixed refund\nDeadline','blue','shield',29,25)
 g.card(1040,231,392,241,'Invalid economics','Unsupported C(99, [])\nSettlement must reject.\nThis does not alone block refund.','red','cross',29,24)
 g.arrow([(442,351),(544,351)],'blue');g.arrow([(938,351),(1040,351)],'red',dashed=True)
 g.card(48,593,394,190,'External fee funding','Pays the network fee and any\nrequired output top-up.\nNo request asset is retained.','slate','wallet',29,24)
 g.card(544,593,394,190,'Controller OR expiry','Controller key may cancel.\nAnyone may refund when the\nwhole interval is at/after expiry.','blue','clock',28,24)
 g.card(1040,593,392,210,'Fixed full-value refund','101,000 UNIT • 7 EXTRA\n3,500,000 lovelace\nExact destination and datum','green','check',29,24)
 g.arrow([(741,472),(741,593)],'blue',label='refund branch',lx=846,ly=543)
 g.arrow([(938,688),(1040,688)],'green')
 g.note(847,'No current State, NAV, open pause flag or batcher is required.','Unknown outer versions, malformed Recovery or invalid destinations have no universal rescue promise. Full-value preservation is not unconditional liveness.',h=137)
 ALL.append(g.save())

def zero():
 g=Fig('ctvs2-f07-zero-net-mint','Zero net mint does not mean zero obligations','CTVS-2  /  One-to-one snapshot • zero fees',900)
 for x,label in [(48,'CONSUMED REQUESTS'),(544,'GROSS ECONOMIC EFFECTS'),(1040,'FUNDED RESULTS')]:g.text(x,181,label,21,600,MUTED,tracking=.5)
 g.card(48,233,394,169,'Deposit request','10 UNIT','purple','wallet',30,28)
 g.card(544,233,394,169,'Issue +10 SHARE','Backing +10 UNIT\nParticipating shares +10','blue','token',30,24)
 g.card(1040,233,392,169,'Depositor claim','10 SHARE\nAlready participating','green','package',29,25)
 g.card(48,478,394,169,'Redemption request','10 pre-existing SHARE','purple','wallet',28,26)
 g.card(544,478,394,169,'Extinguish 10 SHARE','Backing −10 UNIT\nParticipating shares −10','blue','token',27,24)
 g.card(1040,478,392,169,'Redeemer claim','10 UNIT\nFixed allocated assets','green','package',29,25)
 for y in [318,563]:
  g.arrow([(442,y),(544,y)],'blue');g.arrow([(938,y),(1040,y)],'green')
 g.text(740,732,'10 issued − 10 extinguished = 0 net SHARE mint',37,700,anchor='middle')
 g.text(740,782,'A = S = 1,000 before and after. Both economic exchanges still occur.',25,color=MUTED,anchor='middle')
 g.para(740,844,'State and Request handlers must enforce both gross effects, exact claims and value conservation,\neven when no minting-policy invocation occurs for SHARE.',1350,24,anchor='middle')
 ALL.append(g.save())

def inflight():
 g=Fig('ctvs2-f08-inflight-boundary','Committed downstream is no longer pending escrow','CTVS-2  /  Managed extension boundary • not a Direct Custody Profile workflow',995)
 g.card(48,241,394,268,'Pending escrow','Property remains at request guard.\nFixed cancellation / expiry rights.\nNot share backing.','purple','lock',29,25)
 g.card(544,241,394,268,'Accepted / in-flight','Assets committed downstream.\nExposure and failure rights change.\nNot automatically refundable.','sand','layers',29,25,dashed=True)
 g.card(1040,241,392,268,'Funded result','Shares issued or assets fixed.\nEconomic cutover is explicit.\nDelivery rights are defined.','green','package',29,25)
 g.arrow([(442,373),(544,373)],'sand',label='accept',lx=493,ly=348)
 g.arrow([(938,373),(1040,373)],'green',label='settle',lx=989,ly=348)
 g.card(48,637,394,205,'Fixed refund','Only while property remains PendingEscrow under the declared profile.','blue','wallet',29,24)
 g.card(544,637,394,205,'Failure / unwind','Who bears the loss?\nWhat can be cancelled?\nWhich on-chain right recovers value?','red','branch',29,24)
 g.card(1040,637,392,205,'Required extension rules','Custody and valuation\nInterim ownership and losses\nActual recovery permissions','slate','doc',27,24)
 g.arrow([(245,509),(245,637)],'blue',label='cancel / expire',lx=360,ly=581)
 g.arrow([(741,509),(741,637)],'red',label='failure',lx=808,ly=581)
 g.para(740,894,'An operator notice or timeout cannot reverse a completed investment or manufacture liquidity.\nThe extension must specify the rights at every intermediate state.',1360,25,anchor='middle')
 ALL.append(g.save())

if __name__=='__main__':
 for fn in [genesis,allocation,direct,ada,managed,request,ack,variants,recovery,zero,inflight]:
  fn();print('Rendered',ALL[-1]['id'])
 (ROOT/'qa/figure-geometry.json').write_text(json.dumps(ALL,indent=2))
 print('Total new vector figures:',len(ALL))
