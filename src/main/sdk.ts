import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import koffi from 'koffi'

const binPath = is.dev ? join(process.cwd(), 'resources/bin') : join(process.resourcesPath, 'bin')
const dllPath = join(binPath, 'Everything64.dll')

let sdk: any = null

try {
  const lib = koffi.load(dllPath)
  sdk = {
    setSearch: lib.func('void Everything_SetSearchW(const char16_t *lpSearchString)'),
    query: lib.func('bool Everything_QueryW(bool bWait)'),
    getNumResults: lib.func('uint32_t Everything_GetNumResults()'),
    getFileName: lib.func('const char16_t *Everything_GetResultFileNameW(uint32_t nIndex)'),
    getPath: lib.func('const char16_t *Everything_GetResultPathW(uint32_t nIndex)'),
    setRequestFlags: lib.func('void Everything_SetRequestFlags(uint32_t dwRequestFlags)'),
    getLastError: lib.func('uint32_t Everything_GetLastError()'),
    isLoaded: lib.func('bool Everything_IsDBLoaded()')
  }
} catch (err) {
  console.error('[SDK] DLL Error:', err)
}

export interface SearchResult {
  name: string
  folder: string
}

export function executeQuery(query: string, maxResults = 50): SearchResult[] {
  if (!sdk || !sdk.isLoaded()) return []
  
  try {
    // 增加输入基础验证 (审计报告 #6)
    const sanitizedQuery = query.slice(0, 200).replace(/[\x00-\x1F\x7F]/g, '')
    
    sdk.setSearch(sanitizedQuery + ' ext:exe;lnk;url !uninstall !"c:\\windows\\"')
    sdk.setRequestFlags(0x00000001 | 0x00000002) 
    
    // bWait=true 时，虽然会阻塞，但我们通过 IPC handle 的异步机制外层保护
    if (!sdk.query(true)) return []

    const num = Math.min(sdk.getNumResults(), maxResults)
    const results: SearchResult[] = []

    for (let i = 0; i < num; i++) {
      results.push({
        name: sdk.getFileName(i),
        folder: sdk.getPath(i)
      })
    }
    return results
  } catch (e) {
    console.error('[SDK] Query Error:', e)
    return []
  }
}
