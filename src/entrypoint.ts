// ============================================================
// entrypoint.ts — Ponto de entrada único em produção (Railway). Os dois
// serviços (api, workers) rodam a mesma imagem/build; qual metade liga é
// decidido pela variável SERVICE_ROLE definida em cada serviço no Railway.
// Evita precisar configurar um "start command" diferente por serviço —
// o builder já detecta e roda `npm start` por padrão.
// ============================================================

if (process.env.SERVICE_ROLE === 'workers') {
  require('./workers')
} else {
  require('./api/server')
}
