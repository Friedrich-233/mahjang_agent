# Riichi Vision Agent

一个独立的新项目，不嵌在 `mahjong-calc` 里。它用 Roboflow YOLO 模型识别现实麻将照片/摄像头画面，再把检测结果转成：

- 自己手牌
- 自己/左侧/对家/右侧牌河快照
- 新增打牌事件
- 疑似吃碰杠提示
- 基于 Akagi 分析思路的出牌建议

当前版本是最小可用原型：YOLO 负责检测牌和 bbox；前端按画面区域推断手牌/牌河/疑似副露；分析器枚举每个可切牌，计算切后向听数和扣掉已见牌后的进张枚数。尚未接入 Akagi 完整对手风险/放铳率引擎，也不会自动知道立直、巡目、亲家打点等复杂状态。

## 本地开发

```bash
cd riichi-vision-agent
npm install
cp .env.example .env
```

填写 `.env`：

```bash
ROBOFLOW_API_KEY=你的_key
ROBOFLOW_MODEL=https://universe.roboflow.com/tecky-nx4vn/mahjong-9xjry/model/1
APP_PORT=5174
```

开两个终端：

```bash
npm run server:dev
```

```bash
npm run dev
```

浏览器打开 Vite 输出的地址，通常是 `http://localhost:5174`。开发时 `/api/*` 会代理到 `8788` 后端。

## 使用方式

1. 开局点击 `扫描我的手牌`，拍自己的 13 张手牌；摸牌后需要建议时再扫描 14 张。
2. 后续点击 `观察牌桌`，让自己的牌河在画面下方，对家在上方，左/右两家在画面左右。
3. 系统按四个区域刷新牌河快照，并用新旧快照差分记录新增打牌。
4. 宝牌指示牌、场风、自风由你手动输入。
5. 如果未知区过多或疑似副露出现，页面会提示移动摄像头或人工确认。

注意：浏览器实时摄像头 API 只在 HTTPS 或 `localhost` 等安全上下文可用。用局域网
`http://树莓派IP:端口` 访问时，`开启摄像头` 可能不可用；这时请使用页面右侧的
`扫描手牌照片` / `观察牌桌照片` 上传入口。手机浏览器通常会在文件选择时直接调用相机。
配置 Cloudflare/HTTPS 域名后，再使用实时摄像头按钮。

## Portainer / Docker Compose

在树莓派上：

```bash
git clone <你的仓库地址>
cd riichi-vision-agent
cp .env.example .env
nano .env
docker compose up -d --build
```

同一 Wi-Fi 下访问：

```text
http://树莓派IP:5174
```

Portainer Web UI：

1. `Stacks` -> `Add stack`
2. Name 填 `riichi-vision-agent`
3. 选择 Git repository 或 Web editor
4. Compose 内容使用本项目的 `docker-compose.yml`
5. 在 Environment variables 填 `ROBOFLOW_API_KEY`、`ROBOFLOW_MODEL`
6. Deploy

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `ROBOFLOW_API_KEY` | Roboflow API key，只在服务端使用 |
| `ROBOFLOW_MODEL` | 模型 ID 或 Universe URL，默认适配 `mahjong-9xjry/1` |
| `ROBOFLOW_BASE_URL` | 默认 `https://serverless.roboflow.com` |
| `ROBOFLOW_CONFIDENCE` | YOLO confidence，默认 `30` |
| `ROBOFLOW_OVERLAP` | YOLO overlap，默认 `30` |
| `ROBOFLOW_DEDUP_IOU` | 本地 bbox 去重阈值，默认 `0.55` |
| `ROBOFLOW_CLASS_MAP` | 可选，手动 class map，例如 `{\"east\":\"1z\"}` |
| `APP_PORT` | 宿主机映射端口，默认 `5174` |

## 已有 Cloudflare Tunnel

如果你的树莓派上已经有自己的 Cloudflare Tunnel，不需要把 tunnel token 放进本项目，
也不需要使用额外的 compose 文件。保持本项目按普通方式部署即可：

```text
docker-compose.yml
```

然后在你现有的 Cloudflare Tunnel 里新增 Public Hostname：

- Type: `HTTP`
- URL:

```text
http://树莓派IP:5174
```

例如：

```text
http://192.168.1.60:5174
```

如果你的 `cloudflared` 是单独的 Docker 容器，注意 `localhost` 指的是
`cloudflared` 容器自己，通常不能写 `http://localhost:5174`。这种情况下优先写树莓派
局域网 IP，或者把两个容器接入同一个 Docker network 后再用服务名。

访问 HTTPS 域名：

```text
https://mahjong.你的域名
```

这时 `开启摄像头` 应该可以正常弹浏览器权限。

## 视觉区域约定

当前启发式假设摄像头朝向固定：

- 下方：自己的手牌/自己的牌河
- 左侧：下家牌河
- 上方：对家牌河
- 右侧：上家牌河
- 边缘散落的 3/4 张牌：疑似副露

如果桌面倾斜很大，或者镜头只拍到局部，agent 会要求你移动摄像头。后续可以加一个“校准四个区域”的 UI，让你手动拖框，这会比固定比例更稳。

## Attribution

- AI 算法参考：[shinkuan/Akagi](https://github.com/shinkuan/Akagi) 的分析器设计思想。Akagi 使用 Apache-2.0 License。
- YOLO 模型默认使用 Roboflow Universe: `mahjong-9xjry/1`。

## License

MIT, 2026 hwb-233.
