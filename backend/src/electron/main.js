'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { adminElevationService } = require('../services/admin-elevation.service');

function ensureElevatedOrRelaunch() {
  if (process.platform !== 'win32') return true;
  if (adminElevationService.isProcessElevated()) {
    adminElevationService.confirmElevation();
    return true;
  }

  // Evita loop infinito caso já tenha sido relançado
  if (process.argv.includes('--elevated-relaunch')) {
    return true;
  }

  const exePath = process.execPath;
  const backendDir = path.resolve(__dirname, '..', '..');
  const args = app.isPackaged
    ? ['--elevated-relaunch']
    : [backendDir, '--elevated-relaunch'];

  const argListPs = args.map(a => `'${a.replace(/'/g, "''")}'`).join(', ');
  const psScript = `Start-Process -FilePath '${exePath.replace(/'/g, "''")}' -ArgumentList @(${argListPs}) -WorkingDirectory '${backendDir.replace(/'/g, "''")}' -Verb RunAs`;
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');

  try {
    const child = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();
    app.exit(0);
    return false;
  } catch (e) {
    console.error('[Elevation] Falha ao elevar para Administrador:', e.message);
    dialog.showErrorBox(
      'Privilégios de Administrador Necessários',
      'O DC-TI Support Suite requer execução como Administrador para operar corretamente.'
    );
    app.exit(1);
    return false;
  }
}

// Garante elevação antes de inicializar o servidor e a janela
if (!ensureElevatedOrRelaunch()) {
  // O processo filho elevado foi iniciado ou o usuário cancelou o UAC
} else {
  const { startServer, bridge } = require('../index');
  const { sessionStore } = require('../services/session.service');

  let mainWindow;

  async function createWindow() {
    const server = await startServer(process.env.PORT ? Number(process.env.PORT) : 0);
    const actualPort = server.address()?.port || 3000;

    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 1000,
      minHeight: 680,
      title: 'DC-TI Support Suite (Administrador)',
      backgroundColor: '#f8fafc',
      autoHideMenuBar: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
      console.log(`[Renderer Console] ${message} (${sourceId}:${line})`);
    });

    const url = process.env.ELECTRON_START_URL || `http://127.0.0.1:${actualPort}`;
    mainWindow.loadURL(url);

    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  }

  function cleanupOnExit() {
    try {
      sessionStore.clear();
      console.log('[SessionStore] Sessão limpa com sucesso no encerramento da aplicação.');
    } catch (e) {
      console.error('[SessionStore] Erro ao limpar sessão ao sair:', e.message);
    }
  }

  app.whenReady().then(createWindow);

  app.on('before-quit', () => {
    cleanupOnExit();
  });

  app.on('window-all-closed', () => {
    cleanupOnExit();
    bridge.stop();
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (mainWindow === null) {
      createWindow();
    }
  });

  process.on('exit', () => {
    cleanupOnExit();
  });

  process.on('SIGINT', () => {
    cleanupOnExit();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    cleanupOnExit();
    process.exit(0);
  });
}
