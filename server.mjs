import 'dotenv/config';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Clocked } from 'clocked-sdk';

if (!process.env.CLOCKED_API_KEY?.trim()) {
  console.error('错误：没有读取到 CLOCKED_API_KEY，请检查 .env 文件。');
  process.exit(1);
}

const clocked = new Clocked({
  timeout: 120000,
  maxAttempts: 1,
});

const htmlPath = resolve('public', 'index.html');
const HOST = '127.0.0.1';
const PORT = 3000;

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);

  if (req.method === 'GET' &&
      (url.pathname === '/' || url.pathname === '/index.html')) {
    try {
      const html = await readFile(htmlPath);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(html);
    } catch {
      sendJson(res, 500, {
        ok: false,
        error: '网页文件不存在，请检查 public/index.html。',
      });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/extract') {
    let raw = '';

    try {
      for await (const chunk of req) {
        raw += chunk.toString('utf8');

        if (Buffer.byteLength(raw, 'utf8') > 25000) {
          sendJson(res, 413, {
            ok: false,
            error: '请求内容过长，请缩短文本后再试。',
          });
          return;
        }
      }

      const body = JSON.parse(raw);
      const text = typeof body.text === 'string'
        ? body.text.trim()
        : '';
      const idempotencyKey = body.idempotencyKey;

      if (!text || text.length > 20000) {
        sendJson(res, 400, {
          ok: false,
          error: '请输入文本，长度不能超过20000个字符。',
        });
        return;
      }

      if (
        typeof idempotencyKey !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idempotencyKey)
      ) {
        sendJson(res, 400, {
          ok: false,
          error: '请求标识无效，请刷新页面后重试。',
        });
        return;
      }

      const result = await clocked.extract(
        {
          text,
          fields: {
            deadline: '报名或活动截止日期和时间',
            team_rule: '个人或团队参赛要求',
            age_requirement: '最低年龄要求',
            rewards: '奖金、奖品或额度奖励',
            required_materials: '必须提交的材料',
          },
        },
        {
          idempotencyKey,
          timeout: 120000,
          maxAttempts: 1,
        }
      );

      sendJson(res, 200, {
        ok: true,
        data: result.data,
        modelMs: result.modelMs,
        status: result.status,
      });
    } catch (error) {
      console.error(
        '请求失败：',
        error.name || 'Error',
        error.message || '未知错误'
      );

      sendJson(res, 502, {
        ok: false,
        error: '提取请求失败。请查看 PowerShell 错误信息，暂时不要连续重试。',
      });
    }

    return;
  }

  sendJson(res, 404, {
    ok: false,
    error: '接口不存在。',
  });
});

server.listen(PORT, HOST, () => {
  console.log('小羽可信文档核验助手已启动');
  console.log(`本地网页：http://${HOST}:${PORT}`);
  console.log('API Key 仅保存在服务端环境变量中。');
});

server.on('error', (error) => {
  console.error('服务器启动失败：', error.message);
  process.exitCode = 1;
});
