import { spawn } from "node:child_process";
export function spawnFfmpegNvenc(opts) {
    const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
    const enc = (opts.encoder || "h264_nvenc");
    const useNvenc = enc === "h264_nvenc";
    const args = useNvenc
        ? [
            "-f", "rawvideo",
            "-pix_fmt", "rgba",
            "-s:v", `${opts.width}x${opts.height}`,
            "-r", String(opts.fps),
            "-i", "pipe:0",
            "-vf", "vflip",
            "-c:v", "h264_nvenc",
            "-preset", "p1",
            "-tune", "ull",
            "-rc", "vbr",
            "-cq", "23",
            "-b:v", "5M",
            "-maxrate", "5M",
            "-bufsize", "10M",
            "-pix_fmt", "yuv420p",
            "-movflags", "+frag_keyframe+empty_moov+faststart",
            "-f", "mp4",
            "pipe:1"
        ]
        : [
            "-f", "rawvideo",
            "-pix_fmt", "rgba",
            "-s:v", `${opts.width}x${opts.height}`,
            "-r", String(opts.fps),
            "-i", "pipe:0",
            "-vf", "vflip",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-crf", "23",
            "-pix_fmt", "yuv420p",
            "-movflags", "+frag_keyframe+empty_moov+faststart",
            "-f", "mp4",
            "pipe:1"
        ];
    const proc = spawn(ffmpegPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    const encoderName = useNvenc ? "h264_nvenc" : "libx264";
    return { proc, encoderName };
}
