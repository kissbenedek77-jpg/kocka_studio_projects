'use strict';
const domain = require('./domain.cjs');

// MARK: Google Docs API segédek
function paragraphText(paragraph) {
  return (paragraph?.elements || []).map(element => element.textRun?.content || '').join('');
}

function elementText(element) {
  if (!element) return '';
  if (element.paragraph) return paragraphText(element.paragraph);
  if (element.table) {
    return element.table.tableRows.map(row =>
      row.tableCells.map(cell => cell.content.map(elementText).join('')).join('\t')).join('\n');
  }
  if (element.content) return element.content.map(elementText).join('');
  return '';
}

function bodyElements(doc) {
  return (doc.body?.content || []).filter(element => !element.sectionBreak);
}

function paragraphsOf(doc) {
  return bodyElements(doc).map((element, index) => {
    if (element.paragraph) {
      return {element, index, startIndex: element.startIndex, endIndex: element.endIndex,
        text: paragraphText(element.paragraph), paragraph: element.paragraph};
    }
    if (element.table) {
      return {element, index, startIndex: element.startIndex, endIndex: element.endIndex, text: elementText(element), table: element.table};
    }
    return {element, index, startIndex: element.startIndex, endIndex: element.endIndex, text: ''};
  });
}

function findParagraph(doc, predicate) {
  return paragraphsOf(doc).find(item => predicate(item.text, item));
}

function findTextRange(doc, needle, fromIndex = 0) {
  for (const paragraph of doc.body.content || []) {
    if (!paragraph.paragraph) continue;
    for (const run of paragraph.paragraph.elements || []) {
      const content = run.textRun?.content || '';
      const offset = content.indexOf(needle);
      if (offset < 0) continue;
      const startIndex = run.startIndex + offset;
      if (startIndex < fromIndex) continue;
      return {startIndex, endIndex: startIndex + needle.length};
    }
  }
  return null;
}

function styleMask(style = {}) {
  return Object.keys(style).filter(key =>
    ['bold', 'italic', 'underline', 'strikethrough', 'smallCaps', 'baselineOffset',
      'fontSize', 'foregroundColor', 'backgroundColor', 'link'].includes(key)).join(',');
}

function paragraphStyleMask() {
  return 'namedStyleType,alignment,lineSpacing,spaceAbove,spaceBelow,indentFirstLine,indentStart,indentEnd,direction,keepLinesTogether,keepWithNext';
}

function textStyleRequests(paragraph, targetStart, sourceStart = null) {
  const requests = [];
  let offset = 0;
  (paragraph.elements || []).forEach(run => {
    const content = run.textRun?.content || '';
    if (!content) return;
    const style = run.textRun?.textStyle || {};
    const mask = styleMask(style);
    const start = targetStart + offset;
    const end = start + content.length;
    if (mask) {
      requests.push({updateTextStyle: {range: {startIndex: start, endIndex: end}, textStyle: style, fields: mask}});
    }
    offset += content.length;
  });
  return requests;
}

function paragraphStyleRequest(paragraph, targetStart, targetEnd, sourceParagraph) {
  const style = sourceParagraph?.paragraphStyle || {};
  return {updateParagraphStyle: {
    range: {startIndex: targetStart, endIndex: targetEnd},
    paragraphStyle: style, fields: paragraphStyleMask()
  }};
}

async function applyEdits(google, docId, edits) {
  const requests = [];
  edits.sort((a, b) => b.startIndex - a.startIndex).forEach(edit => {
    const length = String(edit.text || '').length;
    if (edit.endIndex > edit.startIndex) {
      requests.push({deleteContentRange: {range: {startIndex: edit.startIndex, endIndex: edit.endIndex}}});
    }
    if (length) {
      requests.push({insertText: {location: {index: edit.startIndex}, text: String(edit.text)}});
    }
    if (edit.textStyleMask) {
      requests.push({updateTextStyle: {
        range: {startIndex: edit.startIndex, endIndex: edit.startIndex + length},
        textStyle: edit.textStyle, fields: edit.textStyleMask
      }});
    }
    if (edit.paragraphStyle) {
      requests.push({updateParagraphStyle: {
        range: {startIndex: edit.startIndex, endIndex: edit.startIndex + length},
        paragraphStyle: edit.paragraphStyle, fields: paragraphStyleMask()
      }});
    }
  });
  await google.batchUpdateDoc(docId, requests);
}

