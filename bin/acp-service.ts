#!/usr/bin/env node
import { serveAcpService } from '../src/server.js';
import { attachProcessSignalHandlers } from '../src/bridge.js';

function parseArgs(args: string[]): {
  port?: number;
  host?: string;
  report?: boolean;
} {
  const options: { port?: number; host?: string; report?: boolean } = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' || arg === '-p') {
      const val = args[++i];
      if (val) options.port = Number.parseInt(val, 10);
    } else if (arg === '--host' || arg === '-h') {
      options.host = args[++i];
    } else if (arg === '--no-report') {
      options.report = false;
    } else if (arg === '--help') {
      console.log(`用法: acp-service [选项]

选项:
  --port, -p <n>    指定监听端口（默认: 36812）
  --host, -h <ip>   指定绑定 IP（默认: 0.0.0.0）
  --no-report       不向本机 node agent (36908) 报备
  --help            显示帮助信息
`);
      process.exit(0);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

try {
  attachProcessSignalHandlers();
  await serveAcpService(options);
} catch (error) {
  console.error('[acp-service] 启动失败:', error instanceof Error ? error.message : error);
  process.exit(1);
}
