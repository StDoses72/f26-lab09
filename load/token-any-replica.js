import http from 'k6/http';
import { Gauge, Rate } from 'k6/metrics';

const tokenWorks = new Rate('token_works_on_any_replica');
const distinctUpstreams = new Gauge('distinct_upstreams');
const upstreams = new Set();
const proxy = __ENV.PROXY_URL || 'http://proxy';

if (!__ENV.TOKEN) {
  throw new Error('Pass TOKEN from one API replica startup log.');
}

// One VU keeps the observed upstream set in one JavaScript instance.
export const options = {
  vus: 1,
  iterations: 40,
  thresholds: {
    token_works_on_any_replica: ['rate==1'],
    distinct_upstreams: ['value==2'],
  },
};

export default function () {
  const response = http.get(`${proxy}/bookings`, {
    headers: { Authorization: `Bearer ${__ENV.TOKEN}` },
    redirects: 0,
  });
  const upstream = response.headers['X-Upstream'];
  if (upstream) {
    upstreams.add(upstream);
  }
  distinctUpstreams.add(upstreams.size);
  tokenWorks.add(response.status === 200);
  console.log(`upstream=${upstream} status=${response.status}`);
}
