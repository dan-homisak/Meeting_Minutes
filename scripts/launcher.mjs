import { exec } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const HEARTBEAT_INTERVAL_MS = 4000;
const HEARTBEAT_TIMEOUT_MS = 14000;
const STARTUP_TIMEOUT_MS = 90000;
const WATCHDOG_INTERVAL_MS = 1000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const launcherToken = randomUUID();

const heartbeatState = {
  hasConnected: false,
  lastSeenAt: 0,
  startedAt: Date.now()
};

let shuttingDown = false;
let heartbeatWatchdog = null;

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

      if (!isHeartbeatEndpoint) {
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

  const localUrl = server.resolvedUrls?.local?.[0];
  if (!localUrl) {
    throw new Error('Vite did not provide a local URL.');
  }

  const launchUrl = new URL(localUrl);
  launchUrl.searchParams.set('launcherToken', launcherToken);

  console.log(`Starting Meeting Minutes at ${launchUrl.toString()}`);
  console.log(`Heartbeat interval: ${HEARTBEAT_INTERVAL_MS}ms`);
  console.log(
    `Auto-shutdown: ${HEARTBEAT_TIMEOUT_MS}ms after last browser heartbeat.`
  );

  openBrowser(launchUrl.toString());

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
