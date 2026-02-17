import { exec } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const HEARTBEAT_INTERVAL_MS = 4000;
const HEARTBEAT_TIMEOUT_MS = 14000;
const STARTUP_TIMEOUT_MS = 90000;
const WATCHDOG_INTERVAL_MS = 1000;
const LIVE_DEBUG_MAX_BODY_BYTES = 2_000_000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const launcherToken = randomUUID();
const launchStamp = new Date().toISOString().replace(/[:.]/g, '-');
const liveDebugLogDirectory = path.join(projectRoot, 'logs');
const liveDebugLogFile = path.join(
  liveDebugLogDirectory,
  `live-debug-${launchStamp}-${launcherToken.slice(0, 8)}.jsonl`
);
const shouldOpenBrowser = process.env.LAUNCHER_NO_OPEN !== '1';
const disableAutoShutdown = process.env.LAUNCHER_NO_TIMEOUT === '1';

const heartbeatState = {
  hasConnected: false,
  lastSeenAt: 0,
  startedAt: Date.now()
};

let shuttingDown = false;
let heartbeatWatchdog = null;

async function appendLiveDebugRecords(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return;
  }

  await mkdir(liveDebugLogDirectory, {
    recursive: true
  });

  const payload = records.map((record) => JSON.stringify(record)).join('\n');
  await appendFile(liveDebugLogFile, `${payload}\n`, 'utf8');
}

function readRequestBody(req, maxBytes = LIVE_DEBUG_MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        reject(new Error('payload-too-large'));
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    req.on('error', (error) => {
      reject(error);
    });
  });
}

function normalizeLiveDebugRecord({
  sessionId,
  reason,
  appPath,
  currentPath,
  viewMode,
  entry,
  userAgent,
  remoteAddress
}) {
  return {
    receivedAt: new Date().toISOString(),
    source: 'browser-live-debug',
    sessionId,
    reason,
    appPath,
    currentPath,
    viewMode,
    userAgent,
    remoteAddress,
    entry
  };
}

const launcherPlugin = {
  name: 'launcher-heartbeat',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (!req.url) {
        next();
        return;
      }

      const requestUrl = new URL(req.url, 'http://127.0.0.1');
      const isHeartbeatEndpoint =
        requestUrl.pathname === '/__launcher/heartbeat' ||
        requestUrl.pathname === '/__launcher/disconnect';
      const isLiveDebugEndpoint = requestUrl.pathname === '/__launcher/live-debug';

      if (!isHeartbeatEndpoint && !isLiveDebugEndpoint) {
        next();
        return;
      }

      const token = requestUrl.searchParams.get('token');
      if (token !== launcherToken) {
        res.statusCode = 403;
        res.setHeader('content-type', 'application/json');
        res.end('{"ok":false,"reason":"invalid-token"}');
        return;
      }

      heartbeatState.hasConnected = true;
      heartbeatState.lastSeenAt = Date.now();

      if (isLiveDebugEndpoint) {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('content-type', 'application/json');
          res.end('{"ok":false,"reason":"method-not-allowed"}');
          return;
        }

        void (async () => {
          try {
            const rawBody = await readRequestBody(req);
            const payload = rawBody ? JSON.parse(rawBody) : {};
            const entries = Array.isArray(payload.entries) ? payload.entries : [];
            const sessionId =
              typeof payload.sessionId === 'string' && payload.sessionId.trim()
                ? payload.sessionId.trim()
                : 'unknown-session';
            const reason = typeof payload.reason === 'string' ? payload.reason : 'unspecified';
            const appPath = typeof payload.appPath === 'string' ? payload.appPath : '';
            const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '';
            const remoteAddress = req.socket?.remoteAddress ?? '';

            const normalizedRecords = entries
              .slice(0, 2000)
              .map((record) =>
                normalizeLiveDebugRecord({
                  sessionId,
                  reason,
                  appPath,
                  currentPath:
                    typeof record?.currentPath === 'string' ? record.currentPath : '',
                  viewMode: typeof record?.viewMode === 'string' ? record.viewMode : '',
                  entry: record?.entry ?? record,
                  userAgent,
                  remoteAddress
                })
              );

            await appendLiveDebugRecords(normalizedRecords);

            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(
              JSON.stringify({
                ok: true,
                accepted: normalizedRecords.length,
                logFile: path.relative(projectRoot, liveDebugLogFile)
              })
            );
          } catch (error) {
            const reason =
              error instanceof Error && error.message ? error.message : 'invalid-live-debug-payload';
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, reason }));
          }
        })();
        return;
      }

      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end('{"ok":true}');
    });
  }
};

