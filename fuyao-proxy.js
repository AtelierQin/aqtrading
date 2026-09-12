#!/usr/bin/env node
/*
 * fuyao-proxy.js — A股交易工作台的可选同花顺浮摇 (fuyao.aicubes.cn) 反代
 *
 * 用途：把浏览器的同源请求转发到浮摇 API，自动注入 X-api-key 头。
 *      这样 key 只存在于本进程的环境变量里，前端代码 / LS 都不会泄露。
 *
 * 启动：
 *   FUYAO_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxx \
 *   FUYAO_PORT=8787 \
 *   node fuyao-proxy.js
 *
 * 浏览器调用示例：
 *   fetch('http://localhost:8787/fuyao/a-share/prices/snapshot?thscodes=600519.SH')
 *
 * 安全：
 *   - 仅绑 loopback (127.0.0.1)，不会暴露给局域网
 *   - 启动时打印 key 后 4 位（便于核对），不会打印完整 key
 *   - 任何非 loopback 的请求直接 403
 *
 * 不依赖任何 npm 包，仅用 Node 内置 http / https。
 */

'use strict';

var http = require('http');
var https = require('https');
var url = require('url');

var API_KEY = process.env.FUYAO_API_KEY || '';
var PORT = parseInt(process.env.FUYAO_PORT || '8787', 10);
var HOST = '127.0.0.1';
var TARGET_HOST = 'fuyao.aicubes.cn';
var TARGET_PATH_PREFIX = '/api'; /* 前端请求 /fuyao/* → 转发到 /api/* */

if (!API_KEY) {
  console.error('[fuyao-proxy] FATAL: 环境变量 FUYAO_API_KEY 未设置');
  console.error('  用法: FUYAO_API_KEY=xxx node fuyao-proxy.js');
  process.exit(1);
}

console.log('[fuyao-proxy] 启动监听 http://' + HOST + ':' + PORT + '/fuyao/...');
console.log('[fuyao-proxy] 转发目标 https://' + TARGET_HOST + TARGET_PATH_PREFIX + '/...');
console.log('[fuyao-proxy] X-api-key 后 4 位: …' + API_KEY.slice(-4));

var server = http.createServer(function (req, res) {
  /* 0. loopback 校验：仅允许 127.0.0.1 */
  var remote = req.socket.remoteAddress || '';
  if (remote.indexOf('127.0.0.1') !== 0 && remote.indexOf('::1') !== 0 && remote !== '::ffff:127.0.0.1') {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('forbidden: only loopback allowed');
    return;
  }

  /* 1. CORS 预检 */
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  /* 2. 仅放行 GET /fuyao/* */
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('method not allowed');
    return;
  }
  var parsed = url.parse(req.url, true);
  if (!parsed.pathname || parsed.pathname.indexOf('/fuyao/') !== 0) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }

  /* 3. 路径透传：/fuyao/a-share/...  →  /api/a-share/... */
  var upstreamPath = TARGET_PATH_PREFIX + parsed.pathname.slice('/fuyao'.length);
  var qs = parsed.search ? parsed.search : '';

  console.log('[fuyao-proxy] ' + req.method + ' ' + parsed.pathname + qs);

  /* 4. 转发到 https://fuyao.aicubes.cn */
  var upstreamReq = https.request({
    hostname: TARGET_HOST,
    port: 443,
    path: upstreamPath + qs,
    method: 'GET',
    headers: {
      'X-api-key': API_KEY,
      'Accept': 'application/json',
      'User-Agent': 'aqtrading-fuyao-proxy/1.0'
    },
    timeout: 8000
  }, function (upstreamRes) {
    /* 透传状态码 + CORS 头 */
    var headers = {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': upstreamRes.headers['content-type'] || 'application/json'
    };
    res.writeHead(upstreamRes.statusCode || 502, headers);
    upstreamRes.pipe(res);
  });
  upstreamReq.on('timeout', function () {
    upstreamReq.destroy(new Error('upstream timeout'));
  });
  upstreamReq.on('error', function (err) {
    console.error('[fuyao-proxy] upstream error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ code: -1, message: 'upstream error: ' + err.message }));
    } else {
      res.end();
    }
  });
  upstreamReq.end();
});

server.listen(PORT, HOST, function () {
  console.log('[fuyao-proxy] ready');
});

server.on('error', function (err) {
  console.error('[fuyao-proxy] listen error:', err.message);
  process.exit(1);
});