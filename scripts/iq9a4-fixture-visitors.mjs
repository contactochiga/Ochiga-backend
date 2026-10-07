// IQ-9A4 diagnostic (read-only): the fixture's visitor_access rows (name, status, expires_at) and the evaluation instant.
const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
const r = await fetch('http://127.0.0.1:55421/rest/v1/visitor_access?select=visitor_name,status,expires_at,created_at', {headers: {apikey: k, Authorization: `Bearer ${k}`}});
console.log('VISITOR_ROWS', JSON.stringify(await r.json()), 'NOW', new Date().toISOString());
