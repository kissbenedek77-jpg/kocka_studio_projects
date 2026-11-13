'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {gitPublisher,DEFAULT_API} = require('../server/web_git.cjs');

// A GitHub Git Data API válaszait utánozó ál-fetch.
function fakeGitHub({failWith} = {}) {
  const calls = [];
  let blobs = 0;
  const impl = async (url,options) => {
    const body = options.body ? JSON.parse(options.body) : null;
    const method = options.method;
    const path = url.replace(DEFAULT_API,'');
    calls.push({url,path,method,options,body});
    if (failWith) return failWith({path,method,body});
    if (method === 'GET' && /\/git\/ref\/heads\//.test(path))
      return json({object:{sha:'parent-1'}});
    if (method === 'GET' && /\/git\/commits\//.test(path))
      return json({tree:{sha:'base-tree'}});
    if (method === 'POST' && path.endsWith('/git/blobs')) {
      blobs += 1;
      return json({sha:'blob-'+blobs});
    }
    if (method === 'POST' && path.endsWith('/git/trees')) return json({sha:'new-tree'});
    if (method === 'POST' && path.endsWith('/git/commits')) return json({sha:'commit-2'});
    if (method === 'PATCH' && /\/git\/refs\/heads\//.test(path)) return json({object:{sha:'commit-2'}});
    if (method === 'GET' && /\/git\/trees\//.test(path)) return json({tree:[
      {path:'shared/data/rolunk.txt',type:'blob'},
      {path:'shared/data/projektek.txt',type:'blob'},
      {path:'shared/js/projects.js',type:'blob'},
      {path:'shared/img/projects/a/1.jpg',type:'blob'}
    ]});
    if (method === 'GET' && /\/contents\//.test(path))
      return json({type:'file',encoding:'base64',
        content:Buffer.from('hero=RÓLUNK\nintro=Bevezető\n','utf8').toString('base64')});
    return json({message:'váratlan kérés: '+method+' '+path},404);
  };
  impl.calls = calls;
  return impl;
}

function json(payload,status=200) {
  return {ok:status>=200&&status<300,status,text:async()=>JSON.stringify(payload)};
}

const files = [
  {path:'shared/data/rolunk.txt',text:'hero=RÓLUNK'},
  {path:'shared/js/projects.js',text:'const PROJECTS = [];'}
];

test('Beállítás nélkül a GitHub publikálás hiányzó változókat jelez', () => {
  const publisher = gitPublisher({});
  const state = publisher.status();
  assert.equal(state.configured,false);
  assert.deepEqual(state.missing,['SITE_GITHUB_TOKEN','SITE_GITHUB_REPO']);
});

test('A publikálás egy commitba írja a fájlokat', async () => {
  const fetchImpl = fakeGitHub();
  const publisher = gitPublisher({token:'gh-token',repo:'kissbenedek77-jpg/kocka-honlap',
    branch:'main',fetchImpl});
  assert.equal(publisher.status().configured,true);
  const result = await publisher.publish(files,'Teszt commit');
  assert.equal(result.commit,'commit-2');
  assert.deepEqual(result.files,['shared/data/rolunk.txt','shared/js/projects.js']);

  const auth = fetchImpl.calls[0].options.headers.Authorization;
  assert.equal(auth,'Bearer gh-token');
  assert.equal(fetchImpl.calls[0].options.headers['User-Agent'],'kocka-studio-website');

  const blobCalls = fetchImpl.calls.filter(call => call.path.endsWith('/git/blobs'));
  assert.equal(blobCalls.length,2);
  assert.equal(Buffer.from(blobCalls[0].body.content,'base64').toString('utf8'),'hero=RÓLUNK');
  assert.equal(blobCalls[0].body.encoding,'base64');

  const treeCall = fetchImpl.calls.find(call => call.path.endsWith('/git/trees'));
  assert.equal(treeCall.body.base_tree,'base-tree');
  assert.deepEqual(treeCall.body.tree.map(entry => entry.path),
    ['shared/data/rolunk.txt','shared/js/projects.js']);

  const commitCall = fetchImpl.calls.find(call => call.path.endsWith('/git/commits'));
  assert.equal(commitCall.body.message,'Teszt commit');
  assert.equal(commitCall.body.tree,'new-tree');
  assert.deepEqual(commitCall.body.parents,['parent-1']);

  const patch = fetchImpl.calls.find(call => call.method === 'PATCH');
  assert.match(patch.path,/\/git\/refs\/heads\/main$/);
  assert.equal(patch.body.sha,'commit-2');
  assert.equal(patch.body.force,false);
});

test('A mappa-előtag és a per-jeles branch is helyesen kerül az útvonalba', async () => {
  const fetchImpl = fakeGitHub();
  const publisher = gitPublisher({token:'t',repo:'o/r',branch:'web/eles',pathPrefix:'/honlap/',
    fetchImpl});
  await publisher.publish(files,'x');
  const get = fetchImpl.calls[0];
  assert.equal(get.path,'/repos/o/r/git/ref/heads/web/eles');
  const patch = fetchImpl.calls.find(call => call.method === 'PATCH');
  assert.equal(patch.path,'/repos/o/r/git/refs/heads/web/eles');
  const tree = fetchImpl.calls.find(call => call.path.endsWith('/git/trees'));
  assert.deepEqual(tree.body.tree.map(entry => entry.path),
    ['honlap/shared/data/rolunk.txt','honlap/shared/js/projects.js']);
});

test('Beállítás nélkül a publikálás érthető hibát ad, hívás nélkül', async () => {
  const fetchImpl = fakeGitHub();
  const publisher = gitPublisher({repo:'o/r',fetchImpl});
  await assert.rejects(publisher.publish(files,'x'),error => {
    assert.equal(error.status,503);
    assert.match(error.message,/SITE_GITHUB_TOKEN/);
    return true;
  });
  assert.equal(fetchImpl.calls.length,0);
});

test('Jogosultsági hiba esetén útmutató üzenet jön, token nélkül', async () => {
  const fetchImpl = fakeGitHub({failWith:() => json({
    message:'Resource not accessible by personal access token'},403)});
  const publisher = gitPublisher({token:'titkos-gh-token',repo:'o/r',fetchImpl});
  await assert.rejects(publisher.publish(files,'x'),error => {
    assert.equal(error.status,502);
    assert.equal(error.auth,true);
    assert.match(error.message,/contents: write/);
    assert.doesNotMatch(error.message,/titkos-gh-token/);
    return true;
  });
});

test('Hiányzó branch esetén érthető hiba jön', async () => {
  const fetchImpl = fakeGitHub({failWith:() => json({message:'Not Found'},404)});
  const publisher = gitPublisher({token:'t',repo:'o/r',branch:'nincs',fetchImpl});
  await assert.rejects(publisher.publish(files,'x'),/HTTP 404/);
});

test('Hálózati hiba esetén a publikálás nem omlik össze', async () => {
  const publisher = gitPublisher({token:'t',repo:'o/r',
    fetchImpl:async()=>{throw new Error('ECONNRESET')}});
  await assert.rejects(publisher.publish(files,'x'),/nem érhető el: ECONNRESET/);
});

test('A data fájlok listázása csak a shared/data TXT-ket adja', async () => {
  const fetchImpl = fakeGitHub();
  const publisher = gitPublisher({token:'t',repo:'o/r',fetchImpl});
  const files = await publisher.listDataFiles('shared/data');
  assert.deepEqual(files,[
    {path:'shared/data/projektek.txt',name:'projektek.txt'},
    {path:'shared/data/rolunk.txt',name:'rolunk.txt'}
  ]);
  assert.match(fetchImpl.calls[0].path,/\/git\/trees\/main\?recursive=1$/);
});

test('A data fájl tartalma a repóból olvasható', async () => {
  const fetchImpl = fakeGitHub();
  const publisher = gitPublisher({token:'t',repo:'o/r',fetchImpl});
  const text = await publisher.readTextFile('shared/data/rolunk.txt');
  assert.match(text,/hero=RÓLUNK/);
  const call = fetchImpl.calls[0];
  assert.equal(call.path,'/repos/o/r/contents/shared/data/rolunk.txt?ref=main');
});

test('Időtúllépéskor 504-es hiba jön', async () => {
  const fetchImpl = (url,options) => new Promise((resolve,reject) => {
    options.signal.addEventListener('abort',() => {
      const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
    });
  });
  const publisher = gitPublisher({token:'t',repo:'o/r',timeout:10,fetchImpl});
  await assert.rejects(publisher.publish(files,'x'),error => {
    assert.equal(error.status,504);
    assert.match(error.message,/nem válaszolt időben/);
    return true;
  });
});