function replaceParagraphText(google, docId, item, text, style = {}) {
  const length = Math.max(0, item.endIndex - item.startIndex - 1);
  return applyEdits(google, docId, [{
    startIndex: item.startIndex, endIndex: item.startIndex + length,
    text, textStyle: style.textStyle, textStyleMask: style.textStyleMask,
    paragraphStyle: style.paragraphStyle
  }]);
}

function replaceCellText(google, docId, cell, text, style = {}) {
  const paragraph = cell.content?.[0]?.paragraph;
  if (!paragraph) return null;
  const current = paragraphText(paragraph);
  const start = paragraph.startIndex;
  const end = start + Math.max(0, current.length - 1);
  return applyEdits(google, docId, [{
    startIndex: start, endIndex: end, text, textStyle: style.textStyle,
    textStyleMask: style.textStyleMask, paragraphStyle: style.paragraphStyle
  }]);
}

// MARK: Feltételes blokkok
function findConditionalBlocks(doc) {
  const blocks = [];
  let open = null;
  bodyElements(doc).forEach((element, index) => {
    const text = element.paragraph ? paragraphText(element.paragraph) : '';
    const marker = domain.parseConditionalMarker(text);
    if (!marker) return;
    if (marker.type === 'start') {
      if (open) throw new Error('Egymásba ágyazott {{#IF}} blokkok nem támogatottak.');
      open = {index, marker, element};
    } else {
      if (!open) throw new Error('Találtam {{/IF}} jelet nyitó {{#IF ...}} nélkül.');
      blocks.push({start: open.index, end: index, startElement: open.element, endElement: element, marker: open.marker});
      open = null;
    }
  });
  if (open) throw new Error('Nincs lezárva ez a feltételes blokk: ' + open.marker.field);
  return blocks;
}

function markerRequests(element) {
  if (!element.paragraph) return [];
  const textLength = Math.max(0, element.endIndex - element.startIndex - 1);
  if (!textLength) return [];
  return [
    {updateTextStyle: {
      range: {startIndex: element.startIndex, endIndex: element.startIndex + textLength},
      textStyle: {foregroundColor: {color: {rgbColor: {red: 1, green: 1, blue: 1}}}, fontSize: {magnitude: 1, unit: 'PT'}},
      fields: 'foregroundColor,fontSize'
    }},
    {updateParagraphStyle: {
      range: {startIndex: element.startIndex, endIndex: element.endIndex},
      paragraphStyle: {spaceAbove: {magnitude: 0, unit: 'PT'}, spaceBelow: {magnitude: 0, unit: 'PT'}, lineSpacing: 100},
      fields: 'spaceAbove,spaceBelow,lineSpacing'
    }}
  ];
}

async function insertTable(google, docId, index, rows) {
  const columns = Math.max(1, ...rows.map(row => row.length));
  await google.batchUpdateDoc(docId, [{insertTable: {rows: Math.max(1, rows.length), columns, location: {index}}}]);
  const doc = await google.getDoc(docId);
  const table = bodyElements(doc).find(element => element.table && element.startIndex >= index && element.startIndex <= index + 2);
  if (!table) throw new Error('A beszúrt táblázat nem található.');
  const edits = [];
  table.table.tableRows.forEach((row, rowIndex) => {
    row.tableCells.forEach((cell, columnIndex) => {
      const value = rows[rowIndex]?.[columnIndex];
      if (value === undefined || value === '') return;
      const paragraph = cell.content?.[0]?.paragraph;
      if (!paragraph) return;
      edits.push({startIndex: paragraph.startIndex, endIndex: paragraph.startIndex, text: String(value)});
    });
  });
  await applyEdits(google, docId, edits);
  const filled = await google.getDoc(docId);
  return bodyElements(filled).find(element => element.table && element.startIndex === table.startIndex) ||
    bodyElements(filled).find(element => element.table && element.startIndex >= index);
}

