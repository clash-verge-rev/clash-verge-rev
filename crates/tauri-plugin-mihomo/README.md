# Tauri Plugin mihomo

一个基于 Tauri 框架的调用 Mihomo API 插件，支持 Mihomo 的 HTTP 和 Socket 通信

### 测试 Mimoho 所有 API 的接口状态

推荐使用 [nextest](https://github.com/nextest-rs/nextest) （一款更干净美观、速度更快的跨平台测试运行器）进行单元测试

默认使用 socket 连接 Mihomo 测试，可通过设置 `MIHOMO_SOCKET` 环境变量来使用 http 连接 Mihomo 测试

> 修改 `.env` 配置文件，将 `MIHOMO_SOCKET` 设置为 `0`, 再执行单元测试

```shell
# 此命令会排除 restart/reload_config 方法, 因为这两个接口都会让内核重新加载配置文件，会导致其他测试用例错误
cargo nextest run mihomo_

# --------------------------
# 测试 reload_config 方法
cargo nextest run reload

# 测试 restart 方法
cargo nextest run restart
```
