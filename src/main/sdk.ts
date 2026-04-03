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
  console.error('[SDK] DLL 加载失败:', err)
}

export interface SearchResult {
  name: string
  folder: string
}

export function executeQuery(query: string, maxResults = 50): SearchResult[] {
  // --- 修复问题 38: 增加严谨的函数指针检查 (审计建议 #16) ---
  if (!sdk || typeof sdk.isLoaded !== 'function') return []
  
  try {
    if (!sdk.isLoaded()) return []

    // 基础输入脱敏 (审计建议 #6)
    const sanitizedQuery = query.slice(0, 200).replace(/[\x00-\x1F\x7F]/g, '')
    
    if (typeof sdk.setSearch === 'function') sdk.setSearch(sanitizedQuery + ' ext:exe;lnk;url !uninstall !"c:\\windows\\"')
    if (typeof sdk.setRequestFlags === 'function') sdk.setRequestFlags(0x00000001 | 0x00000002) 
    
    if (typeof sdk.query === 'function' && !sdk.query(true)) return []

    const num = typeof sdk.getNumResults === 'function' ? Math.min(sdk.getNumResults(), maxResults) : 0
    const results: SearchResult[] = []

    for (let i = 0; i < num; i++) {
      if (typeof sdk.getFileName === 'function' && typeof sdk.getPath === 'function') {
        results.push({
          name: sdk.getFileName(i),
          folder: sdk.getPath(i)
        })
      }
    }
    return results
  } catch (e) {
    console.error('[SDK] 查询过程发生异常:', e)
    return []
  }
}