async function restoreBlock(google, docId, index, sourceDoc, sourceBlock) {
  const sourceElements = bodyElements(sourceDoc).slice(sourceBlock.start + 1, sourceBlock.end);
  let cursor = index;
  for (const element of sourceElements) {
    if (element.paragraph) {
      const text = paragraphText(element.paragraph);
      if (text) {
        await google.batchUpdateDoc(docId, [{insertText: {location: {index: cursor}, text}}]);
        const styleRequests = textStyleRequests(element.paragraph, cursor);
        if (element.paragraph.paragraphStyle) {
          styleRequests.push(paragraphStyleRequest(element.paragraph, cursor, cursor + text.length, element.paragraph));
        }
        if (element.paragraph.bullet) {
          styleRequests.push({createParagraphBullets: {
            range: {startIndex: cursor, endIndex: cursor + text.length},
            bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE'
          }});
        }
        await google.batchUpdateDoc(docId, styleRequests);
        cursor += text.length;
      }
    } else if (element.table) {
      const rows = element.table.tableRows.map(row =>
        row.tableCells.map(cell => cell.content.map(elementText).join('').replace(/\n$/, '')));
      const table = await insertTable(google, docId, cursor, rows);
      cursor = table ? table.endIndex : cursor;
    } else if (element.pageBreak) {
      await google.batchUpdateDoc(docId, [{insertPageBreak: {location: {index: cursor}}}]);
      cursor += 1;
    }
  }
}

async function applyConditionalBlocks(google, docId, templateId, values) {
  if (!templateId) return;
  const doc = await google.getDoc(docId);
  const templateDoc = await google.getDoc(templateId);
  const sourceBlocks = findConditionalBlocks(templateDoc);
  if (!sourceBlocks.length) return;
  const targetBlocks = findConditionalBlocks(doc);
  if (targetBlocks.length !== sourceBlocks.length)
    throw new Error('A feltételes blokkok száma eltér a sablon és a generált dokumentum között.');
  for (let index = targetBlocks.length - 1; index >= 0; index--) {
    const target = targetBlocks[index];
    const source = sourceBlocks[index];
    if (target.marker.field !== source.marker.field || target.marker.operator !== source.marker.operator ||
        target.marker.expected !== source.marker.expected)
      throw new Error('A feltételes blokk jelölése eltér a sablontól: ' + target.marker.field);
    const requests = [...markerRequests(target.startElement), ...markerRequests(target.endElement)];
    const contentStart = target.startElement.endIndex;
    const contentEnd = target.endElement.startIndex;
    if (contentEnd > contentStart) {
      requests.push({deleteContentRange: {range: {startIndex: contentStart, endIndex: contentEnd}}});
    }
    await google.batchUpdateDoc(docId, requests);
    if (domain.conditionalMatches(target.marker, values)) {
      if (contentEnd - contentStart <= 0) {
        await restoreBlock(google, docId, contentStart, templateDoc, source);
      }
    }
  }
}

async function replaceMergeFields(google, docId, values) {
  const requests = Object.keys(values).map(key => ({
    replaceAllText: {
      containsText: {text: '{{' + key + '}}', matchCase: true},
      replaceText: String(values[key] == null ? '' : values[key])
    }
  }));
  await google.batchUpdateDoc(docId, requests);
}

async function fillDocument(google, store, docId, templateId, data, additionalValues = {}) {
  const position = await store.project(data.uid);
  const extras = await store.getAdditionalMergeFields(data.uid, position.rowNumber);
  const values = Object.assign({}, domain.getDocumentReplacements(data, extras), additionalValues || {});
  await applyConditionalBlocks(google, docId, templateId, values);
  await replaceMergeFields(google, docId, values);
  return values;
}

