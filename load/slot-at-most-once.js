import http from 'k6/http';
import { check } from 'k6';
import { Gauge, Rate } from 'k6/metrics';

const atMostOnce = new Rate('slot_booked_at_most_once');
const distinctUpstreams = new Gauge('distinct_upstreams');
const proxy = __ENV.PROXY_URL || 'http://proxy';

for (const name of ['API_1', 'API_2', 'TOKEN_1', 'TOKEN_2']) {
  if (!__ENV[name]) {
    throw new Error(`Pass ${name}; use each API replica's own token.`);
  }
}

const tomorrow = new Date();
tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
tomorrow.setUTCHours(10, 0, 0, 0);
const start = __ENV.START || tomorrow.toISOString();

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    checks: ['rate==1'],
    distinct_upstreams: ['value==2'],
    slot_booked_at_most_once: ['rate==1'],
  },
};

export function setup() {
  const upstreams = new Set();
  for (let i = 0; i < 40; i++) {
    const response = http.get(`${proxy}/health`, { redirects: 0 });
    check(response, { 'proxy health is OK': (r) => r.status === 200 });
    const upstream = response.headers['X-Upstream'];
    if (upstream) {
      upstreams.add(upstream);
    }
  }
  distinctUpstreams.add(upstreams.size);
  console.log(`Proxy preflight: ${upstreams.size} copies ${JSON.stringify([...upstreams])}`);
  if (upstreams.size !== 2) {
    throw new Error('The proxy must reach both API replicas before booking.');
  }
}

export default function () {
  const booking = { roomId: 'r-1', start, minutes: '30', attendees: '1' };
  // Sequential requests are sufficient: the first write should constrain the second.
  const first = http.post(`${__ENV.API_1}/bookings`, booking, {
    headers: { Authorization: `Bearer ${__ENV.TOKEN_1}` },
    redirects: 0,
  });
  const second = http.post(`${__ENV.API_2}/bookings`, booking, {
    headers: { Authorization: `Bearer ${__ENV.TOKEN_2}` },
    redirects: 0,
  });

  check(first, { 'first booking is confirmed (fresh slot)': (r) => r.status === 201 });
  check(second, {
    'second request is confirmed or waitlisted': (r) => r.status === 201 || r.status === 202,
  });
  const confirmations = Number(first.status === 201) + Number(second.status === 201);
  atMostOnce.add(confirmations <= 1);

  console.log(`${__ENV.API_1}: status=${first.status} body=${first.body}`);
  console.log(`${__ENV.API_2}: status=${second.status} body=${second.body}`);
  console.log(`room=r-1 start=${start} minutes=30 confirmations=${confirmations}`);
}
