from PIL import Image, ImageDraw, ImageFont
import os, math
W,H=1280,720
OUT=os.path.join(os.path.dirname(__file__),'frames')
os.makedirs(OUT,exist_ok=True)
FONT='/usr/share/fonts/noto/NotoSans-Regular.ttf'
BOLD='/usr/share/fonts/noto/NotoSans-Bold.ttf'
def f(sz,b=False): return ImageFont.truetype(BOLD if b else FONT,sz)
BG='#0B1020'; PANEL='#151D32'; PANEL2='#1B2740'; WHITE='#F4F7FF'; MUTED='#98A6C4'; GREEN='#77E0AE'; BLUE='#91A9FF'; LINE='#293651'; GOLD='#F6C96B'
def rr(d,box,r,fill,outline=None,w=1): d.rounded_rectangle(box,radius=r,fill=fill,outline=outline,width=w)
def txt(d,xy,s,size=24,color=WHITE,b=False,anchor=None): d.text(xy,s,font=f(size,b),fill=color,anchor=anchor)
def base(kicker,title,sub):
 im=Image.new('RGB',(W,H),BG); d=ImageDraw.Draw(im)
 # subtle ambient orbs
 for rad,col,xy in [(240,'#101B32',(1060,-90)),(170,'#10192B',(60,700))]:
  d.ellipse((xy[0]-rad,xy[1]-rad,xy[0]+rad,xy[1]+rad),fill=col)
 txt(d,(82,65),'MYPLAN',22,GREEN,True); txt(d,(1195,70),'YOUR LIFE. YOUR RULES.',13,MUTED,True,anchor='ra')
 txt(d,(82,175),kicker.upper(),15,GREEN,True); txt(d,(82,220),title,48,WHITE,True); txt(d,(82,286),sub,21,MUTED)
 return im,d
def save(im,n): im.save(os.path.join(OUT,f'{n:04d}.png'))
scenes=[]
# 1 intro
im,d=base('A PERSONAL PLANNER','Make progress, your way.','Rejalarni o‘zing yarat. O‘z sur’atingda bajar. Natijani ko‘r.')
rr(d,(82,390,1198,610),26,PANEL,LINE,2); txt(d,(125,430),'MYPLAN',52,WHITE,True); txt(d,(128,505),'Plan less. Live more.',23,GREEN); rr(d,(925,438,1125,550),20,PANEL2); txt(d,(1025,475),'∞',55,GREEN,True,anchor='mm'); txt(d,(1025,525),'YOUR PACE',13,MUTED,True,anchor='mm'); scenes.append(im)
# 2 dashboard
im,d=base('YOUR DAY, AT A GLANCE','A clear view of today.','Bugungi rejalaring — bitta sokin, tushunarli sahifada.')
rr(d,(82,365,1198,635),24,PANEL,LINE,2); txt(d,(120,402),'MONDAY  ·  TODAY',15,MUTED,True); txt(d,(120,445),'Good afternoon.',34,WHITE,True); txt(d,(120,502),'Your day. Your priorities.',18,MUTED)
for i,(name,meta,done) in enumerate([('Arabic vocabulary','15 / 100 words',False),('Read a book','12 / 20 pages',False),('Morning walk','Completed',True)]):
 y=555+i*0 # compact row at 550? place mini cards horizontally
 x=610+i*185; rr(d,(x,400,x+165,590),16,PANEL2); txt(d,(x+15,425),name,13,WHITE,True); txt(d,(x+15,465),meta,12,GREEN if done else MUTED); rr(d,(x+15,530,x+145,538),4,LINE); rr(d,(x+15,530,x+(145 if done else 15+int(130*(.15 if i==0 else .6))),538),4,GREEN if done else BLUE)
scenes.append(im)
# 3 progress
im,d=base('PROGRESS THAT ADAPTS','Not just “done”.','Miqdorni o‘zing kirit. Istalgan payt davom ettir.')
rr(d,(82,365,1198,635),24,PANEL,LINE,2); txt(d,(125,405),'Arabic vocabulary',25,WHITE,True); txt(d,(125,445),'Daily goal · 100 words',16,MUTED)
txt(d,(125,515),'50',66,GREEN,True); txt(d,(225,555),'/ 100 words',20,MUTED)
rr(d,(520,515,1120,535),10,LINE); rr(d,(520,515,820,535),10,GREEN)
for j,(label,x) in enumerate([('+1',530),('+5',700),('+10',870),('Custom',1040)]): rr(d,(x,570,x+95,612),12,PANEL2,LINE); txt(d,(x+47,591),label,16,WHITE,True,anchor='mm')
scenes.append(im)
# 4 flexible schedules
im,d=base('YOUR RHYTHM','Every goal has its own rhythm.','Har kuni, haftada bir marta yoki o‘zing belgilagan jadval.')
for i,(tag,title,desc,icon) in enumerate([('DAILY','Learn 100 words','Har kuni · 100 ta', '01'),('WEEKLY','Meet your friends','Haftada · 1 marta','02'),('MONTHLY','Explore somewhere','Oyda · 1 marta','03')]):
 x=82+i*380; rr(d,(x,380,x+345,610),22,PANEL,LINE,2); txt(d,(x+26,410),tag,14,GREEN,True); txt(d,(x+26,465),title,22,WHITE,True); txt(d,(x+26,515),desc,16,MUTED); txt(d,(x+300,570),icon,24,BLUE,True,anchor='mm')
scenes.append(im)
# 5 streaks
im,d=base('CONSISTENCY, NOT PRESSURE','See how far you’ve come.','Streaklar va statistika — sening haqiqiy tarixing asosida.')
rr(d,(82,370,1198,630),24,PANEL,LINE,2); txt(d,(125,410),'CURRENT STREAK',14,MUTED,True); txt(d,(125,455),'12',68,GREEN,True); txt(d,(225,500),'weeks',20,MUTED); txt(d,(560,410),'THIS MONTH',14,MUTED,True)
for i,h in enumerate([65,95,120,80,145,115,170,130,185,150,205,175]):
 x=570+i*42; rr(d,(x,590-h/1.6,x+22,590),7,GREEN if i in (2,5,8,11) else BLUE)
txt(d,(560,600),'Your progress, made visible.',15,MUTED)
scenes.append(im)
# 6 close
im,d=base('START WITH WHAT MATTERS','Your life. Your plan.','MYPLAN — shaxsiy rejalaring va davomiyliging uchun.')
rr(d,(82,390,1198,610),26,PANEL,LINE,2); txt(d,(640,465),'MYPLAN',72,WHITE,True,anchor='mm'); txt(d,(640,535),'BUILD YOUR OWN CONSISTENCY',17,GREEN,True,anchor='mm'); scenes.append(im)
# Render 18 sec at 18 fps with 0.45s crossfades, gentle zoom/pan
fps=18; hold=54; fade=10; frames=[]
for si,scene in enumerate(scenes):
 for j in range(hold):
  # gentle zoom-in, centered
  t=j/(hold-1); scale=1.0+0.018*t
  sw,sh=int(W*scale),int(H*scale); z=scene.resize((sw,sh),Image.Resampling.LANCZOS); left=(sw-W)//2; top=(sh-H)//2; frame=z.crop((left,top,left+W,top+H))
  if si>0 and j<fade:
   prev=frames[-1]; frame=Image.blend(prev,frame,(j+1)/fade)
  frames.append(frame)
for i,frame in enumerate(frames): frame.save(os.path.join(OUT,f'{i:04d}.png'),optimize=False)
print(f'Rendered {len(frames)} frames')
