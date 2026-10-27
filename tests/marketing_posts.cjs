'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const sharp=require('sharp');
const {parseFeed,validateTopic,due,nextRun,pickTopic,generatePostText,postSvg,POST_STYLES}=require('../server/marketing_posts.cjs');
const {publishFacebookPhoto,deleteFacebookPhoto}=require('../server/marketing_facebook.cjs');
const {publishInstagramImage}=require('../server/marketing_instagram.cjs');

test('Az RSS találatok csak érvényes forráslinkkel kerülnek a témák közé',()=>{
  const xml='<rss><channel><item><title>Családi ház &amp; kert</title>'+ 
    '<link>https://news.google.com/rss/articles/abc</link><source>Építészeti lap</source></item>'+ 
    '<item><title>Rossz link</title><link>https://example.test/evil</link></item></channel></rss>';
  const topics=parseFeed(xml,'Építészet');assert.equal(topics.length,1);
  assert.equal(topics[0].title,'Családi ház & kert');
  assert.throws(()=>validateTopic({title:'Teszt',url:'https://example.test/evil'}),/forráslink/);
});

test('Az ütemezés a régi témákat kihagyja, és sikertelen próbát nem ismétel azonnal',()=>{
  const now=new Date('2026-10-21T08:00:00Z');
  assert.equal(due({enabled:true,nextRunAt:'2026-10-20T08:00:00Z'},now),true);
  assert.equal(due({enabled:true,nextRunAt:'2026-10-20T08:00:00Z',
    lastAttemptAt:'2026-10-21T07:00:00Z'},now),false);
  assert.equal(nextRun(now,7),'2026-10-28T08:00:00.000Z');
  const topics=[{title:'A'},{title:'B'}];
  assert.equal(pickTopic(topics,[{topic:{title:'A'}}]).title,'B');
});

test('A bejegyzés szövege strukturált Gemini válaszból készül, a grafika PNG-vé alakítható',async()=>{
  const topic={title:'Házbővítés előtt',url:'',source:'Saját téma'};
  const post=await generatePostText({name:'Átalakítás',audience:'Családok',brief:'Építészeti tervezés'},topic,{
    apiKey:'test-key',fetchImpl:async(_url,options)=>{
      assert.match(JSON.parse(options.body).contents[0].parts[0].text,/Házbővítés előtt/);
      return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({
        headline:'Tervezz előre',body:'Beszéljük át a bővítés lehetőségeit.',
        imagePrompt:'Általános kortárs házillusztráció'})}]}}]})};
    }});
  const svg=postSvg(post,{background:'#3e3e3e',accent:'#77c59e'});
  const png=await sharp(Buffer.from(svg)).png().toBuffer();
  assert.equal((await sharp(png).metadata()).format,'png');
  assert.ok(png.length>1000);
});

test('A hosszú képfelirat a kép szélességéhez és magasságához igazodik',async()=>{
  const headline='Hogyan lehet egy régi családi házból korszerű, kényelmes és energiatakarékos otthon a meglévő értékek megőrzésével?';
  const svg=postSvg({headline,topic:{title:'Praktikus építészeti lehetőségek és szempontok a családi házak átalakításának megtervezéséhez'}},
    {headingUppercase:true,headingSize:94});
  const title=svg.match(/<text x="84" y="789"[^>]*>(.*?)<\/text>/);
  assert.ok(title);
  const rows=[...title[1].matchAll(/<tspan[^>]*textLength="(\d+)"[^>]*>(.*?)<\/tspan>/g)];
  assert.ok(rows.length>1);
  assert.equal(rows.map(row=>row[2]).join(' ').replace(/\s+/g,' '),headline.toLocaleUpperCase('hu-HU'));
  assert.ok(rows.every(row=>Number(row[1])<=902));
  const png=await sharp(Buffer.from(svg)).png().toBuffer();
  assert.deepEqual([ (await sharp(png).metadata()).width,(await sharp(png).metadata()).height ],[1080,1350]);
});

