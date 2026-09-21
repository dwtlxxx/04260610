/**
 * convert-audio.mjs —— 把原始背景音乐压成适合网页的体积（无第三方依赖）
 *
 * 为什么需要：原始素材是 38.6MB 的 24bit/48kHz 立体声 WAV。
 * 直接上线意味着首屏多下载近 40MB，手机流量下不可接受；而本机没有
 * ffmpeg/lame/oggenc，所以这里直接按 WAV 规范解析分块 + 自己做重采样。
 *
 * 做三件事：
 *   1. 24bit → 16bit（体积直接降 1/3，背景音乐听不出差别）
 *   2. 48kHz → 22.05kHz（线性插值重采样，再降一半多）
 *   3. 按需混单声道（默认保留立体声）
 *
 * 用法：
 *   node tools/convert-audio.mjs <输入.wav> <输出.wav> [--mono] [--rate 22050]
 *
 * ⚠ 必须按分块解析，不能假定 44 字节定长头：24bit 素材常带 fact/LIST/bext 等附加块，
 *   首版按固定偏移读 data 长度，结果读到 0（实测踩到）。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [src, dst] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const mono = process.argv.includes('--mono');
const rateIdx = process.argv.indexOf('--rate');
const TARGET_RATE = rateIdx >= 0 ? Number(process.argv[rateIdx + 1]) : 22050;
if (!src || !dst) { console.error('用法: node tools/convert-audio.mjs <in.wav> <out.wav> [--mono] [--rate 22050]'); process.exit(1); }

const buf = readFileSync(src);
if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
  console.error('不是 WAV 文件'); process.exit(1);
}

/** 遍历 RIFF 分块，取出 fmt 与 data 的真实位置 */
let pos = 12; let fmt = null; let dataOff = 0; let dataLen = 0;
while (pos + 8 <= buf.length) {
  const id = buf.toString('ascii', pos, pos + 4);
  const size = buf.readUInt32LE(pos + 4);
  const body = pos + 8;
  if (id === 'fmt ') {
    fmt = {
      format: buf.readUInt16LE(body),
      channels: buf.readUInt16LE(body + 2),
      sampleRate: buf.readUInt32LE(body + 4),
      bits: buf.readUInt16LE(body + 14),
    };
  } else if (id === 'data') {
    dataOff = body;
    dataLen = Math.min(size, buf.length - body);
    break;
  }
  pos = body + size + (size % 2);          // 分块按偶数字节对齐
}
if (!fmt || !dataOff) { console.error('缺少 fmt/data 分块'); process.exit(1); }
if (fmt.format !== 1 || fmt.bits !== 24) console.error(`注意：源格式为 format=${fmt.format} bits=${fmt.bits}，本例按 24bit PCM 处理`);

const { channels, sampleRate } = fmt;
const bytesPerSample = fmt.bits / 8;
const frames = Math.floor(dataLen / (channels * bytesPerSample));
const outCh = mono ? 1 : channels;
const ratio = sampleRate / TARGET_RATE;
const outFrames = Math.floor(frames / ratio);

console.log(`源: ${channels}ch ${sampleRate}Hz ${fmt.bits}bit ${(dataLen / 1048576).toFixed(1)}MB ${(frames / sampleRate).toFixed(1)}s`);
console.log(`目标: ${outCh}ch ${TARGET_RATE}Hz 16bit`);

/** 读第 f 帧第 c 声道的样本，归一化到 [-1,1] */
const sample = (f, c) => {
  if (f < 0) f = 0; else if (f >= frames) f = frames - 1;
  const o = dataOff + (f * channels + c) * bytesPerSample;
  const v = buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16);
  const signed = v & 0x800000 ? v - 0x1000000 : v;   // 24bit 符号扩展
  return signed / 8388608;
};

const outBytes = outFrames * outCh * 2;
const out = Buffer.alloc(44 + outBytes);
out.write('RIFF', 0, 'ascii');
out.writeUInt32LE(36 + outBytes, 4);
out.write('WAVE', 8, 'ascii');
out.write('fmt ', 12, 'ascii');
out.writeUInt32LE(16, 16);
out.writeUInt16LE(1, 20);
out.writeUInt16LE(outCh, 22);
out.writeUInt32LE(TARGET_RATE, 24);
out.writeUInt32LE(TARGET_RATE * outCh * 2, 28);
out.writeUInt16LE(outCh * 2, 32);
out.writeUInt16LE(16, 34);
out.write('data', 36, 'ascii');
out.writeUInt32LE(outBytes, 40);

let w = 44;
for (let i = 0; i < outFrames; i++) {
  const s = i * ratio;
  const i0 = Math.floor(s);
  const frac = s - i0;
  for (let c = 0; c < outCh; c++) {
    // 线性插值：对背景音乐足够，且不会引入明显失真
    let v = sample(i0, mono ? 0 : c) * (1 - frac) + sample(i0 + 1, mono ? 0 : c) * frac;
    if (mono && channels > 1) {
      let acc = 0;
      for (let k = 0; k < channels; k++) acc += sample(i0, k) * (1 - frac) + sample(i0 + 1, k) * frac;
      v = acc / channels;
    }
    v = Math.max(-1, Math.min(1, v));
    out.writeInt16LE(Math.round(v * 32767), w);
    w += 2;
  }
}
writeFileSync(dst, out);
console.log(`输出: ${dst}  ${(out.length / 1048576).toFixed(1)}MB  ${(outFrames / TARGET_RATE).toFixed(1)}s`);
console.log(`压缩比: ${(buf.length / out.length).toFixed(1)}×`);
