import { collectOnce } from '../collect.ts';
try { console.log(JSON.stringify(await collectOnce(), null, 2)); }
catch (e) { console.error((e as Error).message); process.exitCode = 1; }
// 原框架HTTP连接池会保留连接；本次采集命令结束后不等待空闲连接。
process.exit(process.exitCode || 0);
