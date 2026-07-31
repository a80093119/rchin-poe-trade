'use strict'

import { app, protocol, BrowserWindow, globalShortcut, desktopCapturer, screen } from 'electron'
import { createProtocol } from 'vue-cli-plugin-electron-builder/lib'
import { autoUpdater } from 'electron-updater'
import installExtension, { VUEJS_DEVTOOLS } from 'electron-devtools-installer'
import { ipcMain } from 'electron'
import localShortcut from 'electron-localshortcut'
const isDevelopment = process.env.NODE_ENV !== 'production'
const server = require('./server')

// 傭兵契約書 tooltip 截圖：一律由 renderer 偵測 Ctrl+C 契約書後透過 'capture_screen' 觸發
// （已移除 F8 全域快捷鍵，統一用 Ctrl+C 判斷）。
// 傭兵 OCR 功能總開關（隱私考量，預設關閉）：關閉時 'capture_screen' 直接拒絕，不截圖。
// 由 renderer 於啟動與切換時透過 'set_merc_ocr_enabled' 同步。
let mercOcrEnabled = false

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

// 抓「游標所在螢幕」的全解析度畫面，回傳 NativeImage 與該螢幕的邊界資訊
async function captureCursorScreen() {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const scale = display.scaleFactor || 1
  // desktopCapturer 的 thumbnailSize 以「實際像素」為單位，需把 DIP 尺寸乘上縮放
  const thumbnailSize = {
    width: Math.round(display.size.width * scale),
    height: Math.round(display.size.height * scale)
  }
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize })
  // 盡量對應到游標所在的那一台顯示器；對不到就退回第一個來源
  const source =
    sources.find(s => String(s.display_id) === String(display.id)) || sources[0]
  if (!source) {
    throw new Error('desktopCapturer 沒有回傳任何螢幕來源')
  }
  return {
    image: source.thumbnail,
    display,
    cursor,
    scale
  }
}