// MARK: Tervjegyzék, helyiséglista, műszaki leírás
async function refreshTechnicalPlanList(google, docId, entries) {
  let doc = await google.getDoc(docId);
  const heading = findParagraph(doc, text => text.trim() === 'Építészeti tervrajzok');
  if (!heading) throw new Error('A műszaki leírásban nincs „Építészeti tervrajzok” szakasz.');
  const items = paragraphsOf(doc);
  const start = items.findIndex(item => item.index === heading.index);
  const consumed = [];
  for (let index = start + 1; index < items.length; index++) {
    if (!items[index].paragraph || !domain.isProjectPlanLine(items[index].text)) break;
    consumed.push(items[index]);
  }
  const lines = entries.length
    ? entries.map(entry => entry.title + '\t' + (entry.scale || 'méretarány ellenőrizendő'))
    : ['Nincs PDF tervlap a PDFA mappában.'];
  if (consumed.map(item => item.text.replace(/\n$/, '')).join('\n') === lines.join('\n')) return entries.length;
  const insertAt = consumed.length ? consumed[0].startIndex : heading.endIndex;
  const endIndex = consumed.length ? consumed[consumed.length - 1].endIndex : insertAt;
  const text = lines.join('\n') + '\n';
  const style = {fontFamily: 'Arial Narrow', fontSize: 10, foregroundColor: '#1456BA'};
  await applyEdits(google, docId, [{
    startIndex: insertAt, endIndex,
    text, textStyle: style, textStyleMask: 'fontFamily,fontSize,foregroundColor'
  }]);
  return entries.length;
}

