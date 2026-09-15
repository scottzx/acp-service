# @1agents/acp-service

> DreamMate Network 的 **ACP Agent Runtime Service**：为 Claude Code、Grok、Codex 等 ACP 智能体提供统一的持久化执行、会话重绑与全双工 WebSocket 桥接服务。
> 默认监听 **36812** 端口，向本机 `dreammate-node`（固定 36908）自动报备与接受探活。

---

## 架构定位

在 DreamMate Network 四层体系中，`acp-service` 作为平级的执行平面（L1/L2 运行时服务）存在：

```
        Control Plane / Web 客户端 / IM 网关
                         │
                         ├─ 1. 探 36908 发现服务与端口
                         ▼
             ┌───────────────────────┐
             │    dreammate-node     │ ◄── 固定 36908 (L0.5 基础设施)
             └───────────▲───────────┘
                         │ 2. 报备 & /health 周期探活
             ┌───────────┴───────────┐
             │      acp-service      │ ◄── 3. 直连 36812 执行 ACP 全双工会话
             │      (默认 36812)       │
             ├───────────────────────┤
             │ 底座依赖:              │
             │  - @scottzx/1acp      │ (携带 Grok _x.ai/* 与 Claude Auth-Env 治理)
             │  - dreammate-network  │ (L0 协议契约)
             │  - dreammate-node     │ (节点身份与客户端报备)
             └───────────────────────┘
```

- **单端口复用**：
  - `GET /health`：存活探针，报告 node_id、当前活跃会话数与后台任务数。
  - `GET /manifest`：DreamMate Network 标准节点清单。
  - `WebSocket ws://<host>:36812/`：升级并接管 ACP JSON-RPC 消息流。

---

## 安装与运行

### 1. 全局安装或作为 CLI 运行

```bash
cd services/acp-service
npm install
npm run build

# 启动服务（默认监听 0.0.0.0:36812，自动向 36908 报备）
npm start

# 或使用 CLI 任意指定参数
node dist/bin/acp-service.js --port 36812 --host 0.0.0.0

# 单机调试（仅本地回环可见，不向 node-agent 报备）
node dist/bin/acp-service.js --host 127.0.0.1 --no-report
```

### 2. 作为库引入

```ts
import { serveAcpService } from '@1agents/acp-service';

const { port, server, close } = await serveAcpService({
  port: 36812,
  host: '0.0.0.0',
  report: true, // 启动时自动向 dreammate-node (36908) 报备
});

console.log(`ACP Service running on port ${port}`);
```

---

## 暴露的能力与接口

### 1. HTTP 探测接口

- `GET http://<host>:36812/health`
  ```json
  {
    "status": "ok",
    "node_id": "nigVtDS1s521CNTRL",
    "service": "acp-service",
    "kind": "agent_runtime",
    "sessions": 0,
    "background_tasks": 0,
    "uptime": 12.34
  }
  ```

- `GET http://<host>:36812/manifest`
  返回符合 `@1agents/dreammate-network` 规范的完整 Manifest。

### 2. WebSocket 动作接口（ACP 桥接）

客户端建立 `ws://<host>:36812/` 连接后，发送 JSON 消息：

| 动作 (`action`) | 描述 | 关键参数 |
| :--- | :--- | :--- |
| `ensure_session` | 创建或恢复 ACP 会话 | `sessionId`, `workspacePath`, `agentType`, `permissionMode`, `responsePolicy` |
| `prompt` | 发送用户提示词与附件 | `sessionId`, `text`, `attachments`, `responsePolicy` |
| `respond_permission` | 响应工具调用的权限审批 | `sessionId`, `requestId`, `decision` |
| `respond_ask_user_question` | 响应 Grok `_x.ai/ask_user_question` | `sessionId`, `requestId`, `answers` |
| `respond_exit_plan_mode` | 响应 Grok `_x.ai/exit_plan_mode` | `sessionId`, `requestId`, `decision` |
| `set_permission_mode` | 运行时调整权限等级 | `sessionId`, `mode` (`approve-reads`, `yolo` 等) |
| `cancel_turn` | 取消当前正在执行的轮次 | `sessionId` |
| `get_history` | 获取当前会话权威历史切片 | `sessionId` |
| `close_session` | 结束并销毁会话 | `sessionId` |

### 3. `responsePolicy`：人机流式 vs 智能体摘要

`ensure_session` 与 `prompt` 都接受可选字段 `responsePolicy`：

| 值 | 默认 | 适用 | 线上推送 |
| :--- | :--- | :--- | :--- |
| `stream` | 是 | 人类 UI（Web Chat、终端） | 全量 `text_delta` / `tool_call` / `turn_state` |
| `summary` | 否 | 设备 B 上的调度 Agent | 轮次结束只推 `turn_complete` + `done`，附带 `sessionRef` |

```json
{
  "action": "prompt",
  "sessionId": "task-456",
  "text": "重构 backend/server.go 的鉴权逻辑",
  "responsePolicy": "summary"
}
```

`summary` 结束时的收敛事件：

```json
{
  "event": "turn_complete",
  "sessionId": "task-456",
  "status": "completed",
  "responsePolicy": "summary",
  "resultText": "已重构鉴权逻辑，修改了 2 个文件，测试通过。",
  "sessionRef": {
    "sessionId": "task-456",
    "turnId": 5,
    "sessionReaderUrl": "http://<device-A>:7777"
  }
}
```

权限审批、`ask_user_question`、`exit_plan_mode` 仍会实时下发——否则轮次会卡住。需要推理日志或工具细节时，用 `sessionRef.sessionReaderUrl` 走 `1session` / session-reader 按需下钻。

Manifest 能力位：`agent.response_policy`。

---

## 协议与底层支持

- **Claude Code**：支持第三方 Anthropic 兼容端点，通过 `1acp` 的 `auth-env.ts` 自动清洗 `ANTHROPIC_AUTH_TOKEN` 与 `ANTHROPIC_API_KEY`，规避握手挂死。
- **Grok Build**：原生支持 `_x.ai/ask_user_question` 问答扩展与 `_x.ai/exit_plan_mode` 退出计划模式扩展。
- **Codex / Gemini / OpenClaw 等**：支持标准 ACP 子进程生命周期调度。
