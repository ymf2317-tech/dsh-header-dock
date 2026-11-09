// dsh-header-dock —— 宿主侧（最小壳）
//
// 这个插件 99% 的活在浏览器里（lib/client.js）。宿主侧只做三件事：
//   1) 作为 cordis 插件被 profile 挂载 —— 只有这样才能让壳把 lib/client.js
//      塞进浏览器模块表（dsh.client.platform = web）；
//   2) GET /header-dock/config 把 cordis.patch.yml 里的 config 递给浏览器侧
//      （浏览器侧拿不到 cordis config，只能走 HTTP）；
//   3) POST/GET /header-dock/report 收/读「验收回执」——只留内存最后一份，
//      不落盘、不写文件（用户约束：插件不许往磁盘写自己的状态）。
//
// 纪律：宿主侧绝不碰 DOM（没有 DOM），也不改任何第三方文件。

import { URL } from 'node:url'
import { readFileSync } from 'node:fs'

export const name = 'header-dock'
// 版本号只保留一份真相：直接读本包 package.json，免得每次发版漏改宿主侧常量
export const version = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  } catch (error) {
    return '0.0.0'
  }
})()
export const inject = []

const DEFAULTS = {
  overflow: true,
  sidebarFold: false,
  sidebarLimit: 6,
  reportEnabled: true,
  debug: false,
}

/** 单份回执的大小上限：足够装下真实设备清单，又不至于让人一口气把 host 内存塞爆。 */
const MAX_REPORT_BYTES = 256 * 1024
const MAX_BODY_BYTES = MAX_REPORT_BYTES + 16 * 1024

function json(res, status, value) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(value))
}

/** 只回显已知键，避免 config 里混进来的未知字段被浏览器侧当真。 */
function publicConfig(cfg) {
  return {
    overflow: cfg.overflow !== false,
    sidebarFold: cfg.sidebarFold === true,
    sidebarLimit: Number.isFinite(cfg.sidebarLimit) ? Math.max(1, Math.round(cfg.sidebarLimit)) : 6,
    reportEnabled: cfg.reportEnabled !== false,
    debug: cfg.debug === true,
  }
}

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...(config || {}) }
  const state = {
    report: null,
    reportAt: 0,
    reportCount: 0,
    reportBytes: 0,
  }

  function log(...args) {
    if (cfg.debug) console.log('[header-dock]', ...args)
  }

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > limit) {
          reject(new Error(`body too large (> ${limit} bytes)`))
          try {
            req.destroy()
          } catch {
            /* ignore */
          }
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })
  }

  function registerRoutes(webServer) {
    if (!webServer || typeof webServer.register !== 'function') {
      log('no webServer; report endpoints unavailable')
      return
    }
    ctx.effect(() =>
      webServer.register({
        kind: 'prefix',
        path: '/header-dock',
        handler: async (req, res) => {
          try {
            // 与 dsh-memory-guard 同款同源校验：只接受本站页面的请求。
            const origin = req.headers.origin
            if (typeof origin === 'string' && origin.length > 0) {
              const expected = `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host}`
              if (origin !== expected) return json(res, 403, { error: 'cross-origin request rejected' })
            }
            const url = new URL(req.url ?? '/', 'http://local')
            const path = url.pathname

            if (path === '/header-dock/ping') {
              return json(res, 200, { ok: true, name, version, at: Date.now() })
            }

            if (path === '/header-dock/config') {
              return json(res, 200, { ok: true, name, version, config: publicConfig(cfg) })
            }

            if (path === '/header-dock/report') {
              if (req.method === 'GET' || req.method === 'HEAD') {
                return json(res, 200, {
                  ok: true,
                  receivedAt: state.reportAt,
                  bytes: state.reportBytes,
                  count: state.reportCount,
                  report: state.report ?? {},
                })
              }
              if (req.method === 'POST') {
                if (cfg.reportEnabled === false) return json(res, 403, { error: 'report endpoint disabled by config' })
                let raw
                try {
                  raw = await readBody(req, MAX_BODY_BYTES)
                } catch (error) {
                  return json(res, 413, { error: error instanceof Error ? error.message : String(error) })
                }
                let parsed
                try {
                  parsed = JSON.parse(raw)
                } catch {
                  return json(res, 400, { error: 'invalid JSON body' })
                }
                const bytes = Buffer.byteLength(raw)
                state.report = parsed
                state.reportAt = Date.now()
                state.reportCount += 1
                state.reportBytes = bytes
                log(`report #${state.reportCount} ${bytes}B`)
                return json(res, 200, { ok: true, at: state.reportAt, bytes })
              }
              if (req.method === 'DELETE') {
                state.report = null
                state.reportAt = 0
                state.reportBytes = 0
                state.reportCount = 0
                return json(res, 200, { ok: true, cleared: true })
              }
              return json(res, 405, { error: `method not allowed: ${req.method}` })
            }

            return json(res, 404, { error: 'not found' })
          } catch (error) {
            return json(res, 500, { error: error instanceof Error ? error.message : String(error) })
          }
        },
      }),
    )
  }

  const webServer = ctx.get('webServer')
  if (webServer) registerRoutes(webServer)
  else if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['webServer'], (scope) => registerRoutes(scope.get('webServer')))
    } catch {
      /* 回执端点是可选的：拿不到 webServer 时浏览器侧静默降级 */
    }
  }

  console.log(`[header-dock] host active: overflow=${cfg.overflow !== false} sidebarFold=${cfg.sidebarFold === true}`)
}
