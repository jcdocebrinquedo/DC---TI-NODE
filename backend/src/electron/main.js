'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { startServer, bridge } = require('../index');

let mainWindow;

async function createWindow() {
  await startServer();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 680,
    title: 'DC-TI Support Suite',
    autoHideMenuBar: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Captura e exibe logs e erros do console do Angular no terminal
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] ${message} (${sourceId}:${line})`);
  });

  // Desativa DevTools para exibição limpa da interface
  // mainWindow.webContents.openDevTools();

  const url = process.env.ELECTRON_START_URL || 'http://localhost:3000';
  mainWindow.loadURL(url);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
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

