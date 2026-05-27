# Web向け Geometry Pose Estimation API 設計メモ
## 設計仕様書

# 目的

Webブラウザのみを使い、

- カメラ映像
- IMU
- エッジ情報
- 線分
- 特徴点
- キャリブレーション情報

から、

> 指定された3D形状の位置・姿勢・座標

を推定する。

---

# 非目的

このAPIは以下を目指さない。

- 汎用画像認識AI
- OCR
- YOLO系物体認識
- ARKit完全再現
- 高精度測量
- LiDAR依存

---

# 重要コンセプト

## AI-first ではなく Geometry-first

このAPIは：

```text
画像をAIに分類
```

するのではなく、

```text
3D形状テンプレートを2Dへ投影し、
edge / line / keypoint と比較する
```

ことで形状位置を推定する。

---

# 基本アーキテクチャ

```text
Browser Client
  - Camera capture
  - Edge extraction
  - Line extraction
  - Keypoint extraction
  - IMU capture
  - Timestamping
  - Calibration phase

        ↓

WebRTC / Upload API

        ↓

Geometry Server
  - Session manager
  - Time synchronization
  - Multi-frame integration
  - VIO
  - Shape matching
  - Pose estimation
  - Geometry optimization
```

---

# システム設計方針

## 方針1: RGB画像は極力送らない

送信データ：

- line segments
- keypoints
- compressed edge map
- IMU samples
- timestamps

理由：

- 通信量削減
- プライバシー
- サーバコスト削減
- AI推論コスト削減

---

## 方針2: クライアント側で前処理

ブラウザ側で：

- edge extraction
- line extraction
- keypoint extraction

を実行。

サーバ側では：

- multi-frame integration
- VIO
- geometry inference
- pose optimization

を行う。

---

## 方針3: shape query ではなく 3D shape template

入力は：

```text
"T字を探して"
```

ではなく：

```text
3D mesh / edge model / CAD-like template
```

を渡す。

---

# クライアント実装

# 技術候補

- TypeScript
- WebAssembly
- OpenCV.js
- WebGL
- Web Workers
- WebRTC DataChannel

---

# 必須機能

## 1. Camera Capture

使用API：

```javascript
navigator.mediaDevices.getUserMedia()
```

---

## 2. IMU Capture

使用API：

```javascript
DeviceMotionEvent
```

必要情報：

- gyro
- accel
- timestamp

---

## 3. Timestamp synchronization

重要。

映像とIMUを同一時計基準に合わせる。

候補：

```javascript
performance.now()
```

---

## 4. Edge Extraction

候補：

- Canny
- Sobel

注意：

人工芝などノイズが多い環境では、
短いエッジを除去する。

---

## 5. Line Extraction

候補：

- LSD(Line Segment Detector)
- Hough Transform

送信例：

```json
{
  "lines": [
    {
      "x1": 120,
      "y1": 200,
      "x2": 500,
      "y2": 210,
      "score": 0.92
    }
  ]
}
```

---

## 6. Keypoint Extraction

用途：

- frame tracking
- VIO
- motion estimation
- parallax estimation

候補：

- FAST
- ORB
- Harris

注意：

人工芝など細かいテクスチャはノイズになるため、
keypoint は間引く。

---

# サーバ実装

# 推奨構成

## Geometry Layer

候補ライブラリ：

- ViSP
- OpenCV
- OpenGV

役割：

- shape projection
- edge matching
- pose estimation

---

## VIO Layer

候補ライブラリ：

- OpenVINS
- VINS-Mono
- REBiVO

役割：

- camera motion estimation
- multi-frame integration

---

## Optimization Layer

候補ライブラリ：

- GTSAM
- Ceres Solver

役割：

- pose optimization
- geometry optimization
- temporal consistency

---

# サーバ処理フロー

```text
1. Receive line/keypoint/IMU stream
2. Synchronize timestamps
3. Estimate camera motion
4. Project 3D template into 2D
5. Compare projected edges with observed lines
6. Compute matching score
7. Optimize pose
8. Integrate across frames
9. Return coordinates + confidence
```

---

# 3D Shape Template

# 入力フォーマット候補

- glTF / GLB
- OBJ
- edge graph
- simplified contour model

---

# テンプレート用途

例：

- T字
- tennis net center
- pole
- cube
- sphere
- cylinder
- CAD-derived contour

---

