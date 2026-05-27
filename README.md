# web-geometry-pose

Webブラウザ向けの Geometry-first Pose Estimation API。

3D shape template を edge / line / keypoint と照合し、位置・姿勢（pose）を推定する。

## Docs

- 設計メモ: `docs/design_ja.md`

## Scope

- **in scope**: クライアント側 feature 抽出、3D テンプレートマッチ、マルチフレーム pose 推定
- **out of scope**: YOLO 等の物体検出、ARKit 再現、LiDAR 依存、高精度測量

## Packages

| Package | Role |
|---------|------|
| `@lumetriq/geometry-core` | 共有型・テンプレート投影・マッチング |
| `@lumetriq/geometry-client` | ブラウザ SDK（camera / line / IMU / session） |

## Development

```bash
npm install
npm run build
```

## Demo

動作確認デモ（ルート配信）:

- GitHub Pages: https://lumetriq-labs.github.io/web-geometry-pose/
- ローカル: `python3 -m http.server 8080` → http://localhost:8080/

## Working Principles

- Geometry-first（AI 物体検出に依存しない）
- RGB 画像は送らず line / keypoint / IMU を主とする
- Multi-frame + tracking 前提