test('A bejegyzéskép a beállított logót és a generált hátteret használja',async()=>{
  const logo='data:image/png;base64,'+(await sharp({create:{width:32,height:32,channels:4,
    background:'#ef805e'}}).png().toBuffer()).toString('base64');
  const background='data:image/png;base64,'+(await sharp({create:{width:40,height:40,channels:3,
    background:'#70c39f'}}).png().toBuffer()).toString('base64');
  const svg=postSvg({headline:'Otthon, ami működik',topic:{title:'Átalakítás'}},
    {accent:'#77c59e',logoDataUrl:logo},background);
  assert.match(svg,/<image href="data:image\/png;base64,[^"]+" x="84" y="76"/);
  assert.ok(svg.includes(logo));assert.ok(svg.includes(background));
  const png=await sharp(Buffer.from(svg)).png().toBuffer();
  assert.equal((await sharp(png).metadata()).height,1350);
});

test('Mind az öt bejegyzésstílus sötét logóhátteret és érvényes PNG-t készít',async()=>{
  assert.deepEqual(POST_STYLES,['classic','fresh','editorial','blueprint','bold']);
  const previews=new Set();
  for(const style of POST_STYLES){
    const svg=postSvg({headline:'Új otthon a régi házból',topic:{title:'Átalakítás'},style},
      {accent:'#77c59e'});
    assert.match(svg,/<rect x="66" y="60" width="346" height="142" rx="22" fill="#142c29"\/>/);
    const png=await sharp(Buffer.from(svg)).resize(270,338).png().toBuffer();
    previews.add(png.toString('base64'));
  }
  assert.equal(previews.size,5);
});

test('A Facebook képes publikálás a szerkesztett szöveget és a képet küldi',async()=>{
  const image=await sharp({create:{width:50,height:50,channels:3,background:'#ffffff'}}).png().toBuffer();
  const result=await publishFacebookPhoto({image,body:'Szerkesztett szöveg',generatedWithAi:true},
    {pageId:'123456789',token:'secret-test',fetchImpl:async(url,options)=>{
      if(options.method!=='POST'){
        assert.equal(url,'https://graph.facebook.com/v26.0/me?fields=id');
        assert.equal(options.headers.Authorization,'Bearer secret-test');
        return {ok:true,json:async()=>({id:'123456789'})};
      }
      assert.equal(url,'https://graph.facebook.com/v26.0/123456789/photos');
      assert.equal(options.headers.Authorization,'Bearer secret-test');
      assert.equal(options.body.get('caption'),'Szerkesztett szöveg');
      assert.equal(options.body.get('is_gen_ai'),'true');
      assert.equal(options.body.get('provenance_type'),'EXPLICIT');
      assert.equal(options.body.get('source').type,'image/jpeg');
      return {ok:true,json:async()=>({id:'222',post_id:'123456789_222'})};
    }});
  assert.equal(result.postId,'123456789_222');
});

test('A publikált Facebook-kép törlése a megfelelő Page tokennel történik',async()=>{
  const result=await deleteFacebookPhoto({photoId:'22222'},{pageId:'123456789',token:'secret-test',
    fetchImpl:async(url,options)=>{
      if(options.method!=='DELETE'){
        assert.equal(url,'https://graph.facebook.com/v26.0/me?fields=id');
        return {ok:true,json:async()=>({id:'123456789'})};
      }
      assert.equal(url,'https://graph.facebook.com/v26.0/22222');
      assert.equal(options.headers.Authorization,'Bearer secret-test');
      return {ok:true,json:async()=>({success:true})};
    }});
  assert.deepEqual(result,{deleted:true});
});

