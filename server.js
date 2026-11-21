import express from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: 'key.env' });

const app = express();
const port = process.env.PORT || 8000;
const root = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json({ limit: '1mb' }));
app.use(express.static(root));

app.get('/api/geocode', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (query.length < 2) return res.status(400).json({ error: '검색어를 2자 이상 입력하세요.' });

  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.search = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      limit: '5',
      'accept-language': 'ko'
    });
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'GPX-Telemetry/1.0 (location search)'
      }
    });
    const body = await response.text();
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return res.status(502).json({ error: `Nominatim이 JSON이 아닌 응답을 반환했습니다 (HTTP ${response.status}).` });
    }
    if (!response.ok) return res.status(response.status).json({ error: '위치 검색에 실패했습니다.' });
    res.json({
      results: payload.map(place => ({
        id: place.place_id,
        lat: Number(place.lat),
        lon: Number(place.lon),
        name: place.display_name
      }))
    });
  } catch (error) {
    res.status(502).json({ error: `위치 검색 API에 연결할 수 없습니다: ${error.message}` });
  }
});

app.post('/api/route-events', async (req, res) => {
  const apiKey = process.env.ORS_API_KEY;
  const points = Array.isArray(req.body?.points) ? req.body.points : [];

  if (!apiKey) return res.status(500).json({ error: 'ORS_API_KEY가 서버 환경 변수에 없습니다.' });
  if (points.length < 2) return res.status(400).json({ error: '경로 포인트가 2개 이상 필요합니다.' });

  try {
    const response = await fetch('https://api.openrouteservice.org/v2/directions/cycling-regular/json', {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coordinates: simplifyPoints(points, 50).map(point => [point.lon, point.lat]),
        units: 'km',
        instructions: true,
        instructions_format: 'text'
      })
    });
    const body = await response.text();
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return res.status(502).json({ error: `OpenRouteService가 JSON이 아닌 응답을 반환했습니다 (HTTP ${response.status}).` });
    }
    if (!response.ok) return res.status(response.status).json({ error: payload.error?.message || 'OpenRouteService 요청이 실패했습니다.' });
    res.json({
      events: extractEvents(payload),
      duration: Number(payload.routes?.[0]?.summary?.duration || 0)
    });
  } catch (error) {
    res.status(502).json({ error: `경로 안내 API에 연결할 수 없습니다: ${error.message}` });
  }
});

function simplifyPoints(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  const step = (points.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, index) => points[Math.round(index * step)]);
}

function extractEvents(payload) {
  const steps = payload.routes?.flatMap(route => route.segments?.flatMap(segment => segment.steps || []) || []) || [];
  let distance = 0;
  return steps.map(step => {
    distance += Number(step.distance || 0);
    const instruction = step.instruction || '경로 진행';
    return {
    distance: distance / 1000,
    title: translateInstruction(instruction),
    detail: [step.name, step.type != null ? `이동 유형 ${step.type}` : ''].filter(Boolean).join(' · ')
    };
  });
}

function translateInstruction(instruction) {
  return instruction
    .replace(/^Head east$/i, '직진')
    .replace(/^Head west$/i, '직진')
    .replace(/^Head north$/i, '직진')
    .replace(/^Head south$/i, '직진')
    .replace(/^Turn left/i, '좌회전')
    .replace(/^Turn right/i, '우회전')
    .replace(/^U-turn/i, '유턴')
    .replace(/^Arrive/i, '도착');
}

app.listen(port, () => console.log(`GPX Telemetry server: http://localhost:${port}`));
