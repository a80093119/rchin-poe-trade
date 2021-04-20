'use strict'

import {
  app,
  protocol,
  BrowserWindow,
  globalShortcut
} from 'electron'
import {
  createProtocol,
  installVueDevtools
} from 'vue-cli-plugin-electron-builder/lib'
import {
  autoUpdater
} from 'electron-updater'
import path from 'path'
import hotkeys from "hotkeys-js";
const server = require('./server');
const isDevelopment = process.env.NODE_ENV !== 'production'
const os = require('os')
const localShortcut = require('electron-localshortcut');

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow

// Scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: {
    secure: true,
    standard: true,
    corsEnabled: true,
  }
}])

function createWindow() {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: isDevelopment ? 1500 : 650,
    height: isDevelopment ? 850 : 930,
    minWidth: isDevelopment ? 100 : 600,
    minHeight: 500,
    maxWidth: isDevelopment ? 2000 : 650,
    autoHideMenuBar: true,
    fullscreenable: isDevelopment ? true : false,
    maximizable: true,
    webPreferences: {
      defaultFontFamily: {
        standard: "Microsoft YaHei"
      },
      defaultFontSize: 14,
      nodeIntegration: true,
      webSecurity: false,
      // nodeIntegrationInWorker: true
      // preload: path.join(app.getAppPath(), 'preload.js')
    },
    icon: `${__static}/app.ico`
  })

  mainWindow.removeMenu()

  if (os.platform() === 'darwin' && isDevelopment) {
    BrowserWindow.addDevToolsExtension(
      path.join(os.homedir(), '/Library/Application Support/Google/Chrome/Default/Extensions/nhdogjmejiglipccpnnnanhbledajbpd/5.3.4_6')
    )
  }

  if (process.env.WEBPACK_DEV_SERVER_URL) {
    // Load the url of the dev server if in development mode
    mainWindow.loadURL(process.env.WEBPACK_DEV_SERVER_URL)
    if (!process.env.IS_TEST) mainWindow.webContents.openDevTools()
  } else {
    createProtocol('app')
    // Load the index.html when not in development
    mainWindow.loadURL('app://./index.html')
    autoUpdater.checkForUpdatesAndNotify()
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  localShortcut.register('F5', () => {
    console.log('F5 is pressed, setAlwaysOnTop(true)')
    mainWindow.setOpacity(mainWindow.getOpacity() === 1 ? 0.8 : mainWindow.getOpacity())
    mainWindow.setAlwaysOnTop(true);
  })
  localShortcut.register('F6', () => {
    console.log('F6 is pressed, setAlwaysOnTop(false), setOpacity(1)')
    mainWindow.setOpacity(1)
    mainWindow.setAlwaysOnTop(false);
  })
  localShortcut.register('PageUp', () => {
    console.log('PageUp is pressed, setOpacity(+ 0.05)')
    mainWindow.setOpacity(mainWindow.getOpacity() + 0.05)
  })
  localShortcut.register('PageDown', () => {
    if (mainWindow.getOpacity() <= 0.4) {
      return
    }
    console.log('PageDown is pressed, setOpacity(- 0.05)')
    mainWindow.setOpacity(mainWindow.getOpacity() - 0.05)
  })
}

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    createWindow()
  }
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', async () => {
  if (isDevelopment && !process.env.IS_TEST) {
    // Install Vue Devtools
    // Devtools extensions are broken in Electron 6.0.0 and greater
    // See https://github.com/nklayman/vue-cli-plugin-electron-builder/issues/378 for more info
    // Electron will not launch with Devtools extensions installed on Windows 10 with dark mode
    // If you are not using Windows 10 dark mode, you may uncomment these lines
    // In addition, if the linked issue is closed, you can upgrade electron and uncomment these lines
    // try {
    //   await installVueDevtools()
    // } catch (e) {
    //   console.error('Vue Devtools failed to install:', e.toString())
    // }

  }
  createWindow()
})

// Exit cleanly on request from parent process in development mode.
if (isDevelopment) {
  if (process.platform === 'win32') {
    process.on('message', data => {
      if (data === 'graceful-exit') {
        app.quit()
      }
    })
  } else {
    process.on('SIGTERM', () => {
      app.quit()
    })
  }
}
