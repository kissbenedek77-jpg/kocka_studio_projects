(function(root){
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const xml=escape;
  const utf8Data=(mime,text)=>'data:'+mime+';base64,'+btoa(unescape(encodeURIComponent(text)));
  const textWidth=(text,size)=>[...String(text)].reduce((sum,char)=>sum+
    (/[ilI1.,:;!|]/.test(char)?.32:/[MW@]/.test(char)?.95:
      /[A-ZÁÉÍÓÖŐÚÜŰ]/.test(char)?.74:char===' '?.32:.59)*size,0);
  const lines=(text,size,maxWidth)=>{
    const words=String(text||'').trim().split(/\s+/).filter(Boolean),out=[];let row='';
    for(let word of words){const candidate=row?row+' '+word:word;
      if(textWidth(candidate,size)<=maxWidth){row=candidate;continue}
      if(row){out.push(row);row=''}
      while(textWidth(word,size)>maxWidth){let cut=1;
        while(cut<word.length&&textWidth(word.slice(0,cut+1),size)<=maxWidth)cut++;
        out.push(word.slice(0,cut));word=word.slice(cut)}
      row=word}
    if(row)out.push(row);return out;
  };
  const color=(value,fallback)=>/^#[0-9a-f]{6}$/i.test(String(value||''))?value:fallback;
  const font=value=>/^[\w\s-]{2,60}$/.test(String(value||''))?value:'Source Sans Pro';
  function creativeSvg({title,subtitle,cta,brand={},background='',fontCss='',width=1080,height=1080,index=0}){
    const dark=color(brand.primaryColor||brand.dark||brand.background,'#3e3e3e');
    const accent=color(brand.accentColor||brand.accent,'#b5d2c8');
    const family=font(brand.headingFont||brand.font);
    const preferredSize=Math.max(42,Math.min(94,Number(brand.headingSize)||(height>1500?82:height>1100?75:68)));
    const weight=[300,400,500,600,700,800,900].includes(Number(brand.headingWeight))?Number(brand.headingWeight):700;
    const start=height>1500?750:height>1100?555:395;
    const textMaxWidth=Math.max(120,width-152),titleText=brand.headingUppercase?
      String(title||'').toLocaleUpperCase('hu-HU'):String(title||'');
    let subSize=30,subLines=lines(subtitle,subSize,textMaxWidth);
    while(subLines.length>4&&subSize>20){subSize-=2;subLines=lines(subtitle,subSize,textMaxWidth)}
    const subLeading=Math.round(subSize*1.33),maxTitleLines=height>1500?6:height>1100?5:4;
    let size=preferredSize,titleLines;
    do{titleLines=lines(titleText,size,textMaxWidth);
      const lastSubtitle=start+titleLines.length*size*1.08+35+
        Math.max(0,subLines.length-1)*subLeading;
      if((titleLines.length<=maxTitleLines&&lastSubtitle<=height-185)||size<=32)break;
      size-=2}while(true);
    const fitted=line=>Math.min(textMaxWidth,Math.max(1,Math.ceil(textWidth(line,size))));
    const titleXml=titleLines.map((line,i)=>`<tspan x="76" dy="${i?size*1.08:0}" textLength="${fitted(line)}" lengthAdjust="spacingAndGlyphs">${xml(line)}</tspan>`).join('');
    const subY=start+titleLines.length*size*1.08+35;
    const subXml=subLines.map((line,i)=>`<tspan x="78" dy="${i?subLeading:0}" textLength="${Math.min(textMaxWidth,Math.max(1,Math.ceil(textWidth(line,subSize))))}" lengthAdjust="spacingAndGlyphs">${xml(line)}</tspan>`).join('');
    const bg=background&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(background)
      ?`<image href="${background}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>`:
      `<circle cx="${width-120}" cy="250" r="480" fill="${accent}" opacity=".25"/><path d="M0 ${Math.round(height*.57)} L${Math.round(width*.62)} 80 L${width} 320 L${width} ${height} Z" fill="${accent}" opacity=".15"/>`;
    const logo=/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(brand.logoDataUrl||'')
      ?`<image href="${brand.logoDataUrl}" x="76" y="38" width="190" height="110" preserveAspectRatio="xMinYMid meet"/>`:'';
    const embeddedFonts=/^[^<>]*$/.test(fontCss)?`<style>${fontCss}</style>`:'';
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${embeddedFonts}<rect width="100%" height="100%" fill="${dark}"/>${bg}${logo}<rect x="0" y="${Math.round(height*.34)}" width="${width}" height="${Math.round(height*.66)}" fill="${dark}" opacity=".91"/><rect x="76" y="${start-48}" width="95" height="6" fill="${accent}"/><text x="76" y="${start}" fill="#fff" font-family="${xml(family)},sans-serif" font-weight="${weight}" font-size="${size}">${titleXml}</text><text x="78" y="${subY}" fill="#f3f4f1" font-family="${xml(font(brand.bodyFont))},sans-serif" font-size="${subSize}">${subXml}</text><rect x="76" y="${height-161}" width="${Math.min(600,width-152)}" height="75" rx="5" fill="${accent}"/><text x="103" y="${height-111}" fill="${dark}" font-family="${xml(font(brand.bodyFont))},sans-serif" font-size="34" font-weight="700">${xml(String(cta||'Kérj ajánlatot').slice(0,27))} →</text><text x="76" y="${height-37}" fill="#fff" font-family="${xml(font(brand.bodyFont))},sans-serif" font-size="25" letter-spacing="2">KOCKA STÚDIÓ</text><text x="${width-75}" y="${height-37}" text-anchor="end" fill="#fff" font-family="sans-serif" font-size="23">${String(index+1).padStart(2,'0')}</text></svg>`;
  }
  function landingHtml(plan,brand={},url='https://projects.kockastudio.hu/ajanlatkeres',fontCss=''){
    const landing=plan.landing||{},services=Array.isArray(landing.services)?landing.services:[];
    const dark=color(brand.primaryColor||brand.dark,'#3e3e3e'),accent=color(brand.accentColor||brand.accent,'#b5d2c8');
    const href=/^https:\/\/[^"<>\s]+$/.test(url)?url:'#';
    const embeddedFonts=/^[^<>]*$/.test(fontCss)?fontCss:'';
    return `<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(landing.heroTitle||'Kocka Stúdió')}</title><style>${embeddedFonts}:root{--dark:${dark};--accent:${accent}}*{box-sizing:border-box}body{margin:0;color:var(--dark);font:18px/1.55 '${escape(font(brand.bodyFont))}',Arial,sans-serif}h1,h2{line-height:1.1;font-family:'${escape(font(brand.font))}',Arial,sans-serif}h1{font-size:clamp(38px,6vw,72px)}h2{font-size:clamp(29px,4vw,45px)}.wrap{max-width:1160px;margin:auto;padding:70px 24px}.hero{background:var(--dark);color:white;min-height:75vh;display:flex;align-items:center}.hero p{max-width:700px;font-size:24px}.button{display:inline-block;background:var(--accent);color:var(--dark);padding:15px 26px;text-decoration:none;font-weight:700;border-radius:4px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:20px}.card{border:1px solid #ddd;padding:25px}footer{background:var(--dark);color:white;padding:24px;text-align:center}@media(max-width:600px){.wrap{padding:48px 20px}}</style></head><body><main><section class="hero"><div class="wrap"><p>KOCKA STÚDIÓ</p><h1>${escape(landing.heroTitle)}</h1><p>${escape(landing.heroSubtitle)}</p><a class="button" href="${escape(href)}">${escape(landing.cta||'Kérj ajánlatot')}</a></div></section><section class="wrap"><h2>Hogyan dolgozunk?</h2><p>${escape(landing.intro)}</p></section><section class="wrap"><h2>Amiben segítünk</h2><div class="grid">${services.map(item=>`<div class="card">${escape(item)}</div>`).join('')}</div></section><section class="wrap"><h2>Referenciák</h2><p>Ide csak ellenőrzött, publikálható projektfotók és ügyfélvélemények kerüljenek.</p></section><section class="wrap"><h2>Beszéljünk a projektedről</h2><p>${escape(landing.formIntro)}</p><a class="button" href="${escape(href)}">${escape(landing.cta||'Kérj ajánlatot')}</a></section></main><footer>Kocka Stúdió · Építészeti tervezés</footer></body></html>`;
  }
  const decode=src=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('A kreatív képe nem olvasható.'));image.src=src});
  async function png(svg,width,height){const image=await decode(utf8Data('image/svg+xml',svg));const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').drawImage(image,0,0);return canvas.toDataURL('image/png')}
  async function video(frames){
    if(!frames.length||typeof MediaRecorder==='undefined')return null;
    const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1920;
    const ctx=canvas.getContext('2d'),images=await Promise.all(frames.map(src=>decode(src)));
    const mime=['video/webm;codecs=vp8','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
    if(!mime||!canvas.captureStream)return null;
    const stream=canvas.captureStream(12),chunks=[],recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:1400000});
    const done=new Promise((resolve,reject)=>{recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data)};recorder.onerror=()=>reject(Error('A videó rögzítése megszakadt.'));recorder.onstop=()=>resolve(new Blob(chunks,{type:'video/webm'}))});
    try{recorder.start();for(const image of images){const started=performance.now();while(performance.now()-started<1050){ctx.drawImage(image,0,0);await new Promise(resolve=>setTimeout(resolve,85))}}
      recorder.stop();return await done}finally{stream.getTracks().forEach(track=>track.stop())}
  }
  const blobData=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('A videó nem olvasható.'));reader.readAsDataURL(blob)});
  async function build({plan,brand,fontCss='',generateImage,save,progress,url}){
    const outcomes=[],errors=[],ads=plan.ads||[];
    const backgrounds={};
    for(const format of ['static','carousel','video']){
      const ad=ads.find(value=>value.format===format);if(!ad)continue;
      progress(`AI háttérkép készül: ${format}…`);
      try{backgrounds[format]=await generateImage(ad.visual,format==='video'?'story':'square');
        try{await save(`hatter-${format}.jpg`,'image/jpeg',backgrounds[format]);outcomes.push(`hatter-${format}.jpg`)}
        catch(error){errors.push(`${format} háttérkép mentése: ${error.message}`)}}
      catch(error){errors.push(`${format}: ${error.message}; arculati grafika kerül a helyére.`)}
    }
    async function savePair(name,props){
      const svg=creativeSvg({...props,brand,fontCss,background:backgrounds[props.format]||''});
      const width=props.width||1080,height=props.height||1080;
      await save(name+'.svg','image/svg+xml',utf8Data('image/svg+xml',svg));outcomes.push(name+'.svg');
      const raster=await png(svg,width,height);await save(name+'.png','image/png',raster);outcomes.push(name+'.png');
      return raster;
    }
    const staticAd=ads.find(value=>value.format==='static');
    if(staticAd){progress('Statikus hirdetés készül…');try{await savePair('statikus-hirdetes',{...staticAd,format:'static',subtitle:staticAd.body,width:1080,height:1350})}catch(error){errors.push('Statikus hirdetés: '+error.message)}}
    const carousel=ads.find(value=>value.format==='carousel');
    if(carousel){const steps=carousel.steps?.length?[...carousel.steps]:[carousel.headline,carousel.body,carousel.cta];
      while(steps.length<4)steps.push([carousel.headline,carousel.body,carousel.cta][steps.length%3]);
      for(const [index,step] of steps.slice(0,6).entries()){
        progress(`Carousel ${index+1}/${Math.min(steps.length,6)}…`);
        try{await savePair(`carousel-${String(index+1).padStart(2,'0')}`,{...carousel,format:'carousel',title:step,subtitle:index===steps.length-1?carousel.body:carousel.headline,width:1080,height:1080,index})}
        catch(error){errors.push(`Carousel ${index+1}: ${error.message}`)}
      }
    }
    const videoAd=ads.find(value=>value.format==='video');
    if(videoAd){const steps=videoAd.steps?.length?videoAd.steps:[videoAd.headline,videoAd.body,videoAd.cta],frames=[];
      for(const [index,step] of steps.slice(0,6).entries()){
        progress(`Videó jelenet ${index+1}/${Math.min(steps.length,6)}…`);
        try{frames.push(await savePair(`video-jelenet-${String(index+1).padStart(2,'0')}`,{...videoAd,format:'video',title:step,subtitle:videoAd.headline,width:1080,height:1920,index}))}
        catch(error){errors.push(`Videó jelenet ${index+1}: ${error.message}`)}
      }
      if(frames.length){progress('Videó összeállítása…');try{const movie=await video(frames);
        if(movie){await save('reels-video-vazlat.webm','video/webm',await blobData(movie));outcomes.push('reels-video-vazlat.webm')}
        else errors.push('A böngésző nem támogatja a WebM rögzítését; a videó jelenetei külön PNG-ként elkészültek.')}
        catch(error){errors.push('Videó: '+error.message)}}
    }
    progress('Landingoldal-vázlat mentése…');
    try{await save('landing-vazlat.html','text/html',utf8Data('text/html',landingHtml(plan,brand,url,fontCss)));outcomes.push('landing-vazlat.html')}
    catch(error){errors.push('Landingoldal: '+error.message)}
    return {outcomes,errors};
  }
  const api={build,creativeSvg,landingHtml,escape};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.KockaMarketingAuto=api;
})(typeof window!=='undefined'?window:null);
