const express = require('express')
const crypto = require('crypto');
const app = express()
const port = 3000
const CLI_SERVER = "https://cpcli.cf.eu10.hana.ondemand.com"
const CLI_VERSION = "v2.54.0"
const REFRESH_HEADER = "x-cpcli-replacementrefreshtoken"
const ID_TOKEN_HEADER = "x-id-token"
const SUBDOMAIN_HEADER = "x-cpcli-subdomain"
const sessions = {}

async function post(sessionId, url, body, subdomain, custom_headers = {}) {
  let s = sessions[sessionId]
  let req_headers = {
    'Accept': 'application/json',
    'Content-type': 'application/json',
    'x-cpcli-refreshtoken': s.refreshToken,
    'x-cpcli-subdomain': subdomain,
    'x-cpcli-format': 'json', ...custom_headers
  }
  let response = await fetch(url, {
    method: 'POST',
    headers: req_headers,
    redirect: 'manual',
    body
  })
  let headers = response.headers
  if (headers && headers.has(REFRESH_HEADER)) {
    s.refreshToken = headers.get(REFRESH_HEADER)
    console.log("New refresh token:", s.refreshToken)
  }
  if (response.status == 307) {
    return post(sessionId, headers.get('location'), body, subdomain, { 'x-id-token': headers.get(ID_TOKEN_HEADER), 'x-cpcli-subdomain': headers.get(SUBDOMAIN_HEADER) })
  }

  let data = await response.text()
  try {
    return JSON.parse(data)
  } catch (err) {
    return null
  }
}

app.listen(port, () => {
  console.log(`BTP-connect listening on port ${port}. Use http://localhost:${port}/btpdump to start a new session`)
})

async function globalAccounts(sessionId) {
  let accounts = await post(sessionId,`${CLI_SERVER}/client/${CLI_VERSION}/globalAccountList`)
  return accounts
}

function uuidv4() {
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}
function subAccounts(sessionId,subdomain) {
  let body = { paramValues: { globalAccount: subdomain } }
  return post(sessionId,`${CLI_SERVER}/command/${CLI_VERSION}/accounts/subaccount?list`, JSON.stringify(body), subdomain)
}

function serviceInstances(sessionId, subdomain, sa) {
    let body = { paramValues: { subaccount: sa.guid } }
    return post(sessionId,`${CLI_SERVER}/command/${CLI_VERSION}/services/instance?list`, JSON.stringify(body), subdomain)
}

function serviceBindings(sessionId, subdomain, sa) {
    let body = { paramValues: { subaccount: sa.guid } }
    return post(sessionId,`${CLI_SERVER}/command/${CLI_VERSION}/services/binding?list`, JSON.stringify(body), subdomain)
}

function sso(id) {
  if (!id) {
    id = uuidv4()
  }
  if (!sessions[id]){
    sessions[id] = {status: 'InProgress'}
  }
  let body = { "customIdp": "", "subdomain": "" }
  let req_headers = {
    'Accept': 'application/json',
    'Content-type': 'application/json',
    'x-cpcli-format': 'json'
  }

  fetch(`${CLI_SERVER}/login/${CLI_VERSION}/browser/${id}`,
    { method: 'POST', headers: req_headers, body: JSON.stringify(body) }
  ).then(async (res) => {
    return res.json()
  }).then(async (account) => {
      const start = performance.now();
      sessions[id].refreshToken = account.refreshToken
      let gas = await globalAccounts(id)
      sessions[id].gAccounts=gas
      for (let ga of gas) {
        console.log('global account:',ga.displayName)
        let sub = await subAccounts(id, ga.subdomain)
        ga.sAccounts=sub.value
        for (let sa of sub.value) {
          console.log('  sub account:',sa.displayName)          
          serviceInstances(id, ga.subdomain, sa).then((si)=>{sa.instances=si})
          serviceBindings(id, ga.subdomain, sa).then((bi)=>{sa.bindings=bi})
        }
      }
      sessions[id].status='Ready'

      const end = performance.now();
      sessions[id].executionTimeMs=end - start
    })
  return {
    ssoUrl: `${CLI_SERVER}/login/${CLI_VERSION}/browser/${id}`,
    dumpUrl: `/btpdump/${id}`,
    session: id
  }
}

app.get('/btpdump', (req, res) => {
  res.json(sso())
})

app.get('/btpdump/:sessionid', (req, res) => {
  if (sessions[req.params.sessionid]) {
    res.json(sessions[req.params.sessionid])
  } else {
    res.sendStatus(404);
  }
})

app.get('/btpdump/:sessionid/instances', (req, res) => {
  if (sessions[req.params.sessionid]) {
    res.json(sessions[req.params.sessionid])
  } else {
    res.sendStatus(404);
  }
})
app.get('/sessions', (req, res) => {
  res.json(Object.keys(sessions))
})

process.on('SIGINT', function() {
  console.log('SIGINT received');
  process.exit();
});