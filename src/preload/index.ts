import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  search: (query: string) => ipcRenderer.invoke('search', query),
  launch: (path: string) => ipcRenderer.send('launch', path),
  hideWindow: () => ipcRenderer.send('hide-window'),
  getPinnedApps: () => ipcRenderer.invoke('get-pinned-apps'),
  updateAppPosition: (path: string, index: number) => ipcRenderer.invoke('update-app-position', { path, index }),
  pinApp: (item: any, index?: number) => ipcRenderer.invoke('pin-app', { item, index }),
  unpinApp: (path: string) => ipcRenderer.invoke('unpin-app', path),
  selectFile: () => ipcRenderer.invoke('select-file'),
  processPaths: (paths: string[]) => ipcRenderer.invoke('process-paths', paths),
  onWindowShown: (callback: any) => {
    const sub = () => callback()
    ipcRenderer.on('window-shown', sub)
    return () => ipcRenderer.removeListener('window-shown', sub)
  },
  // --- 性能优化: 监听图标更新推送 ---
  onIconUpdate: (callback: (data: { path: string, icon: string }) => void) => {
    const sub = (_: any, data: any) => callback(data)
    ipcRenderer.on('icon-update', sub)
    return () => ipcRenderer.removeListener('icon-update', sub)
  },
  getHotkey: () => ipcRenderer.invoke('get-hotkey'),
  setHotkey: (h: string) => ipcRenderer.invoke('set-hotkey', h)
}

if (typeof contextBridge !== 'undefined' && contextBridge.exposeInMainWorld) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) { console.error(error) }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