function openBrowser(url) {
  const encoded = `"${url}"`;

  if (process.platform === 'darwin') {
    exec(`open ${encoded}`);
    return;
  }

  if (process.platform === 'win32') {
    exec(`start "" ${encoded}`, { shell: 'cmd.exe' });
    return;
  }

  exec(`xdg-open ${encoded}`);
}

async function shutdown(server, reason) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  if (heartbeatWatchdog) {
    clearInterval(heartbeatWatchdog);
  }

  console.log(reason);
  try {
    await appendLiveDebugRecords([
      {
        receivedAt: new Date().toISOString(),
        source: 'launcher',
        event: 'shutdown',
        reason
      }
    ]);
  } catch (error) {
    console.error('Could not write shutdown log record:', error);
  }

  try {
    await server.close();
  } catch (error) {
    console.error('Error while closing Vite server:', error);
  }

  process.exit(0);
}

async function main() {
  const server = await createServer({
    root: projectRoot,
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: false
    },
    plugins: [launcherPlugin]
  });

  await server.listen();
  try {
    await appendLiveDebugRecords([
      {
        receivedAt: new Date().toISOString(),
        source: 'launcher',
        event: 'startup',
        tokenPrefix: launcherToken.slice(0, 8)
      }
    ]);
  } catch (error) {
    console.error('Could not write startup log record:', error);
  }

  const localUrl = server.resolvedUrls?.local?.[0];
  if (!localUrl) {
    throw new Error('Vite did not provide a local URL.');
  }

  const launchUrl = new URL(localUrl);
  launchUrl.searchParams.set('launcherToken', launcherToken);

  console.log(`Starting Meeting Minutes at ${launchUrl.toString()}`);
  console.log(`Heartbeat interval: ${HEARTBEAT_INTERVAL_MS}ms`);
  if (disableAutoShutdown) {
    console.log('Auto-shutdown disabled (LAUNCHER_NO_TIMEOUT=1).');
  } else {
    console.log(
      `Auto-shutdown: ${HEARTBEAT_TIMEOUT_MS}ms after last browser heartbeat.`
    );
  }
  console.log(`Live debug log file: ${liveDebugLogFile}`);

  if (shouldOpenBrowser) {
    openBrowser(launchUrl.toString());
  } else {
    console.log('Browser auto-open disabled (LAUNCHER_NO_OPEN=1).');
  }

  if (!disableAutoShutdown) {
    heartbeatWatchdog = setInterval(() => {
      if (!heartbeatState.hasConnected) {
        if (Date.now() - heartbeatState.startedAt > STARTUP_TIMEOUT_MS) {
          void shutdown(
            server,
            'No browser connection detected. Shutting down Meeting Minutes launcher.'
          );
        }
        return;
      }

      const staleForMs = Date.now() - heartbeatState.lastSeenAt;
      if (staleForMs < HEARTBEAT_TIMEOUT_MS) {
        return;
      }

      void shutdown(
        server,
        'No browser heartbeat detected. Shutting down Meeting Minutes launcher.'
      );
    }, WATCHDOG_INTERVAL_MS);
  }

  process.on('SIGINT', () => {
    void shutdown(server, 'Stopping launcher (SIGINT).');
  });

  process.on('SIGTERM', () => {
    void shutdown(server, 'Stopping launcher (SIGTERM).');
  });
}

main().catch((error) => {
  console.error('Launcher failed to start:', error);
  process.exit(1);
});
