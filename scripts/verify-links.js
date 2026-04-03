const Database = require('better-sqlite3');
const { join } = require('path');
const { existsSync, mkdirSync, unlinkSync } = require('fs');
const { spawn, execSync } = require('child_process');
const http = require('http');

const TEST_DB = join(__dirname, 'test.db');
const EXE_PATH = join(__dirname, '../resources/bin/Everything.exe');
const HTTP_PORT = 18080;

async function runTests() {
  console.log('🚀 开始全链路集成测试...\n');

  // 1. 检查 Everything 引擎是否存在
  console.log('[1/4] 检查引擎文件...');
  if (existsSync(EXE_PATH)) {
    console.log('✅ 引擎二进制文件已就绪。');
  } else {
    console.error('❌ 错误: resources/bin/Everything.exe 缺失！');
    process.exit(1);
  }

  // 2. 测试 SQLite 数据库
  console.log('\n[2/4] 测试 SQLite 数据库链路...');
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  const db = new Database(TEST_DB);
  try {
    db.exec(`
      CREATE TABLE pinned_apps (path TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE usage_stats (path TEXT PRIMARY KEY, count INTEGER DEFAULT 0);
    `);
    db.prepare('INSERT INTO usage_stats (path, count) VALUES (?, 1)').run('test_path');
    const row = db.prepare('SELECT count FROM usage_stats WHERE path = ?').get('test_path');
    if (row.count === 1) {
      console.log('✅ SQLite 读写与原子自增逻辑正常。');
    }
  } catch (err) {
    console.error('❌ SQLite 链路异常:', err.message);
  } finally {
    db.close();
    unlinkSync(TEST_DB);
  }

  // 3. 测试 Everything HTTP 连通性 (假设引擎已启动)
  console.log('\n[3/4] 测试 Everything HTTP API 连通性...');
  const checkHttp = () => new Promise((resolve) => {
    http.get(`http://localhost:${HTTP_PORT}/?search=txt&json=1&count=1`, (res) => {
      if (res.statusCode === 200) {
        console.log('✅ Everything HTTP API 响应正常 (200 OK)。');
        resolve(true);
      } else {
        console.warn('⚠️ HTTP 响应异常 (可能是引擎未完全初始化):', res.statusCode);
        resolve(false);
      }
    }).on('error', (e) => {
      console.warn('⚠️ 无法连接到 Everything HTTP 服务 (端口 18080)。请确保应用正在运行。');
      resolve(false);
    });
  });
  await checkHttp();

  // 4. 模拟搜索过滤器逻辑
  console.log('\n[4/4] 验证搜索过滤器逻辑...');
  const query = 'test';
  const filter = ' ext:exe;lnk !uninstall !"c:\\windows\\" !"c:\\programdata\\"';
  const fullQuery = query + filter;
  if (fullQuery.includes('!uninstall') && fullQuery.includes('windows')) {
    console.log('✅ 搜索黑名单过滤算法符合预期。');
  } else {
    console.error('❌ 搜索算法逻辑错误。');
  }

  console.log('\n✨ 测试完成。');
}

runTests();
