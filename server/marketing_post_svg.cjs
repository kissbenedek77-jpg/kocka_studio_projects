'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {creativeSvg}=require('../public/marketing-auto.js');

const POST_STYLES=['classic','fresh','editorial','blueprint','bold'];

const fallbackLogo='data:image/png;base64,'+fs.readFileSync(
  path.join(__dirname,'../public/kocka-icon-192.png')).toString('base64');
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const imageUrl=value=>/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(String(value||''))?value:'';
const color=(value,fallback)=>/^#[0-9a-f]{6}$/i.test(String(value||''))?value:fallback;
const font=value=>/^[\w\s-]{2,60}$/.test(String(value||''))?value:'Source Sans Pro';
const estimatedWidth=(value,size)=>[...String(value)].reduce((sum,char)=>sum+
  (/[ilI1.,:;!|]/.test(char)?.33:/[MW@]/.test(char)?.96:
    /[A-ZÁÉÍÓÖŐÚÜŰ]/.test(char)?.76:char===' '?.33:.62)*size,0);
function wrap(value,size,maxWidth){
  const result=[];let row='';
  for(let word of String(value||'').trim().split(/\s+/).filter(Boolean)){
    const candidate=row?row+' '+word:word;
    if(estimatedWidth(candidate,size)<=maxWidth){row=candidate;continue}
    if(row){result.push(row);row=''}
    while(estimatedWidth(word,size)>maxWidth){let cut=1;
      while(cut<word.length&&estimatedWidth(word.slice(0,cut+1),size)<=maxWidth)cut++;
      result.push(word.slice(0,cut));word=word.slice(cut)}
    row=word;
  }
  if(row)result.push(row);
  return result;
}

