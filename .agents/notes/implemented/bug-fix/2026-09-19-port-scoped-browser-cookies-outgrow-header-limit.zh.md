# Agent Note：按端口作用域的浏览器会话 cookie 超出服务器头大小上限，导致 Electron 启动失败

状态：已实现

[English](2026-09-19-port-scoped-browser-cookies-outgrow-header-limit.md) | 中文

## 问题

Electron 启动会卡在启动页的 "Failed to load plugins"，报 62 个包的
application 组合 `bundle script /plugins/??... failed to load`，而 web
profile 启动正常。失败的 URL 在同一运行中的宿主上用裸 curl 返回 200，
排除了模块图与重建机制，并在全新 Electron 实例中稳定复现。页面内对该
URL 的 `fetch` 返回 HTTP `431 Request Header Fields Too Large`；CDP 显示
请求头合计 14 872+ 字节，其中 `Cookie` 头是 14 362 字节累积的
`dsh-auth-*` cookie。

根因：`BrowserAuth.authorizeIndex` 会种一个名称派生自请求 authority 的
30 天持久 cookie，而 `requestAuthority` 包含端口。web 启动器绑定固定端口
（3080），cookie 名稳定、每次启动覆盖；Electron 每次启动分配新端口，因此
每次启动都会在 host-only 的 `127.0.0.1` 域内新增一个持久 cookie。启动次数
足够多后，累积的 Cookie 头（加上请求目标里的 2.8 KiB combo URL）越过
node:http 默认 16 KiB 的 `maxHeaderSize`；服务器回 431，浏览器把脚本报告
为加载失败，启动页显示失败。小的 bootstrap/workspace 组合保持在限制内，
因此只有大型 application 组合失败。

## 决策

确定性 cookie 名现在只绑定规范化 hostname（`cookieAuthority` 去掉端口）；
`BrowserAuth` 在每个端口上签发并读取同一个 host-only 名，因此每次启动
覆盖 cookie 而不是累积一个。签名 payload 仍绑定 hostname 加端口，所以另
一个端口签发的 cookie 会被 authority 校验拒绝——跨端口加固不回退。
webserver 的 `createServer` 现在传入 `maxHeaderSize: 64 KiB`：旧的按端口
作用域 cookie 名残留期间会随每个请求继续发送（直到 30 天过期），调高
预算可容忍这些残留，同时不会为无关的超大请求放行。

## 备选方案

单独调高头大小上限的方案被否决：它只是把失败推迟几天，cookie 仍会按
启动次数继续累积。去掉持久 cookie（仅会话级）的方案被否决：重启浏览器
标签页访问正在运行的 web profile 时会丢失会话，需要重新粘贴打印的
token URL。在 token 交换时清 cookie 的方案被否决：HTTP 没有能够在清空
整个 origin 的同时保留同响应刚签发 cookie 的单响应机制。

## 后果

Electron（以及任何使用新端口的启动器）现在每个 host 只发送一个有界的
host-only 浏览器会话 cookie；旧名会在 30 天内自然过期，调高的头预算在
此期间容纳它们。一个行为变化：同一 host 上同时运行的启动器（例如 web
profile 与 Electron 实例并存）共用同一个 cookie 名，后启动者覆盖先启动
者，先启动页面的下一次刷新会重新进入 token 交换——对 profile 所假设的
单实例使用方式可接受。验证方式：清掉累积的 Electron cookie 后启动未改
构建，应用正常启动到完整 UI；6 个 browser-auth 测试（含一条新回归：
不同端口产出同一个名、跨端口 cookie 仍不被授权）以及 connection/
webserver 全套 168 个测试通过，开发构建干净完成。