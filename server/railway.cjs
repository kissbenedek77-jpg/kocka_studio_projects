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

function railwayDeployer({
  token, tokenType, serviceId, environmentId, projectId,
  endpoint, timeout = 15000, fetchImpl
} = {}) {
  const url = String(endpoint || DEFAULT_ENDPOINT);
  const mode = tokenType === 'account' ? 'account' : 'project';
  const missing = [];
  if (!token) missing.push(mode === 'account' ? 'SITE_DEPLOY_API_TOKEN' : 'SITE_DEPLOY_TOKEN');
  if (!serviceId) missing.push('SITE_DEPLOY_SERVICE_ID');
  if (!environmentId) missing.push('SITE_DEPLOY_ENVIRONMENT_ID');

  // Az állapot a felületnek: be van-e állítva, és mi hiányzik. Tokent nem ad ki.
  function status() {
    return {
      configured: missing.length === 0,
      missing: missing.slice(),
      auth: mode,
      serviceId: String(serviceId || ''),
      environmentId: String(environmentId || '')
    };
  }

  async function graphql(query, variables) {
    const send = fetchImpl || globalThis.fetch;
    if (typeof send !== 'function')
      throw fail('A szerveren nincs elérhető fetch a Railway-híváshoz.');
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const seconds = Math.max(Number(timeout) || 0, 0);
    const timer = controller && seconds ? setTimeout(() => controller.abort(), seconds) : null;
    const headers = {'Content-Type':'application/json'};
    if (mode === 'account') headers.Authorization = 'Bearer ' + token;
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
    if (!response.ok)
      throw fail('A Railway API hibát adott (HTTP ' + response.status + ').' +
        (messages.length ? ' ' + messages.join('; ') : ''));
    if (messages.length) throw fail('A Railway API hiba: ' + messages.join('; '));
    return (payload && payload.data) || {};
  }

  // A deploy a szolgáltatás legutóbbi telepítését indítja újra. Ha ez nem megy,
  // és van projekt-azonosító, a tartalék mutationt próbáljuk.
  async function deploy() {
    const state = status();
    if (!state.configured)
      throw fail('A Railway deploy nincs beállítva. Hiányzó változó: ' +
        state.missing.join(', ') + '.', 503);

    let firstError = null;
    try {
      const data = await graphql(REDEPLOY_QUERY, {
        serviceId: String(serviceId), environmentId: String(environmentId)
      });
      if (data.serviceInstanceRedeploy !== false)
        return {ok:true, via:'serviceInstanceRedeploy', serviceId:String(serviceId),
          environmentId:String(environmentId)};
      firstError = fail('A Railway nem indította el a deployt (a válasz hamis értékű).');
    } catch (error) {
      firstError = error;
    }

    if (!projectId) throw firstError;
    const data = await graphql(TRIGGER_QUERY, {
      input: {
        projectId: String(projectId), environmentId: String(environmentId),
        serviceId: String(serviceId)
      }
    });
    if (data.environmentTriggersDeploy === false)
      throw fail('A Railway nem indította el a deployt: ' +
        (firstError && firstError.message ? firstError.message : 'a kérés nem sikerült.'));
    return {ok:true, via:'environmentTriggersDeploy', serviceId:String(serviceId),
      environmentId:String(environmentId)};
  }

  return {status, deploy};
}

module.exports = {railwayDeployer, DEFAULT_ENDPOINT};