// 截圖 → 直接把 dataURL 送給 renderer 做 OCR / 預覽（不存檔到硬碟，避免資料堆積）
async function captureForOcr() {
  try {
    const { image, display, cursor, scale } = await captureCursorScreen()
    const size = image.getSize()
    console.log('[capture] captured size:', size, 'cursor:', cursor, 'scale:', scale)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('capture_done', {
        size,
        cursor,
        scale,
        displayBounds: display.bounds,
        dataURL: image.toDataURL()
      })
    }
    return { size }
  } catch (err) {
    console.error('[capture] failed:', err)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('capture_error', (err && err.message) || String(err))
    }
    return { error: (err && err.message) || String(err) }
  }
}

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
      contextIsolation: false,
      // nodeIntegrationInWorker: true
      // preload: path.join(app.getAppPath(), 'preload.js')
    },
    icon: `${__static}/app.ico`
  })

  mainWindow.removeMenu()

  if (process.env.WEBPACK_DEV_SERVER_URL) {
    // Load the url of the dev server if in development mode
    mainWindow.loadURL(process.env.WEBPACK_DEV_SERVER_URL)
    if (!process.env.IS_TEST) mainWindow.webContents.openDevTools()
  } else {
    createProtocol('app')
    // Load the index.html when not in development
    mainWindow.loadURL('app://./index.html')
    // 啟動時檢查更新
    autoUpdater.checkForUpdatesAndNotify()
  }

  // 轉發更新事件到 Renderer
  autoUpdater.on('checking-for-update', () => {
    mainWindow && mainWindow.webContents.send('update_checking')
  })
  autoUpdater.on('update-available', (info) => {
    mainWindow && mainWindow.webContents.send('update_available', info)
  })
  autoUpdater.on('update-not-available', (info) => {
    mainWindow && mainWindow.webContents.send('update_not_available', info)
  })
  autoUpdater.on('download-progress', (progress) => {
    mainWindow && mainWindow.webContents.send('update_download_progress', progress)
  })
  autoUpdater.on('update-downloaded', (info) => {
    mainWindow && mainWindow.webContents.send('update_downloaded', info)
  })
  autoUpdater.on('error', (err) => {
    mainWindow && mainWindow.webContents.send('update_error', err == null ? 'unknown' : (err.stack || err).toString())
  })

  ipcMain.on('restart_app', () => {
    autoUpdater.quitAndInstall()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  localShortcut.register('F5', () => {
    console.log('F5 is pressed, setAlwaysOnTop(true)')
    mainWindow.setOpacity(mainWindow.getOpacity() === 1 ? 0.8 : mainWindow.getOpacity())
    mainWindow.setAlwaysOnTop(true, 'normal')
  })
  localShortcut.register('F6', () => {
    console.log('F6 is pressed, setAlwaysOnTop(false), setOpacity(1)')
    mainWindow.setOpacity(1)
    mainWindow.setAlwaysOnTop(false)
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

  // 傭兵 OCR 總開關：renderer 於啟動與切換時同步過來（決定 capture_screen 是否放行截圖）
  ipcMain.on('set_merc_ocr_enabled', (_e, v) => {
    mercOcrEnabled = !!v
  })

  // 讓 renderer 也能主動要求截圖（回傳 dataURL 供後續 OCR）；關閉時拒絕，避免任何截圖
  ipcMain.handle('capture_screen', async () => {
    if (!mercOcrEnabled) return { disabled: true }
    return captureForOcr()
  })

  // 開發用：把 renderer 端的 log 轉發到 main process 終端機（通用，非傭兵專屬）
  ipcMain.on('renderer_log', (_e, tag, payload) => {
    console.log(tag, typeof payload === 'string' ? payload : JSON.stringify(payload))
  })

  // 在 app 內開官方登入視窗 → 登入成功後自動讀取 POESESSID cookie 回傳給 renderer，
  // 免去使用者手動從瀏覽器複製。用哪個服由 renderer 傳 baseUrl 決定。
  // 安全強化：
  //   1) 鎖網域——只允許停留在「官方站 + 常見登入提供者（Steam/Google/Twitch/Garena）」，
  //      其餘一律擋下（避免被導去釣魚頁）。第三方登入需導到官方站以外，故用白名單而非只准官方。
  //   2) 標題列即時顯示目前網址，讓使用者親眼確認是官方站。
  //   3) 只讀「官方站網域」的 POESESSID 這一個 cookie，且只在「回到官方站」時擷取
  //      （避開匿名 session 與第三方登入中途）。全程不注入 JS、不讀密碼欄位。
  ipcMain.handle('acquire_poesessid', async (_e, payload) => {
    const baseUrl = (payload && payload.baseUrl) || 'https://www.pathofexile.com'
    let officialHost = 'www.pathofexile.com'
    try { officialHost = new URL(baseUrl).host } catch (e) { /* keep default */ }
    // ⚠ 不要攔截導覽、也不要覆寫 User-Agent（兩者都會弄壞 Cloudflare 驗證）：
    //   - 覆寫 UA → Turnstile 因「UA 與實際引擎指紋不符」一直循環驗證。
    //   - 攔截導覽（鎖網域）→ Turnstile 驗證通過後需導頁完成，會被 preventDefault 擋住而卡在「驗證成功」畫面。
    //   Cloudflare 保護的站台與「鎖網域」本質不相容，故移除攔截。
    //   保留真正無害的保護：標題列顯示目前網址、POESESSID cookie 只從官方站網域讀取。
    const hostOf = (u) => { try { return new URL(u).host } catch (e) { return '' } }
    const inList = (host, list) => !!host && list.some(s => host === s || host.endsWith('.' + s))
    const isOfficial = (u) => inList(hostOf(u), [officialHost, 'pathofexile.com', 'pathofexile.tw'])
    return await new Promise((resolve) => {
      let loginWin = new BrowserWindow({
        width: 1000,
        height: 820,
        autoHideMenuBar: true,
        // 不設 parent：以獨立頂層視窗開啟，較接近一般瀏覽器分頁，降低 Cloudflare 誤判機率
        title: '登入官網取得 POESESSID（只讀此登入憑證、不讀密碼）',
        webPreferences: { nodeIntegration: false, contextIsolation: true }
      })
      const ses = loginWin.webContents.session
      let settled = false
      const finish = (val) => {
        if (settled) return
        settled = true
        try { if (loginWin && !loginWin.isDestroyed()) loginWin.close() } catch (e) { /* ignore */ }
        loginWin = null
        resolve(val || null)
      }
      // 標題列顯示目前網址供使用者核對
      const showUrl = () => {
        try { if (loginWin && !loginWin.isDestroyed()) loginWin.setTitle(`目前網址：${loginWin.webContents.getURL()}`) } catch (e) { /* ignore */ }
      }
      const tryGrab = async (url) => {
        showUrl()
        if (/\/login\b/i.test(url || '')) return // 還在登入頁 → 尚未登入，不抓
        if (!isOfficial(url)) return // 只在回到官方站時擷取（第三方登入中途不抓）
        try {
          const cookies = await ses.cookies.get({ url: baseUrl, name: 'POESESSID' }) // 限定官方站網域
          const sid = cookies && cookies.length ? cookies[0].value : null
          if (sid) finish(sid)
        } catch (e) { /* 等下一次導覽再試 */ }
      }
      loginWin.webContents.on('did-navigate', (_evt, url) => tryGrab(url))
      loginWin.webContents.on('did-redirect-navigation', (_evt, url) => tryGrab(url))
      loginWin.webContents.on('did-navigate-in-page', () => showUrl())
      loginWin.on('closed', () => finish(null)) // 使用者自行關閉視窗 = 取消
      loginWin.loadURL(`${baseUrl}/login`)
    })
  })
}

// 退出前解除全域快捷鍵，避免殘留佔用
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 啟動前確認是否有其他實例正在運行
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_, __, ___) => { // (event, commandLine, workingDirectory)
    // 當第二個實例啟動時，將焦點設定回主視窗
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.on('activate', () => {
    if (mainWindow === null) {
      createWindow()
    }
  })
}

app.whenReady().then(() => {
  installExtension(VUEJS_DEVTOOLS)
    .then((name) => console.log(`Added Extension:  ${name}`))
    .catch((err) => console.log('An error occurred: ', err))
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
    //   await installExtension(VUEJS_DEVTOOLS)
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
