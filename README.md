# 食品保质期检测 PWA

这是一个适合部署到腾讯云 Pages 的 PWA 静态网页项目。

功能说明：
- 手机浏览器拍照或上传多张包装图片
- 浏览器端 OCR 提取生产日期和保质期
- 用户手动确认或修改识别结果
- 点击确认后再根据当前日期判断是否过期
- 支持添加到手机主屏幕，以接近 App 的方式打开

本地开发：

```bash
npm install
npm run dev
```

构建发布：

```bash
npm run build
```

部署到火山引擎 Pages 时可使用以下配置：

- 项目根目录：留空
- 安装命令：`npm ci`
- 构建命令：`npm run build`
- 输出目录：`dist`

PWA 说明：
- 访问站点后可在手机浏览器中选择“添加到主屏幕”
- 生产环境需要 HTTPS，腾讯云 Pages 通常可满足
- 构建后会自动生成 `manifest.webmanifest` 和 service worker
