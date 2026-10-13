'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../api/seating-view.js');
const SeatingView = require('../seating-view.js');
const { createHubAuth } = require('../lib/hub-auth.cjs');

const baseEnv = {
  SUPABASE_URL: 'https://wedding.test/rest/v1/',
  SUPABASE_SERVICE_ROLE_KEY: 'server-only-secret',
  WEDDING_HUB_PASSWORD: 'synthetic-test',
  WEDDING_HUB_SESSION_SECRET: 'synthetic-hub-session-secret-only-123456'
};

const session = createHubAuth({env:baseEnv}).login({headers:{origin:'https://wedding.test',host:'wedding.test'}},baseEnv.WEDDING_HUB_PASSWORD);
function mockReq(method = 'GET') { return { method, headers:{cookie:session.cookie.split(';')[0]} }; }
function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body = '') { this.body = body; }
  };
}

test('GET returns only public name and table fields while preserving duplicate names', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => [
        { guest_number: 19, name: 'Same Name', table_number: 11, seat_number: 4, invitation_code: 'NEVER', phone: 'NEVER' },
        { guest_number: 7, name: 'Same Name', table_number: 3, rsvp_status: 'Pending', dietary: 'NEVER' }
      ]
    };
  };
  const res = mockRes();
  await createHandler({ env: baseEnv, fetchImpl })(mockReq(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'private, no-store');
  assert.deepEqual(JSON.parse(res.body), {
    ok: true,
    guests: [
      { name: 'Same Name', table_number: 3 },
      { name: 'Same Name', table_number: 11 }
    ]
  });
  assert.match(request.url, /^https:\/\/wedding\.test\/rest\/v1\/guests\?/);
  assert.equal(new URL(request.url).searchParams.get('select'), 'guest_number,name,table_number');
  assert.equal(new URL(request.url).searchParams.get('guest_number'), 'not.is.null');
  assert.equal(new URL(request.url).searchParams.get('table_number'), 'not.is.null');
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.headers.apikey, 'server-only-secret');
  assert.equal(request.options.headers.Authorization, 'Bearer server-only-secret');
  assert.doesNotMatch(res.body, /guest_number|seat_number|invitation_code|phone|rsvp|dietary|secret/i);
});

test('only GET is allowed and rejected methods never reach Supabase', async () => {
  let called = false;
  const res = mockRes();
  await createHandler({ env: baseEnv, fetchImpl: async () => { called = true; } })(mockReq('POST'), res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'GET');
  assert.equal(called, false);
});

test('direct seating endpoint requires a valid hub session before reading guest names', async () => {
  let called=false;const res=mockRes();
  await createHandler({env:baseEnv,fetchImpl:async()=>{called=true;}})({method:'GET',headers:{}},res);
  assert.equal(res.statusCode,401);assert.equal(called,false);assert.doesNotMatch(res.body,/Guest|table_number/);
});

test('configuration and upstream failures disclose no credentials or upstream payloads', async t => {
  t.mock.method(console, 'error', () => {});
  const missingRes = mockRes();
  await createHandler({ env: {...baseEnv,SUPABASE_URL:''}, fetchImpl: async () => { throw new Error('should not run'); } })(mockReq(), missingRes);
  assert.equal(missingRes.statusCode, 503);

  const failedRes = mockRes();
  await createHandler({ env: baseEnv, fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ message: 'database secret detail' }) }) })(mockReq(), failedRes);
  assert.equal(failedRes.statusCode, 502);
  assert.doesNotMatch(failedRes.body, /secret|401|supabase|database/i);
});

test('browser model keeps the exact 13-table room/foyer plan, empty tables, and repeated names', () => {
  assert.deepEqual(SeatingView.TABLES.map(table => table.number), [9, 10, 6, 3, 7, 8, 2, 1, 5, 11, 13, 12, 15]);
  assert.equal(SeatingView.TABLES.filter(table => table.area === 'room').length, 9);
  assert.equal(SeatingView.TABLES.filter(table => table.area === 'foyer').length, 4);

  const model = SeatingView.buildViewModel([
    { name: 'Alex Chan', table_number: 3 },
    { name: 'Alex Chan', table_number: 3 },
    { name: 'Taylor Lee', table_number: 15 },
    { name: 'Unexpected', table_number: 14 },
    { name: 'Missing table', table_number: null }
  ]);
  assert.equal(model.byTable.size, 13);
  assert.equal(model.byTable.get(3).length, 2);
  assert.deepEqual(model.byTable.get(1), []);
  assert.deepEqual(model.outsidePlan, [{ name: 'Unexpected', table_number: 14 }]);
  assert.equal(model.guests.length, 4);
  assert.equal(SeatingView.searchGuests(model.guests, 'alex').length, 2);
  assert.deepEqual(SeatingView.searchGuests(model.guests, 'table 15'), [{ name: 'Taylor Lee', table_number: 15 }]);
});

test('browser data loader uses the dedicated GET endpoint and drops non-contract fields', async () => {
  let request;
  const guests = await SeatingView.fetchGuests(async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      json: async () => ({ ok: true, guests: [{ name: 'Guest', table_number: 2, phone: 'hidden' }] })
    };
  });
  assert.equal(request.url, '/api/seating-view');
  assert.equal(request.options.method, 'GET');
  assert.deepEqual(guests, [{ name: 'Guest', table_number: 2 }]);
});
