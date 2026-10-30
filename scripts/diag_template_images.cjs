'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {google} = require('googleapis');
const {readTrackingCredential} = require('../server/tracking_credential.cjs');

const env = fs.readFileSync(require('node:path').join(__dirname,'..','.env'), 'utf8');
const get = key => {
  const match = new RegExp('^' + key + '=(.*)$', 'm').exec(env);
  return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : '';
};
(async () => {
  const token = readTrackingCredential(get('SESSION_SECRET'), get('GOOGLE_TRACKING_CREDENTIAL'), get('OWNER_EMAIL'));
  const oauth = new google.auth.OAuth2(get('GOOGLE_CLIENT_ID'), get('GOOGLE_CLIENT_SECRET'));
  oauth.setCredentials({refresh_token: token});
  const docs = google.docs({version: 'v1', auth: oauth});
  const doc = (await docs.documents.get({documentId: '1TIGIBSACypr0ZvMZ2xXRABEcPArkQTwM_AqfnMNVtoA'})).data;
  const positioned = Object.entries(doc.positionedObjects || {});
  console.log('revisionId=' + doc.revisionId);
  console.log('positionedObjects=' + positioned.length);
  for (const [id, object] of positioned) {
    const embedded = object.positionedObjectProperties?.embeddedObject;
    console.log(id, 'image=' + Boolean(embedded?.imageProperties),
      'size=' + JSON.stringify(embedded?.size || {}));
  }
  let inline = 0;
  const walk = content => {
    for (const item of content || []) {
      for (const element of item.paragraph?.elements || []) if (element.inlineObjectElement) inline++;
      if (item.table) for (const row of item.table.tableRows || [])
        for (const cell of row.tableCells || []) walk(cell.content);
    }
  };
  walk(doc.body?.content);
  console.log('inlineObjects=' + inline);
})();
