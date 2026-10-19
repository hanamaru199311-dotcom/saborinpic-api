const HEADERS = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'https://saborinpic.pages.dev','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
function reply(value,status=200){return new Response(JSON.stringify(value),{status,headers:HEADERS});}
function fail(msg,status=400){return reply({error:msg},status)}
function cleanVisitor(s){return typeof s==='string' && /^[a-z0-9-]{20,70}$/i.test(s)?s:null}
function regionFromCoords(lat,lon){
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<24||lat>46||lon<122||lon>154)return '地域未設定';
 // 位置情報の厳密な緯度経度は保存せず、約8〜12kmの粗い区画だけを記録。
 return `区域 ${Math.floor(lat*10)/10}°N / ${Math.floor(lon*10)/10}°E`;
}
async function readBody(req){try{return await req.json()}catch{return {}}}
export default {async fetch(req,env){
 const u=new URL(req.url),path=u.pathname;
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:HEADERS});
 if(!path.startsWith('/api/'))return reply({service:'SABORINPIC API',status:'ready'});
 if(!env.DB)return fail('データベース未設定',503);
 try{
  if(path==='/api/status'&&req.method==='GET'){
   const now=Date.now();
   const all=await env.DB.prepare('SELECT COUNT(*) n FROM entries WHERE expires_at > ?').bind(now).first();
   const ranked=await env.DB.prepare('SELECT region, COUNT(*) n FROM entries WHERE expires_at > ? AND region != ? GROUP BY region HAVING COUNT(*) >= 5 ORDER BY n DESC LIMIT 40').bind(now,'地域未設定').all();
   // 小人数地域は特定につながるためランク非表示。全体の人数は合計表示する。
   const msgs=await env.DB.prepare('SELECT m.id,m.body,m.created_at,COUNT(r.visitor) likes FROM messages m LEFT JOIN reactions r ON r.message_id=m.id GROUP BY m.id ORDER BY m.id DESC LIMIT 40').all();
   return reply({active:Number(all?.n||0),regions:ranked.results||[],posts:(msgs.results||[]).map(x=>({id:x.id,text:x.body,created:x.created_at,likes:x.likes})),updated:now});
  }
  if(path==='/api/join'&&req.method==='POST'){
   const b=await readBody(req),visitor=cleanVisitor(b.visitor);if(!visitor)return fail('セッションIDが無効です');
   const lat=Number(b.lat),lon=Number(b.lon);const region=b.located===true?regionFromCoords(lat,lon):'地域未設定';
   const now=Date.now();const prev=await env.DB.prepare('SELECT expires_at,region FROM entries WHERE visitor=?').bind(visitor).first();
   if(prev && prev.expires_at>now && b.extend!==true)return reply({ok:true,expires:prev.expires_at});
   const expires=now+10*60*1000;
   await env.DB.prepare('INSERT INTO entries(visitor,region,expires_at,last_join) VALUES (?,?,?,?) ON CONFLICT(visitor) DO UPDATE SET region=excluded.region, expires_at=excluded.expires_at, last_join=excluded.last_join').bind(visitor,region==='地域未設定'&&prev?.region&&prev.expires_at>now?prev.region:region,expires,now).run();
   return reply({ok:true,expires});
  }
  if(path==='/api/post'&&req.method==='POST'){
   const b=await readBody(req),visitor=cleanVisitor(b.visitor);if(!visitor)return fail('セッションIDが無効です');
   const body=typeof b.text==='string'?b.text.trim():'';if(!body||[...body].length>140)return fail('投稿は1〜140文字で入力してください');
   if(/https?:\/\/|(?:[\w.-]+)@[\w.-]+|(?:0\d{1,4}[-ー]?\d{1,4}[-ー]?\d{3,4})/.test(body))return fail('URL・連絡先を含む投稿はできません');
   const now=Date.now();const recent=await env.DB.prepare('SELECT created_at FROM messages WHERE visitor=? ORDER BY id DESC LIMIT 1').bind(visitor).first();
   if(recent && now-recent.created_at<30000)return fail('連続投稿は30秒あけてください',429);
   await env.DB.prepare('INSERT INTO messages(visitor,body,created_at) VALUES(?,?,?)').bind(visitor,body,now).run();
   return reply({ok:true});
  }
  if(path==='/api/react'&&req.method==='POST'){
   const b=await readBody(req),visitor=cleanVisitor(b.visitor),id=Number(b.id);
   if(!visitor||!Number.isInteger(id)||id<1)return fail('無効な操作です');
   const found=await env.DB.prepare('SELECT id FROM messages WHERE id=?').bind(id).first();if(!found)return fail('投稿が見つかりません',404);
   await env.DB.prepare('INSERT OR IGNORE INTO reactions(message_id,visitor) VALUES (?,?)').bind(id,visitor).run();return reply({ok:true});
  }
  return fail('見つかりません',404);
 }catch(err){console.error('API error',err);return fail('サーバーに接続できません',503)}
}};

