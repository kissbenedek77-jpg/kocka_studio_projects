'use strict';

function areaCents(value) {
  const normalized = String(value || '').replace(/\s|m²|m2/gi,'').replace(',','.');
  return /^\d+(?:\.\d{1,2})?$/.test(normalized)
    ? Math.round(Number(normalized)*100) : null;
}

function areaText(cents) {return (cents/100).toFixed(2).replace('.',',');}

function parseRoomText(content,sourceName='helyiségek.txt') {
  const lines = String(content || '').replace(/^\uFEFF/,'').split(/\r?\n/);
  const rooms = [];
  let columns = null,sourceTotal = null;
  lines.forEach((line,index) => {
    const pipe = line.includes('|');
    const cells = (pipe ? line.split('|') : [line]).map(value => value.trim());
    if (cells[0] === '') cells.shift();
    if (!columns) {
      const floor = cells.findIndex(value => /helyiség szintjének neve|^szint$/i.test(value));
      const name = cells.findIndex(value => /helyiség neve|^helyiség$/i.test(value));
      const area = cells.findIndex(value => /mért terület|^terület/i.test(value));
      const number = cells.findIndex(value => /^(?:helyiség\s*)?(?:száma|sorszáma|azonosítója|jele)$/i.test(value));
      const covering = cells.findIndex(value => /^(?:padló)?burkolat(?:a)?$/i.test(value));
      if (floor>=0 && name>=0 && area>=0) columns={floor,name,area,number,covering};
      return;
    }
    const offset = pipe && /^\d+$/.test(cells[0]) ? 1 : 0;
    const floor=String(cells[columns.floor+offset] || '').trim();
    const name=String(cells[columns.name+offset] || '').trim();
    const raw=String(cells[columns.area+offset] || '').trim();
    if (floor && name && !/^-+$/.test(floor)) {
      const area=areaCents(raw);
      if (area === null) throw new Error(`Érvénytelen helyiségterület: ${sourceName}, ${index+1}. sor.`);
      const roomNumber=columns.number>=0 ? String(cells[columns.number+offset] || '').trim() : '';
      const covering=columns.covering>=0 ? String(cells[columns.covering+offset] || '').trim() : '';
      rooms.push({floor,name,area,number:roomNumber,covering});
    } else if (!floor && !name && raw) sourceTotal=areaCents(raw);
  });
  if (!columns) throw new Error('A helyiséglista oszlopai nem ismerhetők fel: '+sourceName);
  if (!rooms.length) throw new Error('A helyiséglistában nincs feldolgozható helyiség: '+sourceName);
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