# Pose Estimation

# 基本原理

```text
3D model
↓
2D projection
↓
edge/line matching
↓
best pose search
```

---

# 返却データ

```json
{
  "detections": [
    {
      "shapeId": "target_shape",
      "confidence": 0.91,
      "imagePoint": {
        "x": 512,
        "y": 384
      },
      "pose": {
        "translation": [0.1, 0.9, 2.4],
        "rotation": [0.0, 0.0, 0.0, 1.0]
      }
    }
  ]
}
```

---

# キャリブレーション

# 目的

ブラウザ環境では：

- sensor jitter
- timestamp drift
- browser delay

があるため、
短い calibration phase を設ける。

---

# Calibration Phase

ユーザーへ依頼：

```text
1. 対象を中央へ
2. 左右へゆっくり回転
3. 少し前後移動
4. 1秒静止
```

---

# 推定対象

- gyro bias
- gravity direction
- frame delay
- camera motion tendency
- feature stability

---

# 重要制約

# 重要1: 3D座標は難しい

単眼 + IMU だけでは：

- absolute scale
- exact distance

は不安定。

---

# 重要2: Relative pose は強い

以下は比較的現実的：

- relative position
- relative rotation
- image coordinates
- temporal tracking

---

# 重要3: Multi-frame が重要

単フレームではなく：

```text
multi-frame + IMU
```

が重要。

理由：

- parallax
- temporal consistency
- pose stabilization

が得られるため。

---

# 人工芝などノイズ環境

# 問題

人工芝：

- tiny edges
- shadow edges
- repeating texture

が大量発生。

---

# 対策

送信する情報を絞る：

- long lines
- stable keypoints
- meaningful contours
- court lines
- pole edges

送らない：

- grass texture
- tiny edges
- unstable shadows

---

# WebRTC

# 初期MVP

リアルタイム不要。

```text
1. capture 2-5 sec
2. upload features + IMU
3. server analyze
4. return result
```

---

# 将来

WebRTC DataChannel による
リアルタイム stream 化。

送信：

- line segments
- keypoints
- IMU stream

受信：

- detected pose
- confidence
- coordinates

---

# API設計例

## Start Session

```http
POST /sessions
```

```json
{
  "shapeModel": {
    "type": "glb",
    "id": "target_shape"
  },
  "need3D": true,
  "calibration": true
}
```

---

## Upload Frame Features

```json
{
  "timestamp": 12345.678,
  "features": {
    "lines": [],
    "keypoints": []
  }
}
```

---

## Upload IMU

```json
{
  "samples": [
    {
      "timestamp": 12345.650,
      "gyro": {
        "x": 0.01,
        "y": -0.02,
        "z": 0.03
      },
      "accel": {
        "x": 0.1,
        "y": 9.8,
        "z": 0.0
      }
    }
  ]
}
```

---

# GitHub Copilot 向け実装方針

Copilotへ依頼する単位：

- edge extraction module
- line extraction module
- IMU capture module
- timestamp synchronizer
- WebRTC transport layer
- shape projection engine
- pose optimization
- VIO integration
- temporal tracker

---

# Copilotへ依頼するときの重要ポイント

## 1. AI object detection を前提にさせない

重要：

```text
DO NOT use YOLO/object detection.
Use geometry-based matching.
```

---

## 2. RGB画像依存にしない

重要：

```text
Use edge/line/keypoint based pipeline.
```

---

## 3. Multi-frame 前提にする

重要：

```text
Use temporal consistency across frames.
```

---

## 4. IMUを必須扱い

重要：

```text
Fuse IMU with visual features.
```

---

## 5. 単発推論ではなく tracking

重要：

```text
Tracking-first, not frame-by-frame classification.
```

---

# MVP推奨順序

## MVP1

- line extraction
- IMU capture
- upload API
- offline pose estimation

---

## MVP2

- multi-frame integration
- temporal tracking

---

## MVP3

- 3D template upload
- pose optimization

---

## MVP4

- WebRTC streaming
- realtime result feedback

---

# 最終まとめ

このAPIの価値は：

```text
Webブラウザだけで
Geometry Pose Estimation を実現する
```

点にある。

ARKit再現ではなく：

```text
Geometry-first
+
edge/line/keypoint
+
IMU
+
multi-frame
+
3D template matching
```

を軸にした軽量なWeb向け空間認識APIとして設計する。
