const koffi = require('koffi');
const path = require('path');
const { spawn } = require('child_process');

const binPath = path.join(__dirname, '../resources/bin');
const dllPath = path.join(binPath, 'Everything64.dll');
const exePath = path.join(binPath, 'Everything.exe');

console.log('--- 🧪 Everything SDK 独立诊断程序 ---');
console.log('1. 正在启动 Everything 引擎...');

const engine = spawn(exePath, ['-minimized'], { detached: true, stdio: 'ignore' });
engine.unref();

// 给引擎 2 秒钟初始化索引
setTimeout(() => {
    console.log('2. 正在加载 DLL:', dllPath);
    
    try {
        const lib = koffi.load(dllPath);
        
        const setSearch = lib.func('void Everything_SetSearchW(const char16_t *lpSearchString)');
        const query = lib.func('bool Everything_QueryW(bool bWait)');
        const getNumResults = lib.func('uint32_t Everything_GetNumResults()');
        const getFileName = lib.func('const char16_t *Everything_GetResultFileNameW(uint32_t nIndex)');
        const getPath = lib.func('const char16_t *Everything_GetResultPathW(uint32_t nIndex)');
        const setRequestFlags = lib.func('void Everything_SetRequestFlags(uint32_t dwRequestFlags)');
        const getLastError = lib.func('uint32_t Everything_GetLastError()');

        console.log('✅ DLL 函数映射成功。');

        const testQuery = 'exe';
        console.log(`3. 正在测试搜索关键字: "${testQuery}"...`);

        setSearch(testQuery);
        setRequestFlags(0x00000001 | 0x00000002); // FileName | Path
        
        const success = query(true);
        if (!success) {
            console.error('❌ 搜索失败，错误代码:', getLastError());
            process.exit(1);
        }

        const count = getNumResults();
        console.log(`✅ 搜索成功！找到总数: ${count}`);

        const displayCount = Math.min(count, 5);
        console.log(`--- 前 ${displayCount} 条结果预览 ---`);
        for (let i = 0; i < displayCount; i++) {
            const name = getFileName(i);
            const folder = getPath(i);
            console.log(`[${i + 1}] ${folder}\\${name}`);
        }

        console.log('\n✨ SDK 链路完全畅通！可以进行前端集成。');
        process.exit(0);

    } catch (err) {
        console.error('❌ 严重错误:', err.message);
        process.exit(1);
    }
}, 2000);
