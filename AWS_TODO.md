AWS GPU Chrome Rendering TODO
================================

- Instance type:
  - Use `g5.xlarge` or `g6.xlarge` (NVENC capable).

- NVIDIA drivers:
  - sudo apt-get update && sudo apt-get install -y ubuntu-drivers-common
  - sudo ubuntu-drivers autoinstall
  - Reboot; verify `nvidia-smi`.
  - In Docker: use NVIDIA Container Toolkit and run with `--gpus all`.

- Chromium/Chrome:
  - Install system Chrome/Chromium and set `CHROME_PATH`.
    - Example: `sudo apt install ./google-chrome-stable_current_amd64.deb`
    - Or: `sudo snap install chromium`
    - `CHROME_PATH=/usr/bin/google-chrome` (or chromium path)

- ffmpeg with NVENC:
  - Install ffmpeg with NVENC.
    - Ensure `ffmpeg -encoders | grep nvenc` shows `h264_nvenc`.
    - Set `FFMPEG_PATH` env if not on PATH.

- Fonts:
  - sudo apt-get install -y fonts-dejavu-core fonts-noto fonts-noto-cjk
  - export LANG=en_US.UTF-8

- Warm pool:
  - Set `BROWSER_POOL_SIZE=2..4` for concurrency.

- Env vars:
  - OPENAI_API_KEY=...
  - MAPTILER_KEY=...
  - CHROME_PATH=/usr/bin/google-chrome
  - FFMPEG_PATH=/usr/bin/ffmpeg
  - RENDER_ENCODER=h264_nvenc
  - RENDER_FORCE_MP4=false (set true to default MP4 on /api/animate)
  - BROWSER_POOL_SIZE=2
  - AWS_S3_BUCKET=...
  - AWS_REGION=...

- Validate:
  - npm run test:webgl (should show NVIDIA renderer)
  - curl -X POST :8080/api/render {...} > out.mp4 (under 5s warm)
  - curl -X POST :8080/api/animate {"format":"mp4",...} (returns S3 MP4 URL)

