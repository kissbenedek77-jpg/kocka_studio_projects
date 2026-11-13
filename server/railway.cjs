'use strict';

// Railway deploy indítása a nyilvános weboldal szolgáltatásában (GraphQL API v2).
//
// A /site oldal publikálása a weboldal projekt mappájába írja a szövegeket és a
// képeket. Ahhoz, hogy ez élesben is látszódjon, a weboldal szolgáltatását újra
// kell telepíteni; ezt végzi ez a modul a Railway API-val. Ha a változók nincsenek
// beállítva, a publikálás változatlanul működik, csak deploy nem indul.
//
// Változók (a Railway saját rendszerváltozói ugyanígy kezdődnek, ezért saját
// SITE_DEPLOY_ előtagot használunk; a RAILWAY_* értékeket szándékosan nem
// olvassuk, mert azok a futó szolgáltatás saját azonosítói):
//   SITE_DEPLOY_API_TOKEN       fiók/workspace token (Authorization: Bearer)
//   SITE_DEPLOY_TOKEN           projekt token (Project-Access-Token)
//   SITE_DEPLOY_SERVICE_ID      a weboldal szolgáltatás azonosítója
//   SITE_DEPLOY_ENVIRONMENT_ID  a környezet azonosítója
//   SITE_DEPLOY_PROJECT_ID      opcionális, a tartalék deploy-mutationhöz
//   SITE_DEPLOY_API_URL         opcionális, alapérték a Railway GraphQL v2 végpont
//
// A token soha nem kerül naplóba vagy hibaüzenetbe.

const DEFAULT_ENDPOINT = 'https://backboard.railway.com/graphql/v2';
const REDEPLOY_QUERY =
  'mutation serviceInstanceRedeploy($serviceId: String!, $environmentId: String!){' +
  'serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)}';
const TRIGGER_QUERY =
  'mutation environmentTriggersDeploy($input: EnvironmentTriggersDeployInput!){' +
  'environmentTriggersDeploy(input: $input)}';

const fail = (message, status = 502) => Object.assign(new Error(message), {status});

// A Railway „Not Authorized” válasza leggyakrabban fejléc/token típus eltérés.
// Ilyenkor a másik fejléccel is megpróbáljuk ugyanazt a tokent.
const AUTH_ERROR = /not authori[sz]ed|unauthorized|forbidden|invalid token|not authenticated|no authori[sz]ation/i;
const isAuthError = error => Boolean(error) &&
  (error.auth === true || error.status === 401 || error.status === 403 ||
    AUTH_ERROR.test(String(error.message || '')));
// Jogosultsági hiba: 502-t adunk vissza, mert a 401-et a felület a munkamenet
// lejártaként kezelné és a belépésre irányítana.
const authFail = message => Object.assign(new Error(message), {status:502, auth:true});