function postSvg(post,brand={},background=''){
  const style=POST_STYLES.includes(post.style)?post.style:'fresh';
  const accent=color(brand.accent,'#72c7a2');
  const headingFont=font(brand.font),bodyFont=font(brand.bodyFont);
  const title=brand.headingUppercase||style==='bold'?String(post.headline||'').toLocaleUpperCase('hu-HU'):
    String(post.headline||'');
  const preferredSize=Math.max(48,Math.min(88,Number(brand.headingSize)||76));
  let titleSize=preferredSize,rows;
  do{rows=wrap(title,titleSize,902);
    if(rows.length*titleSize*1.12<=322||titleSize<=34)break;
    titleSize-=2;
  }while(true);
  const titleXml=rows.map((row,index)=>{
    const width=Math.min(902,Math.ceil(estimatedWidth(row,titleSize)));
    return `<tspan x="84" dy="${index?Math.round(titleSize*1.12):0}" textLength="${width}" lengthAdjust="spacingAndGlyphs">${escape(row)}</tspan>`;
  }).join('');
  const heroImage=imageUrl(background);
  const logo=imageUrl(brand.logoDataUrl)||fallbackLogo;
  const logoIsCustom=Boolean(imageUrl(brand.logoDataUrl));
  const logoFilter='<filter id="logoWhite" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  -.333 -.333 -.333 0 1"/></filter>';
  const logoMark=logoIsCustom
    ?`<rect x="66" y="60" width="320" height="142" rx="22" fill="#142c29"/><image href="${logo}" x="84" y="76" width="284" height="110" preserveAspectRatio="xMidYMid meet"/>`
    :`<rect x="66" y="60" width="346" height="142" rx="22" fill="#142c29"/><image href="${logo}" x="82" y="77" width="108" height="108" preserveAspectRatio="xMidYMid meet" filter="url(#logoWhite)"/><text x="209" y="137" fill="#fff" font-family="${escape(bodyFont)},Arial,sans-serif" font-size="31" font-weight="700" letter-spacing="2">KOCKA</text><text x="210" y="168" fill="#fff" font-family="${escape(bodyFont)},Arial,sans-serif" font-size="23" letter-spacing="5">STÚDIÓ</text>`;
  if(style==='classic'){
    const original=creativeSvg({title:post.headline,subtitle:post.topic?.title||'',cta:'Kérj ajánlatot',
      brand:{background:brand.background,accent:brand.accent,font:brand.font,bodyFont:brand.bodyFont,
        headingSize:brand.headingSize,headingWeight:brand.headingWeight,
        headingUppercase:brand.headingUppercase},background:heroImage,width:1080,height:1350});
    return original.replace('</svg>',`<defs>${logoFilter}</defs>${logoMark}</svg>`);
  }
  const heroPhoto=heroImage?`<image href="${heroImage}" width="1080" height="720" preserveAspectRatio="xMidYMid slice"/>`:'';
  const base=`<defs><linearGradient id="hero" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${accent}"/><stop offset=".58" stop-color="#a8ded0"/><stop offset="1" stop-color="#f4b895"/></linearGradient><pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="#8dc9b2" opacity=".25"/></pattern>${logoFilter}</defs>`;
  let scene,panel,ink='#173b32',subInk='#426355',panelColor='#f8f5ee',button='#173b32',buttonInk='#fff',eyebrow='ÉPÍTÉSZET  /  OTTHON';
  if(style==='editorial'){
    scene=`<rect width="1080" height="720" fill="#dbc9b0"/>${heroPhoto}<rect width="1080" height="720" fill="#171f1a" opacity="${heroPhoto?'.18':'.04'}"/><path d="M710 0v720M900 0v720" stroke="#fff" stroke-width="5" opacity=".3"/>`;
    panel='<rect x="48" y="602" width="984" height="718" fill="#fffdf8"/><rect x="48" y="602" width="984" height="12" fill="#df8066"/><text x="936" y="690" text-anchor="end" font-family="Georgia,serif" font-size="72" fill="#d5d0c4">01</text>';
    panelColor='#fffdf8';button='#e58163';buttonInk='#173b32';eyebrow='KOCKA / NÉZŐPONT';
  }else if(style==='blueprint'){
    scene=`<rect width="1080" height="720" fill="#0b2d3c"/>${heroPhoto}<rect width="1080" height="720" fill="#0b2d3c" opacity="${heroPhoto?'.58':'.12'}"/><rect width="1080" height="720" fill="url(#grid)"/><path d="M505 529L785 149l250 380M622 529V341h190v188" fill="none" stroke="#a2e4d0" stroke-width="5" opacity=".48"/>`;
    panel='<rect x="48" y="602" width="984" height="718" rx="12" fill="#102f3a"/><rect x="66" y="620" width="948" height="680" fill="none" stroke="#6bcaa9" stroke-width="2" opacity=".7"/>';
    ink='#f7f8f2';subInk='#b8dfd1';panelColor='#102f3a';button=accent;buttonInk='#0b2d3c';eyebrow='TERV / TÉR / OTTHON';
  }else if(style==='bold'){
    scene=`<rect width="1080" height="720" fill="#ef805e"/>${heroPhoto}<path d="M0 320L1080 40v600L0 720Z" fill="${accent}" opacity="${heroPhoto?'.26':'.85'}"/><circle cx="872" cy="258" r="310" fill="#fff0d9" opacity=".24"/>`;
    panel='<rect x="48" y="602" width="984" height="718" rx="30" fill="#fff0dc"/><path d="M48 802l984-200v92L48 894Z" fill="#f4c6a8" opacity=".35"/>';
    panelColor='#fff0dc';button='#e46f51';buttonInk='#fff';eyebrow='OTTHON, ÚJ SZEMMEL';
  }else{
    scene=`<rect width="1080" height="720" fill="url(#hero)"/>${heroPhoto}<rect width="1080" height="720" fill="#103c32" opacity="${heroPhoto?'.14':'0'}"/><circle cx="833" cy="206" r="315" fill="#ffffff" opacity=".15"/><path d="M335 715L775 94l375 476" fill="none" stroke="#ffffff" stroke-width="7" opacity=".39"/><path d="M-44 612L393 88l492 628" fill="none" stroke="#ffffff" stroke-width="4" opacity=".26"/>`;
    panel='<rect x="48" y="602" width="984" height="718" rx="32" fill="#f8f5ee"/>';
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">${base}<rect width="1080" height="1350" fill="${panelColor}"/>${scene}${panel}${logoMark}<rect x="84" y="658" width="15" height="48" rx="7" fill="${style==='blueprint'?accent:'#ef805e'}"/><text x="116" y="692" fill="${subInk}" font-family="${escape(bodyFont)},Arial,sans-serif" font-size="26" font-weight="700" letter-spacing="4">${eyebrow}</text><text x="84" y="789" fill="${ink}" font-family="${style==='editorial'?'Georgia,serif':escape(headingFont)+',Arial,sans-serif'}" font-size="${titleSize}" font-weight="${Number(brand.headingWeight)||700}">${titleXml}</text><text x="84" y="1145" fill="${subInk}" font-family="${escape(bodyFont)},Arial,sans-serif" font-size="31">Az ötlettől a megvalósítható tervig.</text><rect x="84" y="1190" width="912" height="88" rx="14" fill="${button}"/><text x="116" y="1246" fill="${buttonInk}" font-family="${escape(bodyFont)},Arial,sans-serif" font-size="34" font-weight="700">Beszéljünk a terveidről</text><circle cx="942" cy="1234" r="24" fill="${style==='blueprint'?'#103a3c':accent}"/><path d="M933 1234h18m-8-8 8 8-8 8" fill="none" stroke="${style==='blueprint'?'#fff':'#173b32'}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><text x="84" y="1308" fill="${subInk}" font-family="${escape(bodyFont)},Arial,sans-serif" font-size="21" letter-spacing="2">KOCKASTUDIO.HU</text></svg>`;
}

module.exports={postSvg,POST_STYLES};
