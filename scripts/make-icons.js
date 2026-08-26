'use strict'

// 生成 DeepSeek 小鲸鱼应用图标：
//   icon.png = 官方 512（原图）
//   icon.ico = 规范多尺寸 ICO（16/32/48/256，真实重采样 PNG 内嵌，尺寸与目录项一致）
// 纯 Node 实现（zlib 内置），无需 Electron。失败时回退本地 scripts/whale-180.png。
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const root = path.resolve(__dirname, '..')
const SOURCE_URL = 'https://fe-static.deepseek.com/chat/icon-512.png'
const FALLBACK = path.join(__dirname, 'whale-180.png')

// ── CRC32 ────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// ── PNG 解码（仅支持 8-bit RGBA，无隔行）─────────────────────────────────
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('非 PNG 文件')
  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat = []
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos)
    const type = buffer.toString('ascii', pos + 4, pos + 8)
    const data = buffer.subarray(pos + 8, pos + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + length
  }
  if (bitDepth !== 8 || colorType !== 6) throw new Error(`不支持的 PNG 格式（bitDepth=${bitDepth}, colorType=${colorType}）`)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * 4
  const pixels = Buffer.alloc(width * height * 4)
  let p = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[p++]
    const row = raw.subarray(p, p + stride)
    p += stride
    const out = y * stride
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? pixels[out + x - 4] : 0
      const up = y > 0 ? pixels[out + x - stride] : 0
      const upLeft = (y > 0 && x >= 4) ? pixels[out + x - stride - 4] : 0
      let value = row[x]
      if (filter === 1) value = (value + left) & 0xff
      else if (filter === 2) value = (value + up) & 0xff
      else if (filter === 3) value = (value + ((left + up) >> 1)) & 0xff
      else if (filter === 4) {
        const pp = left + up - upLeft
        const pa = Math.abs(pp - left)
        const pb = Math.abs(pp - up)
        const pc = Math.abs(pp - upLeft)
        value = (value + (pa <= pb && pa <= pc ? left : (pb <= pc ? up : upLeft))) & 0xff
      }
      pixels[out + x] = value
    }
  }
  return { width, height, pixels }
}

// ── 双线性重采样 ─────────────────────────────────────────────────────────
function resizePixels(pixels, srcW, srcH, dst) {
  const out = Buffer.alloc(dst * dst * 4)
  for (let y = 0; y < dst; y++) {
    for (let x = 0; x < dst; x++) {
      const sx = Math.min(srcW - 1, Math.max(0, ((x + 0.5) * srcW) / dst - 0.5))
      const sy = Math.min(srcH - 1, Math.max(0, ((y + 0.5) * srcH) / dst - 0.5))
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const x1 = Math.min(srcW - 1, x0 + 1)
      const y1 = Math.min(srcH - 1, y0 + 1)
      const fx = sx - x0
      const fy = sy - y0
      const o = (y * dst + x) * 4
      for (let c = 0; c < 4; c++) {
        const v00 = pixels[(y0 * srcW + x0) * 4 + c]
        const v10 = pixels[(y0 * srcW + x1) * 4 + c]
        const v01 = pixels[(y1 * srcW + x0) * 4 + c]
        const v11 = pixels[(y1 * srcW + x1) * 4 + c]
        out[o + c] = Math.round((v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy)
      }
    }
  }
  return out
}

// ── PNG 编码（filter 0，8-bit RGBA）──────────────────────────────────────
function encodePng(pixels, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length)
    out.writeUInt32BE(data.length, 0)
    out.write(type, 4, 'ascii')
    data.copy(out, 8)
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
    return out
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── 多尺寸 ICO（PNG 内嵌，尺寸与目录项一致）─────────────────────────────
function buildIco(entries) {
  const count = entries.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)
  const dir = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  const blobs = []
  entries.forEach((entry, index) => {
    const dim = entry.size >= 256 ? 0 : entry.size // ICO 约定 0 = 256
    const e = 16 * index
    dir.writeUInt8(dim, e)
    dir.writeUInt8(dim, e + 1)
    dir.writeUInt8(0, e + 2)
    dir.writeUInt8(0, e + 3)
    dir.writeUInt16LE(1, e + 4)
    dir.writeUInt16LE(32, e + 6)
    dir.writeUInt32LE(entry.data.length, e + 8)
    dir.writeUInt32LE(offset, e + 12)
    offset += entry.data.length
    blobs.push(entry.data)
  })
  return Buffer.concat([header, dir, ...blobs])
}

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

async function main() {
  try {
    let source
    try {
      source = await download(SOURCE_URL)
    } catch (error) {
      console.error('官方 512 下载失败，回退本地 180：', error.message)
      source = fs.readFileSync(FALLBACK)
    }
    const { width, height, pixels } = decodePng(source)
    const sizes = [16, 32, 48, 256]
    const entries = sizes.map((size) => ({ size, data: encodePng(resizePixels(pixels, width, height, size), size) }))
    fs.writeFileSync(path.join(root, 'icon.png'), source)
    fs.writeFileSync(path.join(root, 'icon.ico'), buildIco(entries))
    console.log(`icon.png ${source.length} bytes ${width}x${height}`)
    console.log(`icon.ico ${entries.length} 档：${sizes.join('/')}`)
  } catch (error) {
    console.error('图标生成失败：', error.message)
    process.exit(1)
  }
}

main()
