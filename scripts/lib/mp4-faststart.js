'use strict';
/**
 * MP4 Fast Start remux (same effect as: ffmpeg -c copy -movflags +faststart).
 * Moves the moov atom before mdat without recompressing.
 * Works in Node and browsers (ArrayBuffer / Uint8Array / Buffer).
 */

function toU8(input) {
  if (!input) return null;
  if (input instanceof Uint8Array) return input;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  return null;
}

function readU32(u8, off) {
  return ((u8[off] << 24) | (u8[off + 1] << 16) | (u8[off + 2] << 8) | u8[off + 3]) >>> 0;
}

function writeU32(u8, off, val) {
  val = val >>> 0;
  u8[off] = (val >>> 24) & 0xff;
  u8[off + 1] = (val >>> 16) & 0xff;
  u8[off + 2] = (val >>> 8) & 0xff;
  u8[off + 3] = val & 0xff;
}

function readU64(u8, off) {
  var hi = readU32(u8, off);
  var lo = readU32(u8, off + 4);
  return hi * 4294967296 + lo;
}

function writeU64(u8, off, val) {
  var hi = Math.floor(val / 4294967296) >>> 0;
  var lo = val >>> 0;
  writeU32(u8, off, hi);
  writeU32(u8, off + 4, lo);
}

function typeAt(u8, off) {
  return String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]);
}

function parseTopBoxes(u8) {
  var boxes = [];
  var offset = 0;
  while (offset + 8 <= u8.length) {
    var size = readU32(u8, offset);
    var type = typeAt(u8, offset + 4);
    var header = 8;
    if (size === 1) {
      if (offset + 16 > u8.length) break;
      size = readU64(u8, offset + 8);
      header = 16;
    } else if (size === 0) {
      size = u8.length - offset;
    }
    if (size < header || offset + size > u8.length) break;
    boxes.push({ type: type, offset: offset, size: size, header: header });
    offset += size;
  }
  return boxes;
}

function patchChunkOffsets(moov, delta) {
  if (!delta) return moov;
  var out = new Uint8Array(moov.length);
  out.set(moov);
  var stack = [{ start: 8, end: out.length }];
  while (stack.length) {
    var cur = stack.pop();
    var i = cur.start;
    while (i + 8 <= cur.end) {
      var size = readU32(out, i);
      var typ = typeAt(out, i + 4);
      var hdr = 8;
      if (size === 1) {
        if (i + 16 > cur.end) break;
        size = readU64(out, i + 8);
        hdr = 16;
      } else if (size === 0) {
        size = cur.end - i;
      }
      if (size < hdr || i + size > cur.end) break;
      if (typ === 'trak' || typ === 'mdia' || typ === 'minf' || typ === 'stbl' || typ === 'edts') {
        stack.push({ start: i + hdr, end: i + size });
      } else if (typ === 'stco') {
        var entrystco = readU32(out, i + hdr + 4);
        var p = i + hdr + 8;
        for (var s = 0; s < entrystco && p + 4 <= i + size; s++, p += 4) {
          writeU32(out, p, readU32(out, p) + delta);
        }
      } else if (typ === 'co64') {
        var entry64 = readU32(out, i + hdr + 4);
        var q = i + hdr + 8;
        for (var c = 0; c < entry64 && q + 8 <= i + size; c++, q += 8) {
          writeU64(out, q, readU64(out, q) + delta);
        }
      }
      i += size;
    }
  }
  return out;
}

function inspectMp4(input) {
  var u8 = toU8(input);
  if (!u8 || u8.length < 16) {
    return { ok: false, reason: 'too_small', boxes: [] };
  }
  var boxes = parseTopBoxes(u8);
  var types = boxes.map(function (b) {
    return b.type;
  });
  var moov = null;
  var mdat = null;
  var ftyp = null;
  for (var i = 0; i < boxes.length; i++) {
    if (boxes[i].type === 'moov' && !moov) moov = boxes[i];
    if (boxes[i].type === 'mdat' && !mdat) mdat = boxes[i];
    if (boxes[i].type === 'ftyp' && !ftyp) ftyp = boxes[i];
  }
  var hasMoov = !!moov;
  var hasMdat = !!mdat;
  var faststart = !!(moov && mdat && moov.offset < mdat.offset);
  return {
    ok: hasMoov && hasMdat,
    reason: !hasMoov ? 'no_moov' : !hasMdat ? 'no_mdat' : 'ok',
    boxes: boxes,
    types: types,
    moov: moov,
    mdat: mdat,
    ftyp: ftyp,
    faststart: faststart,
    size: u8.length
  };
}

/**
 * Remux MP4 so moov precedes mdat. No re-encode.
 * @returns {{ buffer: Uint8Array, changed: boolean, info: object }}
 */
function remuxMp4FastStart(input) {
  var u8 = toU8(input);
  var info = inspectMp4(u8);
  if (!info.ok) {
    return { buffer: u8, changed: false, info: info, error: info.reason };
  }
  if (info.faststart) {
    return { buffer: u8, changed: false, info: info };
  }
  var boxes = info.boxes;
  var moovBox = info.moov;
  var before = [];
  var after = [];
  for (var i = 0; i < boxes.length; i++) {
    var b = boxes[i];
    if (b.type === 'moov') continue;
    if (b.offset < moovBox.offset) before.push(b);
    else after.push(b);
  }
  // Only safe when every kept box before moov stays before, and moov moves ahead of mdat.
  var moovBytes = u8.subarray(moovBox.offset, moovBox.offset + moovBox.size);
  // Delta: moov is inserted after `before` and before former-before mdat region.
  // Chunk offsets currently point at absolute file positions. After insert, every
  // byte that was at/after moov's original spot before the move... classic qt-faststart:
  // new layout = (boxes before moov except we place moov right after ftyp/free preface) .
  // Practical layout matching ffmpeg: keep order of non-moov boxes, place moov
  // immediately before the first mdat.
  var head = [];
  var tail = [];
  var seenMdat = false;
  for (var j = 0; j < boxes.length; j++) {
    var bx = boxes[j];
    if (bx.type === 'moov') continue;
    if (bx.type === 'mdat') seenMdat = true;
    if (!seenMdat) head.push(bx);
    else tail.push(bx);
  }
  var headSize = 0;
  for (var h = 0; h < head.length; h++) headSize += head[h].size;
  var delta = moovBox.size;
  var patchedMoov = patchChunkOffsets(moovBytes, delta);
  var total = u8.length; // same size (reorder only)
  var out = new Uint8Array(total);
  var o = 0;
  for (var a = 0; a < head.length; a++) {
    out.set(u8.subarray(head[a].offset, head[a].offset + head[a].size), o);
    o += head[a].size;
  }
  out.set(patchedMoov, o);
  o += patchedMoov.length;
  for (var t = 0; t < tail.length; t++) {
    out.set(u8.subarray(tail[t].offset, tail[t].offset + tail[t].size), o);
    o += tail[t].size;
  }
  if (o !== total) {
    return { buffer: u8, changed: false, info: info, error: 'size_mismatch' };
  }
  var check = inspectMp4(out);
  if (!check.ok || !check.faststart) {
    return { buffer: u8, changed: false, info: info, error: 'validate_failed' };
  }
  return { buffer: out, changed: true, info: check };
}

function needsFastStart(input) {
  var info = inspectMp4(input);
  return info.ok && !info.faststart;
}

module.exports = {
  inspectMp4: inspectMp4,
  remuxMp4FastStart: remuxMp4FastStart,
  needsFastStart: needsFastStart,
  parseTopBoxes: parseTopBoxes,
  toU8: toU8
};