function railwayDeployer({
  token, tokenType, serviceId, environmentId, projectId,
  endpoint, timeout = 15000, fetchImpl
} = {}) {
  const url = String(endpoint || DEFAULT_ENDPOINT);
  const mode = tokenType === 'account' ? 'account' : 'project';
  const tokenVar = mode === 'account' ? 'SITE_DEPLOY_API_TOKEN' : 'SITE_DEPLOY_TOKEN';
  const missing = [];
  if (!token) missing.push(tokenVar);
  if (!serviceId) missing.push('SITE_DEPLOY_SERVICE_ID');
  if (!environmentId) missing.push('SITE_DEPLOY_ENVIRONMENT_ID');

  // Az állapot a felületnek: be van-e állítva, és mi hiányzik. Tokent nem ad ki.
  function status() {
    return {
      configured: missing.length === 0,
      missing: missing.slice(),
      auth: mode,
      tokenVar,
      serviceId: String(serviceId || ''),
      environmentId: String(environmentId || '')
    };
  }

  async function graphql(query, variables, authMode) {
    const auth = authMode === 'account' ? 'account' : 'project';
    const send = fetchImpl || globalThis.fetch;
    if (typeof send !== 'function')
      throw fail('A szerveren nincs elérhető fetch a Railway-híváshoz.');
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const seconds = Math.max(Number(timeout) || 0, 0);
    const timer = controller && seconds ? setTimeout(() => controller.abort(), seconds) : null;
    const headers = {'Content-Type':'application/json'};
    if (auth === 'account') headers.Authorization = 'Bearer ' + token;
    else headers['Project-Access-Token'] = token;

    let response;
    try {
      response = await send(url, {
        method:'POST', headers,
        body: JSON.stringify({query, variables}),
        signal: controller ? controller.signal : undefined
      });
    } catch (error) {
      if (error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
        throw fail('A Railway API nem válaszolt időben (' + Math.round(seconds / 1000) + ' s).', 504);
      throw fail('A Railway API nem érhető el: ' +
        (error && error.message ? error.message : 'hálózati hiba'));
    } finally {
      if (timer) clearTimeout(timer);
    }

    let payload;
    try { payload = await response.json(); }
    catch (_) { throw fail('A Railway API válasza nem értelmezhető (HTTP ' + response.status + ').'); }

    const messages = Array.isArray(payload && payload.errors)
      ? payload.errors.map(item => item && item.message).filter(Boolean) : [];
    if (!response.ok) {
      const suffix = messages.length ? ' ' + messages.join('; ') : '';
      if (response.status === 401 || response.status === 403)
        throw authFail('A Railway API nem fogadta el a tokent (HTTP ' + response.status + ').' + suffix);
      throw fail('A Railway API hibát adott (HTTP ' + response.status + ').' + suffix);
    }
    if (messages.length) {
      const text = messages.join('; ');
      if (AUTH_ERROR.test(text))
        throw authFail('A Railway API nem fogadta el a tokent: ' + text);
      throw fail('A Railway API hiba: ' + text);
    }
    return (payload && payload.data) || {};
  }

  // A deploy a szolgáltatás legutóbbi telepítését indítja újra. Ha ez nem megy,
  // és van projekt-azonosító, a tartalék mutationt próbáljuk.
  async function redeploy(authMode) {
    const data = await graphql(REDEPLOY_QUERY,
      {serviceId:String(serviceId), environmentId:String(environmentId)}, authMode);
    if (data.serviceInstanceRedeploy === false)
      throw fail('A Railway nem indította el a deployt (a válasz hamis értékű).');
    return {ok:true, via:'serviceInstanceRedeploy', auth:authMode};
  }

  async function trigger(authMode) {
    const data = await graphql(TRIGGER_QUERY, {input:{
      projectId:String(projectId), environmentId:String(environmentId), serviceId:String(serviceId)
    }}, authMode);
    if (data.environmentTriggersDeploy === false)
      throw fail('A Railway nem indította el a deployt (a válasz hamis értékű).');
    return {ok:true, via:'environmentTriggersDeploy', auth:authMode};
  }

  async function attempt(authMode) {
    try { return await redeploy(authMode); }
    catch (error) {
      if (!projectId) throw error;
      try { return await trigger(authMode); }
      catch (second) {
        // Ha a tartalék hívás is jogosultsági hiba, az a mérvadó.
        throw isAuthError(second) ? second : error;
      }
    }
  }

  async function deploy() {
    const state = status();
    if (!state.configured)
      throw fail('A Railway deploy nincs beállítva. Hiányzó változó: ' +
        state.missing.join(', ') + '.', 503);
    const finish = result => ({...result,
      serviceId:String(serviceId), environmentId:String(environmentId)});

    let firstError = null;
    try { return finish(await attempt(state.auth)); }
    catch (error) { firstError = error; }
    if (!isAuthError(firstError)) throw firstError;

    // A token lehet projekt vagy fiók token; a másik fejléccel is megpróbáljuk.
    const other = state.auth === 'account' ? 'project' : 'account';
    try { return finish(await attempt(other)); }
    catch (error) {
      throw authFail('A Railway nem fogadta el a tokent (' + state.tokenVar + '). ' +
        'Ellenőrizd, hogy valódi projekt token van-e a SITE_DEPLOY_TOKEN-ben ' +
        '(Project-Access-Token fejléc) vagy fiók token a SITE_DEPLOY_API_TOKEN-ben ' +
        '(Authorization: Bearer fejléc), hogy a token nem járt-e le, és hogy a ' +
        'szolgáltatás- és környezet-azonosító a weboldal projektjéhez tartozik-e. ' +
        (error && error.message ? error.message : ''));
    }
  }

  return {status, deploy};
}

module.exports = {railwayDeployer, DEFAULT_ENDPOINT};
