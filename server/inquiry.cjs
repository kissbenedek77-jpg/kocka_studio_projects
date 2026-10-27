'use strict';

const MAX_PHOTOS=6;
const MAX_PHOTO_BYTES=6*1024*1024;
const MAX_TOTAL_PHOTO_BYTES=16*1024*1024;

function field(form,name,max,{required=true,multiline=false}={}) {
  const raw=form.get(name);
  if(raw!==null&&typeof raw!=='string')
    throw Object.assign(new Error('Érvénytelen adat: '+name),{status:400});
  const value=String(raw||'').trim().replace(/\r/g,'');
  if ((required&&!value)||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)||
      (!multiline&&value.includes('\n')))
    throw Object.assign(new Error('Hiányzó vagy túl hosszú adat: '+name),{status:400});
  return value;
}

function validateInquiry(form) {
  const selectedType=field(form,'projectType',100);
  if(!['Új építés','Bővítés','Átépítés','Egyéb'].includes(selectedType))
    throw Object.assign(new Error('Válassz érvényes projekt típust.'),{status:400});
  const otherType=field(form,'projectTypeOther',100,{required:selectedType==='Egyéb'});
  const data={
    firstName:field(form,'firstName',80),lastName:field(form,'lastName',80),
    email:field(form,'email',254).toLowerCase(),phone:field(form,'phone',40),
    projectType:selectedType==='Egyéb'?'Egyéb: '+otherType:selectedType,city:field(form,'city',100),
    street:field(form,'street',120,{required:false}),houseNumber:field(form,'houseNumber',40,{required:false}),
    parcelNumber:field(form,'parcelNumber',60,{required:false}),
    description:field(form,'description',3000,{multiline:true}),
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))
    throw Object.assign(new Error('Érvénytelen e-mail-cím.'),{status:400});
  if (!/^\+?[0-9][0-9\s/()-]{6,38}$/.test(data.phone))
    throw Object.assign(new Error('Érvénytelen telefonszám.'),{status:400});
  if (!(data.street&&data.houseNumber)&&!data.parcelNumber)
    throw Object.assign(new Error('Add meg a teljes helyszíni címet vagy a helyrajzi számot.'),{status:400});
  if (form.get('privacy')!=='yes')
    throw Object.assign(new Error('Az adatkezelési tájékoztató elfogadása szükséges.'),{status:400});
  return data;
}

function photoType(bytes) {
  if (bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)
    return {mime:'image/jpeg',extension:'jpg'};
  if (bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))
    return {mime:'image/png',extension:'png'};
  if (bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')
    return {mime:'image/webp',extension:'webp'};
  if (bytes.length>=12&&bytes.toString('ascii',4,8)==='ftyp'&&
      /^(heic|heix|hevc|hevx|mif1)$/.test(bytes.toString('ascii',8,12)))
    return {mime:'image/heic',extension:'heic'};
  return null;
}

async function inquiryPhotos(form) {
  const uploads=form.getAll('photos').filter(item=>item&&typeof item.arrayBuffer==='function'&&item.size);
  if (uploads.length>MAX_PHOTOS)
    throw Object.assign(new Error('Legfeljebb 6 fotót tölthetsz fel.'),{status:400});
  if(uploads.reduce((total,item)=>total+item.size,0)>MAX_TOTAL_PHOTO_BYTES)
    throw Object.assign(new Error('A fotók összesen legfeljebb 16 MB méretűek lehetnek.'),{status:400});
  const result=[];
  for(const item of uploads){
    if(item.size>MAX_PHOTO_BYTES)
      throw Object.assign(new Error('Egy fotó legfeljebb 6 MB lehet.'),{status:400});
    const bytes=Buffer.from(await item.arrayBuffer());
    const type=photoType(bytes);
    if(!type)throw Object.assign(new Error('Csak JPEG, PNG, WebP vagy HEIC fotó tölthető fel.'),{status:400});
    result.push({bytes,...type});
  }
  return result;
}

function inquiryText(data,uid,photoCount) {
  return [
    'Ajánlatkérés',`Azonosító: ${uid}`,`Beérkezett: ${new Date().toISOString()}`,'',
    `Kapcsolattartó: ${data.lastName} ${data.firstName}`,
    `E-mail: ${data.email}`,`Telefon: ${data.phone}`,
    `Projekt típusa: ${data.projectType}`,
    `Helyszín: ${[data.city,data.street,data.houseNumber].filter(Boolean).join(' ')}`,
    `Helyrajzi szám: ${data.parcelNumber||'–'}`,`Fotók száma: ${photoCount}`,'',
    'Projektleírás:',data.description
  ].join('\n');
}

module.exports={validateInquiry,inquiryPhotos,inquiryText,photoType,
  MAX_PHOTOS,MAX_PHOTO_BYTES,MAX_TOTAL_PHOTO_BYTES};