test('Az Instagram-közzététel a kapcsolt professzionális fiókban előbb konténert, majd bejegyzést készít',async()=>{
  const calls=[];
  const result=await publishInstagramImage({imageUrl:'https://projects.kockastudio.hu/media/marketing/test',caption:'Kocka Stúdió'},
    {pageId:'123456789',token:'secret-test',fetchImpl:async(url,options)=>{
      calls.push([url,options.method||'GET']);
      if(url.endsWith('?fields=instagram_business_account{id,username}'))
        return {ok:true,json:async()=>({instagram_business_account:{id:'987654321',username:'kockastudio'}})};
      if(url.endsWith('/media')){
        assert.equal(options.body.get('image_url'),'https://projects.kockastudio.hu/media/marketing/test');
        return {ok:true,json:async()=>({id:'111111'})};
      }
      assert.equal(options.body.get('creation_id'),'111111');
      return {ok:true,json:async()=>({id:'222222'})};
    }});
  assert.deepEqual(result,{mediaId:'222222',username:'kockastudio'});
  assert.deepEqual(calls.map(call=>call[1]),['GET','POST','POST']);
});

test('A lejárt Facebook token megújítandó beállításként jelenik meg, a kérés biztosan elutasított',async()=>{
  const image=await sharp({create:{width:40,height:40,channels:3,background:'#ffffff'}}).png().toBuffer();
  await assert.rejects(publishFacebookPhoto({image,body:'Próba'},
    {pageId:'123456789',token:'expired-test',fetchImpl:async()=>({ok:false,status:401,
      json:async()=>({error:{code:190,error_subcode:463,
        message:'Error validating access token: Session has expired'}})})}),error=>{
    assert.equal(error.status,401);
    assert.equal(error.facebookRejected,true);
    assert.match(error.message,/FACEBOOK_PAGE_ACCESS_TOKEN/);
    assert.doesNotMatch(error.message,/expired-test/);
    return true;
  });
});

test('Másik oldal vagy felhasználó tokenjével a képes POST el sem indul',async()=>{
  const image=await sharp({create:{width:40,height:40,channels:3,background:'#ffffff'}}).png().toBuffer();
  let calls=0;
  await assert.rejects(publishFacebookPhoto({image,body:'Próba'},
    {pageId:'123456789',token:'user-test',fetchImpl:async()=>{
      calls++;return {ok:true,json:async()=>({id:'987654321'})};
    }}),error=>error.status===403&&error.facebookRejected&&/Page Access Token/.test(error.message));
  assert.equal(calls,1);
});

test('A publish_actions hiba a hiányzó Page-jogokra mutat, és elutasításnak számít',async()=>{
  const image=await sharp({create:{width:40,height:40,channels:3,background:'#ffffff'}}).png().toBuffer();
  await assert.rejects(publishFacebookPhoto({image,body:'Próba'},
    {pageId:'123456789',token:'page-test',fetchImpl:async(_url,options)=>
      options.method!=='POST'?{ok:true,json:async()=>({id:'123456789'})}:
        {ok:false,status:403,json:async()=>({error:{code:200,
          message:'The permission(s) publish_actions are not available. It has been deprecated.'}})}}),
  error=>error.status===403&&error.facebookRejected&&/pages_manage_posts/.test(error.message));
});

test('A pages_manage_posts 403 az alkalmazás jogosultsági beállítását jelzi',async()=>{
  const image=await sharp({create:{width:40,height:40,channels:3,background:'#ffffff'}}).png().toBuffer();
  await assert.rejects(publishFacebookPhoto({image,body:'Próba'},
    {pageId:'123456789',token:'page-test',fetchImpl:async(_url,options)=>
      options.method!=='POST'?{ok:true,json:async()=>({id:'123456789'})}:
        {ok:false,status:403,json:async()=>({error:{code:200,
          message:'The permission(s) pages_manage_posts are not available. It could because either they are deprecated or need to be approved by App Review.'}})}}),
  error=>error.status===403&&error.facebookRejected&&/App Review/.test(error.message));
});
