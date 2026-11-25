"""테스트용 목업 사이트 만들기 (가짜 데이터만 사용, 실제 개인 데이터·토큰 없음)

    python3 dev/mock.py
    python3 -m http.server 8765 -d .mock     # → http://localhost:8765/#home

- 브라우저 안에서 GitHub API 호출을 가로채 가짜 data.json·prices.json·history.json·apt.json·gcal.json 을 돌려준다.
- 뉴스(data/news.json)·투자 가이드(data/guide.json)는 저장소의 실제 공개 파일을 그대로 쓴다.
- 메일 탭은 암호화된 목업 메일이 없어 '연결된 계정 없음'으로 보인다.
- .mock/ 폴더는 .gitignore 에 들어 있다. 테스트가 끝나면 지워도 된다.
"""
import datetime, json, os, random, re, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, ".mock")
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT)
for f in ["app.js", "app.css", "keywords.json", "holidays.json", "favicon.svg", "favicon-32.png", "apple-touch-icon.png"]:
    if os.path.exists(os.path.join(ROOT, f)):
        shutil.copy(os.path.join(ROOT, f), OUT)
shutil.copytree(os.path.join(ROOT, "data"), os.path.join(OUT, "data"))

MOCK = r"""<script>
(function(){
  localStorage.setItem('token','mock'); localStorage.setItem('repo','grandaise/news-feed');
  const b64=s=>{const b=new TextEncoder().encode(s);let r="";for(let i=0;i<b.length;i+=32768)r+=String.fromCharCode(...b.subarray(i,i+32768));return btoa(r)};
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
  let data={events:[{id:'e1',date:today,time:'14:00',title:'거래처 미팅',cat:'업무'}],todos:[{id:'t1',title:'견적서 회신',note:'단가표 첨부',due:'',done:false}],holdings:[
   {id:'h1',type:'kr',symbol:'005930',name:'',qty:10,avg:150000,dps:1444,divMonths:[2,5,8,11]},
   {id:'h2',type:'us',symbol:'SCHD',name:'',qty:30,avg:30,dps:1.0,divMonths:[3,6,9,12]},
   {id:'h3',type:'gold',symbol:'gold',name:'',qty:20,avg:130000,dps:0,divMonths:[]},
   {id:'h4',type:'coin',symbol:'BTC',name:'비트코인',qty:0.02,avg:90000000,dps:0,divMonths:[]}],settings:{}};
  const real=window.fetch.bind(window);
  window.fetch=async(url,opts={})=>{
    url=String(url);
    if(!url.includes('api.github.com')) return real(url,opts);
    const j=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{'Content-Type':'application/json'}});
    const file=async p=>j({content:b64(await (await real(p)).text()),sha:'x'});
    if(url.includes('/contents/data.json')){
      if(opts.method==='PUT'){data=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(JSON.parse(opts.body).content),c=>c.charCodeAt(0))));return j({});}
      return j({content:b64(JSON.stringify(data)),sha:'s'});
    }
    if(url.includes('my-data/contents/mail/')) return j({message:'Not Found'},404);
    for(const f of ['gcal','history','apt','prices']) if(url.includes(`/contents/${f}.json`)) return file(`mock-${f}.json`);
    if(url.includes('news-feed/contents/')) return file(url.split('/contents/')[1].split('?')[0]);
    if(url.includes('/dispatches')) return new Response(null,{status:204});
    return j({permissions:{push:true}});
  };
})();
</script>
"""
html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
html = re.sub(r"(app\.(?:js|css))\?v=\d+", r"\1?v=mock", html)
html = html.replace("</head>", MOCK + "</head>", 1)
open(os.path.join(OUT, "index.html"), "w", encoding="utf-8").write(html)

today = datetime.date.today()
def dump(name, obj):
    json.dump(obj, open(os.path.join(OUT, name), "w", encoding="utf-8"), ensure_ascii=False)

dump("mock-prices.json", {"updatedAt": datetime.datetime.utcnow().isoformat() + "Z", "fx": {"USD": 1400}, "prices": {
    "kr:005930": {"price": 197000, "name": "삼성전자", "changePct": 0.5},
    "us:SCHD": {"price": 28, "name": "Schwab U.S. Dividend Equity ETF", "changePct": -0.3},
    "gold:gold": {"price": 160000, "name": "국내 금 (원/g)", "changePct": 0.2},
    "coin:BTC": {"price": 84000000, "name": "BTC", "changePct": -2.0}},
    "divs": {"SCHD": [{"d": "2025-12-10", "amt": 0.278}, {"d": "2026-03-25", "amt": 0.257}, {"d": "2026-06-24", "amt": 0.253}, {"d": "2026-09-23", "amt": 0.267}]}})
dump("mock-gcal.json", {"events": [{"date": today.isoformat(), "time": "09:30", "endTime": "10:30", "title": "주간회의"}]})
v = 8_000_000; days = []
for i in range(60, -1, -1):
    v *= 1 + random.uniform(-0.015, 0.017)
    days.append({"d": (today - datetime.timedelta(days=i)).isoformat(), "value": round(v), "cost": 7_100_000, "pnl": round(v) - 7_100_000,
                 "groups": {"주식·ETF": round(v * .45), "금": round(v * .35), "코인": round(v * .2)}})
dump("mock-history.json", {"v": 1, "days": days})
deals = [{"apt": f"테스트 {random.choice([1, 2])}단지", "date": (today - datetime.timedelta(days=i * 9)).isoformat(), "area": random.choice([84.909, 84.982]),
          "price": random.randint(118, 135) * 10_000_000, "floor": random.randint(2, 25), "dong": "", "kind": "중개거래", "canceled": i == 3, "firstSeen": "init"} for i in range(20)]
dump("mock-apt.json", {"updatedAt": datetime.datetime.utcnow().isoformat() + "Z", "targets": [{"name": "테스트단지", "found": True, "minArea": 80, "maxArea": 90,
     "avg1m": {"avg": 1265000000, "n": 3, "since": (today - datetime.timedelta(days=30)).isoformat()}, "avg1mByArea": {}, "deals": deals}]})
print(f"목업 준비 완료: python3 -m http.server 8765 -d {os.path.relpath(OUT, os.getcwd())}")
