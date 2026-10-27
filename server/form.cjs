'use strict';
const {escapeHtml} = require('./domain.cjs');

const FORM_METHODS = ['createNewRecordForWeb', 'saveData', 'getData'];

// MARK: google.script.run helyettesítése fetch-alapú hívással
const SHIM = `<script>
(function(){
  var handlers={success:null,failure:null};
  function call(name,args){
    fetch('/api/form',{method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json','X-Kocka-Form':'1'},
      body:JSON.stringify({name:name,args:args})})
      .then(function(response){
        return response.json().then(function(body){
          if(!response.ok)throw new Error(body&&body.error?body.error:'A kérés nem sikerült.');
          return body.result;
        });
      })
      .then(function(result){if(handlers.success)handlers.success(result);})
      .catch(function(error){
        if(handlers.failure)handlers.failure({message:error.message||String(error)});
        else if(window.console)console.error(error);
      });
  }
  function runner(){
    return {
      withSuccessHandler:function(fn){handlers.success=fn;return runner();},
      withFailureHandler:function(fn){handlers.failure=fn;return runner();},
      createNewRecordForWeb:function(){call('createNewRecordForWeb',[]);},
      saveData:function(data){call('saveData',[data]);},
      getData:function(uid){call('getData',[uid]);}
    };
  }
  window.google={script:{run:runner()}};
})();
</script>`;

// MARK: A shim beszúrása a sablon első script-blokkja elé (CRLF és LF sablonhoz is)
const FORM_MARKER = /<script>(\r?\n)\/\/ MARK: Kezdőállapot/;

function renderForm(template, uid) {
  return String(template)
    .replace(/<\?=\s*uid\s*\?>/g, () => escapeHtml(uid || ''))
    .replace(FORM_MARKER, (match, newline) =>
      SHIM + newline + '<script>' + newline + '// MARK: Kezdőállapot');
}

async function handleFormRequest(store, body) {
  if (!body || typeof body.name !== 'string' || FORM_METHODS.indexOf(body.name) === -1)
    throw new Error('Érvénytelen űrlapművelet.');
  const args = Array.isArray(body.args) ? body.args : [];
  if (body.name === 'createNewRecordForWeb') return store.createRecord();
  if (body.name === 'getData') return store.getData(String(args[0] || ''));
  if (!args[0] || typeof args[0] !== 'object') throw new Error('Az űrlapadatok hiányoznak.');
  return store.saveData(args[0]);
}

module.exports = {renderForm, handleFormRequest, FORM_METHODS, SHIM};
