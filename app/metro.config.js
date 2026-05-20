const { getDefaultConfig } = require('expo/metro-config');
const http = require('http');
const url = require('url');

const config = getDefaultConfig(__dirname);

// Proxy API calls through Metro to the Python server on 9099
const API_TARGET = { hostname: 'localhost', port: 9099 };

config.server = config.server || {};
config.server.enhanceMiddleware = (metroMiddleware) => {
  return (req, res, next) => {
    const parsed = url.parse(req.url);

    // Check if this is an API request
    if (parsed.pathname && (
      parsed.pathname === '/analyze' ||
      parsed.pathname.startsWith('/analyze') ||
      parsed.pathname.startsWith('/results/') ||
      parsed.pathname.startsWith('/clips/') ||
      parsed.pathname.startsWith('/uploads/') ||
      parsed.pathname.startsWith('/qr') ||
      parsed.pathname.startsWith('/frame-data/') ||
      parsed.pathname === '/health'
    )) {
      // Forward to Python API server
      const options = {
        hostname: API_TARGET.hostname,
        port: API_TARGET.port,
        path: parsed.path,
        method: req.method,
        headers: { ...req.headers },
      };

      // Don't forward the host header (let the target set its own)
      delete options.headers.host;

      const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        console.error('Proxy error:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'API server unreachable' }));
      });

      req.pipe(proxyReq);
      return;
    }

    return metroMiddleware(req, res, next);
  };
};

module.exports = config;