async function refreshTechnicalProgram(google, docId, spreadsheet, data, store) {
  const {getTechnicalSheetReplacements, getTechnicalProgramLines} = require('./project-sheet.cjs');
  const replacements = Object.assign({},
    domain.getDocumentReplacements(data, await store.getAdditionalMergeFields(data.uid, (await store.project(data.uid)).rowNumber)),
    await getTechnicalSheetReplacements(google, spreadsheet.id));
  const points = await getTechnicalProgramLines(google, spreadsheet.id, replacements);
  const doc = await google.getDoc(docId);
  const items = paragraphsOf(doc);
  const start = items.find(item => item.paragraph && /^Tervezési program\s*\(266\/2013\./.test(item.text.trim()));
  const end = items.find(item => item.paragraph && /^Zöldterület számítása$/.test(item.text.trim()));
  if (!start || !end || end.startIndex <= start.endIndex)
    throw new Error('A műszaki leírás tervezési programjának határai nem találhatók.');
  const text = points.map(lines => lines.join('\n')).join('\n\n') + '\n\n';
  await applyEdits(google, docId, [{
    startIndex: start.endIndex, endIndex: end.startIndex, text,
    textStyle: {fontFamily: 'Arial Narrow', fontSize: 10, foregroundColor: '#1456BA'},
    textStyleMask: 'fontFamily,fontSize,foregroundColor'
  }]);
}

async function refreshTechnicalGrossCoverage(google, docId, spreadsheet) {
  const values = await google.valuesIn(spreadsheet.id, "'Munkalap1'!H2:J2");
  const area = String((values[0] || [])[0] || '').trim();
  const percent = String((values[0] || [])[2] || '').trim();
  if (!/^\d+(?:[,.]\d+)?$/.test(area) || !/^\d+(?:[,.]\d+)?%$/.test(percent))
    throw new Error('A tervezési adatlap H2/J2 bruttó beépítési adatai hiányoznak vagy hibásak.');
  const label = 'Bruttó beépítési százalék földszinten:';
  const doc = await google.getDoc(docId);
  const paragraph = findParagraph(doc, text => text.trimStart().indexOf(label) === 0);
  if (paragraph) {
    const content = paragraph.text;
    const start = content.indexOf(label) + label.length;
    const tabs = /^\s*/.exec(content.slice(start))[0];
    await replaceParagraphText(google, docId, paragraph, label + tabs + percent + ' (' + area + ' m²)');
  }
  const tableRow = findTableRow(doc, row => row.tableCells[0] && elementText(row.tableCells[0]).trim() === 'Beépítési százalék:');
  if (tableRow) await replaceCellText(google, docId, tableRow.row.tableCells[tableRow.row.tableCells.length - 1], percent);
}

function findTableRow(doc, predicate) {
  for (const element of bodyElements(doc)) {
    if (!element.table) continue;
    for (const row of element.table.tableRows) {
      if (predicate(row)) return {element, row};
    }
  }
  return null;
}

function layerSections(doc) {
  const sections = {};
  let inLayers = false;
  let current = '';
  for (const item of paragraphsOf(doc)) {
    if (!item.paragraph) continue;
    const line = item.text.trim();
    if (/^Rétegrendek\s*:/i.test(line)) {inLayers = true; continue;}
    if (!inLayers) continue;
    const heading = /^([FPTK]\d+[a-z]?)\s+\S/i.exec(line);
    if (heading) {
      current = heading[1].toUpperCase();
      sections[current] = [];
    } else if (current && line) {
      sections[current].push(line.replace(/\s+/g, ' '));
    } else if (!current && line) {
      break;
    }
  }
  return sections;
}

function layerStructure(sections, codes, pattern) {
  const matches = [];
  codes.forEach(code => {
    const line = (sections[code] || []).filter(item => pattern.test(item))[0];
    if (line) matches.push({code, value: line});
  });
  return matches;
}

function uniqueStructures(items) {
  return items.filter((item, index) =>
    items.findIndex(other => other.value === item.value) === index)
    .map(item => item.value.replace(/\s+tartószerkezeti terv szerint.*$/i, '') + ' (' + item.code + ')')
    .join('; ');
}

function fireStructureRow(content) {
  const match = /^\s*(?:[·•]\s*)?(teherhordó falak|födémek|fedélszerkezet)\s+min\.\s+D(?:\s+REI\s+\d+)?\s+(.+?)\s+(megfelel|ellenőrizendő)\s*$/i.exec(content);
  return match ? {key: match[1].toLowerCase(), material: match[2].trim(), status: match[3]} : null;
}

async function refreshFireProtection(google, docId, fireAreaCents, previousTotalCents, previousFireAreaCents) {
  const doc = await google.getDoc(docId);
  const sections = layerSections(doc);
  const walls = layerStructure(sections, ['F1', 'F2', 'F2F', 'F3'],
    /(?:Porotherm|vázkerámia|kerámia falazó|téglafal|vasbeton fal)/i);
  const floors = layerStructure(sections, ['P2', 'T1', 'T2', 'T3'],
    /(?:vasbeton|Porotherm|fa(?:\s+gerendás)?)\b.*födém/i).map(item => {
      const protective = (sections[item.code] || []).filter(line =>
        /(?:tűzgátló.*(?:gk|gipszkarton)|(?:gk|gipszkarton).*tűzgátló)/i.test(line))[0];
      return protective ? {code: item.code, value: item.value + '; ' + protective} : item;
    });
  const roof = layerStructure(sections, ['T4'], /(?:szaruzat|fa tetőszerkezet|fedélszék)/i);
  const structures = {
    'teherhordó falak': uniqueStructures(walls),
    'födémek': uniqueStructures(floors),
    'fedélszerkezet': uniqueStructures(roof)
  };
  const area = domain.formatRoomArea(fireAreaCents) + ' m²';
  const edits = [];
  paragraphsOf(doc).forEach(item => {
    if (!item.paragraph) return;
    const content = item.text.replace(/\n$/, '');
    if (/^A mértékadó tűzszakasz nagysága:/.test(content)) {
      const oldArea = /(?:\{\{TERVEZESI_ADATOK:Munkalap1!H7\}\}|\d+(?:[,.]\d+)?)\s*m[²2]/.exec(content);
      if (oldArea && (oldArea[0].indexOf('{{') === 0 || oldArea[0] === '251,55 m2' ||
          domain.parseRoomAreaCents(oldArea[0]) === previousTotalCents ||
          domain.parseRoomAreaCents(oldArea[0]) === previousFireAreaCents)) {
        const start = item.startIndex + oldArea.index;
        edits.push({startIndex: start, endIndex: start + oldArea[0].length, text: area});
      }
      return;
    }
    const row = fireStructureRow(content);
    if (!row || !structures[row.key]) return;
    const materialIndex = content.indexOf(row.material);
    if (materialIndex >= 0) {
      edits.push({startIndex: item.startIndex + materialIndex,
        endIndex: item.startIndex + materialIndex + row.material.length, text: structures[row.key]});
    }
    if (row.status.toLowerCase() === 'megfelel') {
      const statusIndex = content.lastIndexOf(row.status);
      if (statusIndex >= 0) edits.push({startIndex: item.startIndex + statusIndex,
        endIndex: item.startIndex + statusIndex + row.status.length, text: 'ellenőrizendő'});
    }
  });
  await applyEdits(google, docId, edits);
}

async function refreshRoomTotals(google, docId, totalCents, fireAreaCents, previousTotalCents, previousFireAreaCents) {
  const doc = await google.getDoc(docId);
  const edits = [];
  const totalLabel = 'Lakószintek összes nettó alapterülete összesen:';
  paragraphsOf(doc).forEach(item => {
    if (!item.paragraph) return;
    const content = item.text.replace(/\n$/, '');
    if (content.trimStart().indexOf(totalLabel) === 0) {
      const marker = '{{TERVEZESI_ADATOK:Munkalap1!H7}}';
      const index = content.indexOf(marker) >= 0 ? content.indexOf(marker) : /(\d+(?:[,.]\d+)?)\s*m[²2]/.exec(content)?.index;
      if (index !== undefined && index >= 0) {
        const match = /\d+(?:[,.]\d+)?\s*m[²2]|m[²2]/.exec(content.slice(index));
        const length = match ? match[0].length : marker.length;
        edits.push({startIndex: item.startIndex + index, endIndex: item.startIndex + index + length,
          text: domain.formatRoomArea(totalCents) + ' m²'});
      }
    }
  });
  // Az építmény összes szintterülete sor utolsó cellája.
  const areaRow = findTableRow(doc, row => elementText(row.tableCells[0]).trim() === 'Az építmény összes szintterülete:');
  if (areaRow) {
    const cell = areaRow.row.tableCells[areaRow.row.tableCells.length - 1];
    const paragraph = cell.content?.[0]?.paragraph;
    if (paragraph) {
      const current = paragraphText(paragraph);
      edits.push({startIndex: paragraph.startIndex,
        endIndex: paragraph.startIndex + Math.max(0, current.length - 1),
        text: domain.formatRoomArea(totalCents)});
    }
  }
  // Építményérték táblázat.
  const building = buildingValueRow(doc);
  if (building) {
    const values = domain.buildingValueCells(totalCents);
    [2, 3, 4].forEach((column, index) => {
      const cell = building.first.tableCells[column];
      const paragraph = cell?.content?.[0]?.paragraph;
      if (!paragraph) return;
      const current = paragraphText(paragraph);
      edits.push({startIndex: paragraph.startIndex,
        endIndex: paragraph.startIndex + Math.max(0, current.length - 1), text: values[index]});
    });
    const lastCell = building.last.tableCells[building.last.tableCells.length - 1];
    const paragraph = lastCell?.content?.[0]?.paragraph;
    if (paragraph) {
      const current = paragraphText(paragraph);
      edits.push({startIndex: paragraph.startIndex,
        endIndex: paragraph.startIndex + Math.max(0, current.length - 1), text: values[3]});
    }
  }
  await applyEdits(google, docId, edits);
  await refreshFireProtection(google, docId, fireAreaCents, previousTotalCents, previousFireAreaCents);
}

function buildingValueRow(doc) {
  for (const element of bodyElements(doc)) {
    if (!element.table || element.table.tableRows.length < 2) continue;
    const first = element.table.tableRows[0];
    const last = element.table.tableRows[element.table.tableRows.length - 1];
    if (first.tableCells.length < 5 || last.tableCells.length < 5) continue;
    if (!/^Lakó, üdülő, kulturális/.test(elementText(first.tableCells[0]).trim())) continue;
    if (elementText(last.tableCells[0]).trim() !== 'MINDÖSSZESEN') continue;
    return {first, last};
  }
  return null;
}

async function refreshTechnicalRoomList(google, docId, projectFolder, store, data) {
  const {getProjectRoomData, writeRoomListToProjectSheet, writeRoomTotalToProjectSheet} =
    require('./project-sheet.cjs');
  const roomData = await getProjectRoomData(google, projectFolder.id);
  if (!roomData || !roomData.rooms.length) return 0;
  const result = domain.buildRoomList(roomData);
  await writeRoomListToProjectSheet(google, roomData.spreadsheet.id, result.rows);
  const previousTotalCents = await writeRoomTotalToProjectSheet(google, roomData.spreadsheet.id, result.totalCents);
  let doc = await google.getDoc(docId);
  const heading = findParagraph(doc, text => text.trim() === 'Helyiségek');
  if (!heading) throw new Error('A műszaki leírásban nincs „Helyiségek” szakasz.');
  const items = paragraphsOf(doc);
  const start = items.findIndex(item => item.index === heading.index);
  let endIndex = heading.endIndex;
  for (let index = start + 1; index < items.length; index++) {
    const item = items[index];
    if (item.table) {
      if (!/Helyiség/.test(elementText(item.table.tableRows?.[0]?.tableCells?.[0] || {content: []}))) break;
      endIndex = item.endIndex;
      continue;
    }
    if (item.paragraph && (/^Helyiséglista:/.test(item.text) || !item.text.trim() ||
        /^\[ELLENŐRIZENDŐ: (?:a Sheetben a 3 szoba|a helyiségsorok összege)/.test(item.text))) {
      endIndex = item.endIndex;
      continue;
    }
    break;
  }
  const previousTerraceCents = 0;
  const previousFireAreaCents = previousTotalCents === null ? null : previousTotalCents - previousTerraceCents;
  await applyEdits(google, docId, [{startIndex: heading.endIndex, endIndex, text: ''}]);
  const table = await insertTable(google, docId, heading.endIndex, result.rows);
  if (table) {
    const tableId = await tableStartIndex(google, docId, table);
    await styleRoomTable(google, docId, tableId.startIndex, result.rows);
    if (result.warning) {
      const current = await google.getDoc(docId);
      const tableElement = bodyElements(current).find(element => element.startIndex === tableId.startIndex);
      const at = tableElement ? tableElement.endIndex : heading.endIndex;
      await google.batchUpdateDoc(docId, [{insertText: {location: {index: at}, text: result.warning + '\n'}}]);
      await google.batchUpdateDoc(docId, [{
        updateTextStyle: {
          range: {startIndex: at, endIndex: at + result.warning.length},
          textStyle: {fontFamily: 'Arial Narrow', fontSize: 10, foregroundColor: '#1456BA'},
          fields: 'fontFamily,fontSize,foregroundColor'
        }
      }]);
    }
  }
  await refreshRoomTotals(google, docId, result.totalCents, result.fireAreaCents,
    previousTotalCents, previousFireAreaCents);
  doc = await google.getDoc(docId);
  return roomData.rooms.length;
}

async function tableStartIndex(google, docId, table) {
  const doc = await google.getDoc(docId);
  const found = bodyElements(doc).find(element => element.table && element.startIndex >= table.startIndex);
  return found || table;
}

async function styleRoomTable(google, docId, index, rows) {
  const doc = await google.getDoc(docId);
  const table = bodyElements(doc).find(element => element.table && element.startIndex === index);
  if (!table) return;
  const requests = [
    {updateTableColumnProperties: {
      tableStartLocation: {index}, columnIndices: [0],
      tableColumnProperties: {widthType: 'FIXED_WIDTH', width: {magnitude: 210, unit: 'PT'}}
    }},
    {updateTableColumnProperties: {
      tableStartLocation: {index}, columnIndices: [1],
      tableColumnProperties: {widthType: 'FIXED_WIDTH', width: {magnitude: 80, unit: 'PT'}}
    }}
  ];
  table.table.tableRows.forEach((row, rowIndex) => {
    const emphasized = rowIndex === 0 || !rows[rowIndex]?.[1] || / összesen$/.test(rows[rowIndex][0] || '') ||
      rows[rowIndex][0] === 'Terasz nélkül';
    if (!emphasized) return;
    row.tableCells.forEach(cell => {
      const paragraph = cell.content?.[0]?.paragraph;
      if (!paragraph) return;
      const text = paragraphText(paragraph);
      if (!text.trim()) return;
      requests.push({updateTextStyle: {
        range: {startIndex: paragraph.startIndex, endIndex: paragraph.startIndex + Math.max(0, text.length - 1)},
        textStyle: {bold: true}, fields: 'bold'
      }});
    });
  });
  await google.batchUpdateDoc(docId, requests);
}

async function refreshTechnicalCoverImage(google, docId, projectFolder, store) {
  const {getLatestRenderCoverFile} = require('./project-sheet.cjs');
  const file = await getLatestRenderCoverFile(google, projectFolder.id);
  if (!file) return false;
  const doc = await google.getDoc(docId);
  const inline = Object.entries(doc.inlineObjects || {}).map(([id, value]) => ({id, value, inline: true,
    size: value.inlineObjectProperties?.embeddedObject?.size || {}}));
  const positioned = Object.entries(doc.positionedObjects || {}).map(([id, value]) => ({id, value, inline: false,
    size: value.positionedObjectProperties?.embeddedObject?.size || {}}));
  const images = [...inline, ...positioned].filter(item => item.value.inlineObjectProperties || item.value.positionedObjectProperties);
  if (!images.length) throw new Error('A műszaki leírás címlapján nincs lecserélhető kép.');
  images.sort((a, b) => (b.size.width?.magnitude || 0) * (b.size.height?.magnitude || 0) -
    (a.size.width?.magnitude || 0) * (a.size.height?.magnitude || 0));
  const target = images[0];
  await google.withPublicRead(file.id, async () => {
    const uri = 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(file.id);
    try {
      await google.batchUpdateDoc(docId, [{replaceImage: {
        imageObjectId: target.id, uri, imageReplaceMethod: 'CENTER_CROP'
      }}]);
    } catch (error) {
      // Pozicionált kép cseréje nem minden esetben támogatott; inline képpel pótoljuk.
      const requests = [];
      if (!target.inline) requests.push({deletePositionedObject: {objectId: target.id}});
      const index = bodyElements(doc)[0]?.startIndex || 1;
      requests.push({insertInlineImage: {location: {index}, uri, objectSize: target.size}});
      await google.batchUpdateDoc(docId, requests);
    }
  });
  return true;
}

async function refreshTechnicalDescription(google, store, docId, projectFolder, data, projectSpreadsheet) {
  const {prepareTechnicalProjectSheet, getProjectPlanEntries, getTechnicalSheetReplacements} =
    require('./project-sheet.cjs');
  projectSpreadsheet = projectSpreadsheet || await prepareTechnicalProjectSheet(google, projectFolder, store.baseUrl, data.uid);
  await refreshTechnicalProgram(google, docId, projectSpreadsheet, data, store);
  const answers = await store.getAnswers(data.uid);
  const entries = await getProjectPlanEntries(google, projectFolder.id, data.uid, answers);
  await refreshTechnicalPlanList(google, docId, entries);
  await refreshTechnicalRoomList(google, docId, projectFolder, store, data);
  await refreshTechnicalGrossCoverage(google, docId, projectSpreadsheet);
  await refreshTechnicalCoverImage(google, docId, projectFolder, store);
  return projectSpreadsheet;
}

module.exports = {
  paragraphText, elementText, bodyElements, paragraphsOf, findParagraph, findTextRange,
  applyEdits, replaceParagraphText, replaceCellText, insertTable,
  findConditionalBlocks, applyConditionalBlocks, replaceMergeFields, fillDocument,
  refreshTechnicalPlanList, refreshTechnicalProgram, refreshTechnicalGrossCoverage,
  refreshTechnicalRoomList, refreshTechnicalCoverImage,
  refreshTechnicalDescription, refreshTableRow: findTableRow
};
