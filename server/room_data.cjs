'use strict';

function areaCents(value) {
  const normalized = String(value || '').replace(/\s|m²|m2/gi,'').replace(',','.');
  return /^\d+(?:\.\d{1,2})?$/.test(normalized)
    ? Math.round(Number(normalized)*100) : null;
}

function areaText(cents) {return (cents/100).toFixed(2).replace('.',',');}

const normalizeCell = value => String(value || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
const HEADER = {
  floor: /^(?:helyiseg )?szint(?:jenek)? neve$|^helyiseg szintje(?:nek neve)?$|^szint(?: neve|je)?$|^honszint(?: neve)?$|^emelet(?: neve)?$|^floor$/,
  name: /^(?:helyiseg )?neve$|^helyiseg$|^(?:helyiseg )?megnevezese$|^megnevezes$|^nev$|^helyiseg szama es neve$/,
  area: /mert terulet|^terulet|alapterulet|^m2/,
  number: /^(?:helyiseg )?(?:szama|sorszama|sorszam|azonositoja|azonosito|jele|jel)$/,
  covering: /^(?:padlo)?burkolat(?:a)?$/
};
function splitCells(line) {
  if (line.includes('|')) return line.split('|');
  if (line.includes(';')) return line.split(';');
  if (line.includes('\t')) return line.split('\t');
  return line.split(/\s{2,}/);
}
function leadingEmpty(cells) {
  let count = 0;
  while (count < cells.length && !cells[count]) count++;
  return count;
}
function headerHelp(sourceName,firstLine) {
  return 'A helyiséglista oszlopai nem ismerhetők fel: '+sourceName+'.'+
    ' A fejlécben szint, helyiség neve és terület oszlop szükséges. Elfogadott fejlécnevek: '+
    '„Helyiség szintjének neve”, „Szint” vagy „Honszint neve”, „Helyiség neve” vagy „Megnevezés”, '+
    '„Mért terület” vagy „Terület”. A fájl |, ; vagy tabulátor elválasztású legyen.'+
    (firstLine?' Első sor: „'+firstLine+'”.':'');
}

function parseRoomText(content,sourceName='helyiségek.txt') {
  const lines = String(content || '').replace(/^\uFEFF/,'').split(/\r?\n/);
  const rooms = [];
  let columns = null,sourceTotal = null,firstLine = '',fallbackLine = '',currentFloor = '';
  let headerLeading = 0;
  lines.forEach((line,index) => {
    let cells = splitCells(line).map(value => value.trim());
    if (!cells.some(Boolean)) return;
    if (!columns) {
      // A fejléc előtti cím- vagy üres sorok kimaradnak; a vezető üres cellák
      // számát a fejléchez igazítjuk, hogy a sorok oszlopai egy vonalban legyenek.
      headerLeading = leadingEmpty(cells);
      const aligned = cells.slice(headerLeading);
      if (!fallbackLine) fallbackLine = line.trim().slice(0,160);
      if (!firstLine && aligned.filter(Boolean).length >= 2)
        firstLine = line.trim().slice(0,160);
      const normalized = aligned.map(normalizeCell);
      const floor = normalized.findIndex(value => HEADER.floor.test(value));
      const name = normalized.findIndex(value => HEADER.name.test(value));
      const area = normalized.findIndex(value => HEADER.area.test(value));
      const number = normalized.findIndex(value => HEADER.number.test(value));
      const covering = normalized.findIndex(value => HEADER.covering.test(value));
      if (name>=0 && area>=0) {
        columns={floor,name,area,number,covering,
          maxIndex:Math.max(...[floor,name,area,number,covering].filter(item => item>=0))};
      }
      return;
    }
    const strip = Math.min(headerLeading,leadingEmpty(cells));
    if (strip) cells = cells.slice(strip);
    const offset = /^\d+$/.test(cells[0]) && cells.length > columns.maxIndex+1 ? 1 : 0;
    const floor=String(cells[columns.floor+offset] ?? '').trim();
    const name=String(cells[columns.name+offset] ?? '').trim();
    const raw=String(cells[columns.area+offset] ?? '').trim();
    const normalizedName = normalizeCell(name);
    if (normalizedName === 'terasz nelkul' || /osszesen$/.test(normalizedName)) return;
    const meaningful = cells.filter(Boolean).length;
    // Szintfej: a sorban csak a szint neve szerepel (pl. „Földszint”). Ha van
    // szint-oszlop, ott kell lennie a névnek; ha nincs, a sor egyetlen cellája.
    const level = columns.floor >= 0 ? floor : (meaningful === 1 ? name : '');
    if (!raw && level && (columns.floor >= 0 ? !name : meaningful === 1)) {
      if (!/osszesen$/.test(normalizeCell(level)) && !String(level).startsWith('['))
        currentFloor = String(level).trim();
      return;
    }
    if (!name) {
      if (raw) sourceTotal=areaCents(raw);
      return;
    }
    if (!/^-+$/.test(name) && !/^-+$/.test(floor)) {
      const area=areaCents(raw);
      if (area === null) throw new Error('Érvénytelen helyiségterület: '+sourceName+', '+
        (index+1)+'. sor („'+line.trim().slice(0,120)+'”). A terület oszlopban csak szám '+
        'szerepelhet, például 12,50 vagy 12.50, esetleg m² egységgel.');
      const roomNumber=columns.number>=0 ? String(cells[columns.number+offset] ?? '').trim() : '';
      const covering=columns.covering>=0 ? String(cells[columns.covering+offset] ?? '').trim() : '';
      rooms.push({floor:floor||currentFloor||'Helyiségek',name,area,number:roomNumber,covering});
    }
  });
  if (!columns) throw new Error(headerHelp(sourceName,firstLine||fallbackLine));
  if (!rooms.length) throw new Error('A helyiséglistában nincs feldolgozható helyiség: '+sourceName+
    '. A fejléc után minden sorban szerepeljen a helyiség neve és a területe.'+
    (firstLine||fallbackLine?' Első sor: „'+(firstLine||fallbackLine)+'”.':''));
  const floors = new Map();
  let total=0,external=0;
  for (const room of rooms) {
    if (!floors.has(room.floor)) floors.set(room.floor,{rooms:[],total:0});
    floors.get(room.floor).rooms.push(room);
    floors.get(room.floor).total+=room.area;
    total+=room.area;
    if (/terasz/i.test(room.name)) external+=room.area;
  }
  const output=[];
  const hasNumber=columns.number>=0,hasCovering=columns.covering>=0;
  const title=hasNumber?'Helyiség száma és neve':'Helyiség';
  const tableRows=[[title,'Terület (m²)']];
  for (const [floor,group] of floors) {
    output.push(floor);
    tableRows.push([floor,'']);
    for (const room of group.rooms) {
      const label=[room.number,room.name].filter(Boolean).join(' ');
      const finish=hasCovering && room.covering ? `; burkolat: ${room.covering}` : '';
      output.push(`${label}\t${areaText(room.area)} m²${finish}`);
      tableRows.push([label,areaText(room.area)]);
    }
    output.push(`${floor} összesen\t${areaText(group.total)} m²`);
    tableRows.push([floor+' összesen',areaText(group.total)]);
  }
  output.push(`Teljes összesen\t${areaText(total)} m²`);
  tableRows.push(['Teljes összesen',areaText(total)]);
  if (external) {
    output.push(`Terasz nélkül\t${areaText(total-external)} m²`);
    tableRows.push(['Terasz nélkül',areaText(total-external)]);
  }
  if (sourceTotal !== null && sourceTotal !== total)
    output.push(`[ELLENŐRIZENDŐ: a helyiségsorok összege ${areaText(total)} m², `+
      `a forrásban megadott összesen ${areaText(sourceTotal)} m².]`);
  return {rooms,totalCents:total,sourceTotal,listing:output.join('\n'),tableRows};
}

module.exports={areaCents,areaText,parseRoomText};
