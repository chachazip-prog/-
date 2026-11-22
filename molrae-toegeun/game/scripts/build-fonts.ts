/// <reference types="node" />
/**
 * 한글 도트 폰트 변환 (T-126, D-042). `npm run fonts`
 *
 * vendor/fonts/galmuri/*.bdf(원본, 수정 금지) → public/fonts/mt-pixel-{12,10,8}.{json,png}
 *  1. 사용 글자 수집: data/strings.*.json 의 strings 값 + src/ 의 TS 문자열 리터럴(주석 제외)
 *     + 기본 집합(ASCII, KS X 1001 한글 2,350자, 호환 자모, 기호)
 *  2. 원 폰트에 없는 글자가 있으면 누락 목록을 출력하고 종료 코드 1 (fonts.config.json allowMissing 예외만 경고)
 *  3. 서브셋 글리프를 셸프 패킹 → 1비트 팔레트 PNG(흰 글자 + 투명) + BMFont 정보 JSON(압축형)
 *  4. 원 저작권 고지 + OFL 1.1 전문을 public/licenses/OFL-galmuri.txt 로 출력
 *
 * 외부 도구 없음: BDF는 텍스트 포맷이라 직접 파싱하고, PNG는 node:zlib으로 인코딩한다.
 * 출력은 결정적(타임스탬프 없음). 같은 입력이면 같은 바이트.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import ts from 'typescript';

// esbuild 번들 위치(node_modules/.cache)와 무관하게 game/ 루트를 찾는다
const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));

interface FontSpec {
  name: string; source: string; sourceFamily: string; role: string; charsets: string[];
}
interface AllowMissing { char: string; where: string; reason: string }
interface Config {
  vendorDir: string; outDir: string; licenseOut: string; sourceVersion: string; sourceUrl: string;
  fonts: FontSpec[]; symbols: string; numSymbols: string; allowMissing: AllowMissing[];
}

function findRoot(start: string): string {
  let d = start;
  for (let i = 0; i < 6; i++) {
    try { if (statSync(join(d, 'scripts', 'fonts.config.json')).isFile()) return d; } catch { /* up */ }
    d = resolve(d, '..');
  }
  throw new Error('game 루트(scripts/fonts.config.json)를 찾지 못함');
}

// ── BDF 파서 ─────────────────────────────────────────

interface Glyph { cp: number; dw: number; w: number; h: number; xoff: number; yoff: number; rows: Uint8Array[] }
interface BdfFont { props: Record<string, string>; glyphs: Map<number, Glyph> }

function parseBdf(text: string): BdfFont {
  const lines = text.split(/\r?\n/);
  const props: Record<string, string> = {};
  const glyphs = new Map<number, Glyph>();
  let i = 0;
  let inProps = false;
  while (i < lines.length) {
    const line = lines[i++]!;
    if (line.startsWith('STARTPROPERTIES')) { inProps = true; continue; }
    if (line.startsWith('ENDPROPERTIES')) { inProps = false; continue; }
    if (inProps) {
      const m = /^(\S+)\s+(.*)$/.exec(line);
      if (m) props[m[1]!] = m[2]!.replace(/^"(.*)"$/, '$1');
      continue;
    }
    if (!line.startsWith('STARTCHAR')) continue;
    let cp = -1, dw = 0, w = 0, h = 0, xoff = 0, yoff = 0;
    const rows: Uint8Array[] = [];
    while (i < lines.length) {
      const l = lines[i++]!;
      if (l.startsWith('ENCODING ')) cp = Number(l.split(/\s+/)[1]);
      else if (l.startsWith('DWIDTH ')) dw = Number(l.split(/\s+/)[1]);
      else if (l.startsWith('BBX ')) [w, h, xoff, yoff] = l.split(/\s+/).slice(1, 5).map(Number) as [number, number, number, number];
      else if (l === 'BITMAP') {
        for (let r = 0; r < h; r++) {
          const hex = lines[i++]!.trim();
          const row = new Uint8Array(w);
          for (let x = 0; x < w; x++) {
            const nib = parseInt(hex[x >> 2] ?? '0', 16);
            row[x] = (nib >> (3 - (x & 3))) & 1;
          }
          rows.push(row);
        }
      } else if (l === 'ENDCHAR') break;
    }
    if (cp >= 0) glyphs.set(cp, { cp, dw, w, h, xoff, yoff, rows });
  }
  return { props, glyphs };
}

// ── 글자 수집 ────────────────────────────────────────

function cps(s: string): number[] { return Array.from(s, (c) => c.codePointAt(0)!); }

function ksx1001Hangul(): number[] {
  // KS X 1001 완성형 한글 2,350자 = EUC-KR 0xB0A1..0xC8FE
  const dec = new TextDecoder('euc-kr');
  const out: number[] = [];
  for (let hi = 0xb0; hi <= 0xc8; hi++) {
    for (let lo = 0xa1; lo <= 0xfe; lo++) {
      const c = dec.decode(new Uint8Array([hi, lo]));
      const cp = c.codePointAt(0)!;
      if (cp >= 0xac00 && cp <= 0xd7a3) out.push(cp);
    }
  }
  if (out.length !== 2350) throw new Error(`KS X 1001 한글 수 이상: ${out.length} (Node ICU 확인)`);
  return out;
}

function walkStrings(v: unknown, out: Set<number>): void {
  if (typeof v === 'string') for (const c of cps(v)) out.add(c);
  else if (Array.isArray(v)) for (const x of v) walkStrings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) walkStrings(x, out);
}

/** 화면 표시 문자열: data/strings.*.json 의 strings 블록(설계 메모 _comment 등은 제외) */
function collectDataStrings(): { chars: Set<number>; files: string[] } {
  const dir = join(ROOT, 'data');
  const chars = new Set<number>();
  const files: string[] = [];
  for (const f of readdirSync(dir).sort()) {
    if (!/^strings\..+\.json$/.test(f)) continue;
    const json = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { strings?: unknown };
    walkStrings(json.strings ?? {}, chars);
    files.push(`data/${f}`);
  }
  return { chars, files };
}

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...listTs(p));
    else if (/\.ts$/.test(e) && !/\.d\.ts$/.test(e)) out.push(p);
  }
  return out;
}

/** src/ TS 파일의 문자열·템플릿 리터럴 글자(주석 제외). 어느 파일에서 왔는지도 기록 */
function collectCodeStrings(): { chars: Set<number>; origin: Map<number, string> } {
  const chars = new Set<number>();
  const origin = new Map<number, string>();
  for (const file of listTs(join(ROOT, 'src'))) {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2020, false);
    const rel = relative(ROOT, file);
    const visit = (n: ts.Node): void => {
      if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n)
        || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
        for (const c of cps(n.text)) {
          chars.add(c);
          if (!origin.has(c)) origin.set(c, rel);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { chars, origin };
}

// ── 패킹 + PNG ───────────────────────────────────────

interface Placed { g: Glyph; x: number; y: number }

function pack(glyphs: Glyph[]): { w: number; h: number; placed: Placed[] } {
  const PAD = 1; // 최근접 샘플링에서 이웃 글리프 번짐 방지
  const sorted = [...glyphs].sort((a, b) => b.h - a.h || b.w - a.w || a.cp - b.cp);
  for (const [w, h] of [[64, 64], [128, 64], [128, 128], [256, 128], [256, 256], [512, 256], [512, 512], [1024, 512], [1024, 1024], [2048, 1024], [2048, 2048]] as const) {
    const placed: Placed[] = [];
    let x = PAD, y = PAD, rowH = 0, ok = true;
    for (const g of sorted) {
      if (g.w === 0 || g.h === 0) { placed.push({ g, x: 0, y: 0 }); continue; }
      if (x + g.w + PAD > w) { x = PAD; y += rowH + PAD; rowH = 0; }
      if (y + g.h + PAD > h) { ok = false; break; }
      placed.push({ g, x, y });
      x += g.w + PAD;
      rowH = Math.max(rowH, g.h);
    }
    if (ok) return { w, h, placed };
  }
  throw new Error('아틀라스가 2048×2048을 넘음');
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** 1비트 팔레트 PNG: 인덱스 0 = 투명, 1 = 흰색(틴트로 색 지정) */
function encodePng(w: number, h: number, bits: Uint8Array): Buffer {
  const stride = Math.ceil(w / 8);
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1);
    raw[o] = 0; // filter none
    for (let x = 0; x < w; x++) if (bits[y * w + x]) raw[o + 1 + (x >> 3)]! |= 0x80 >> (x & 7);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 1; ihdr[9] = 3; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('PLTE', Uint8Array.from([0, 0, 0, 255, 255, 255])),
    chunk('tRNS', Uint8Array.from([0])),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

// ── 메인 ─────────────────────────────────────────────

function sha256(buf: Buffer | string): string { return createHash('sha256').update(buf).digest('hex'); }
function hex(cp: number): string { return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`; }

function main(): void {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'scripts', 'fonts.config.json'), 'utf8')) as Config;
  const vendor = join(ROOT, cfg.vendorDir);
  const outDir = join(ROOT, cfg.outDir);
  mkdirSync(outDir, { recursive: true });

  const data = collectDataStrings();
  const code = collectCodeStrings();
  const used = new Set<number>([...data.chars, ...code.chars]);
  const isControl = (cp: number) => cp < 0x20 || (cp >= 0x7f && cp < 0xa0);
  const sets: Record<string, number[]> = {
    ascii: Array.from({ length: 0x7f - 0x20 }, (_, k) => 0x20 + k),
    ksx1001Hangul: ksx1001Hangul(),
    compatJamo: Array.from({ length: 0x3163 - 0x3131 + 1 }, (_, k) => 0x3131 + k),
    symbols: cps(cfg.symbols),
    numSymbols: cps(cfg.numSymbols),
    used: [...used].filter((c) => !isControl(c)), // \n 등 제어 문자는 글리프 불필요
  };
  const allow = new Map(cfg.allowMissing.flatMap((a) => cps(a.char).map((c) => [c, a] as const)));

  console.log(`[fonts] 수집: 데이터 ${data.files.join(', ')} ${data.chars.size}자, 코드 리터럴 ${code.chars.size}자 → 사용 글자 ${sets.used!.length}자`);

  let failed = false;
  const manifest: Record<string, unknown>[] = [];
  for (const spec of cfg.fonts) {
    if (/galmuri/i.test(spec.name)) throw new Error(`변환 폰트 이름에 예약명 사용 금지: ${spec.name}`);
    const srcBuf = readFileSync(join(vendor, spec.source));
    const font = parseBdf(srcBuf.toString('utf8'));
    const want = new Set<number>();
    for (const s of spec.charsets) {
      const list = sets[s];
      if (!list) throw new Error(`알 수 없는 charset: ${s}`);
      for (const c of list) want.add(c);
    }
    const missing: number[] = [];
    const allowed: number[] = [];
    const glyphs: Glyph[] = [];
    for (const c of [...want].sort((a, b) => a - b)) {
      const g = font.glyphs.get(c);
      if (g) glyphs.push(g);
      else if (allow.has(c)) allowed.push(c);
      else missing.push(c);
    }
    for (const c of allowed) {
      console.warn(`[fonts] 경고 ${spec.name}: 원 폰트에 없는 글자 허용 ${String.fromCodePoint(c)} ${hex(c)} (${allow.get(c)!.where}) — ${allow.get(c)!.reason}`);
    }
    if (missing.length > 0) {
      failed = true;
      console.error(`[fonts] 실패 ${spec.name} (${spec.source}): 원 폰트에 없는 글자 ${missing.length}개`);
      for (const c of missing) {
        const from = code.origin.get(c) ?? (data.chars.has(c) ? data.files.join(',') : '기본 집합');
        console.error(`  ${String.fromCodePoint(c)}  ${hex(c)}  출처: ${from}`);
      }
      continue;
    }

    // 세로 메트릭: 포함된 글리프의 실제 위·아래 끝으로 조인다(BDF FONT_ASCENT는 악센트 여백 포함이라 큼)
    let top = 0, bottom = 0;
    for (const g of glyphs) {
      if (g.h === 0) continue;
      top = Math.max(top, g.yoff + g.h);
      bottom = Math.min(bottom, g.yoff);
    }
    const base = top;
    const lineHeight = top - bottom;
    const size = Number(font.props.PIXEL_SIZE ?? font.props.POINT_SIZE ?? lineHeight);

    const { w, h, placed } = pack(glyphs);
    const bits = new Uint8Array(w * h);
    for (const p of placed) {
      p.g.rows.forEach((row, ry) => row.forEach((v, rx) => { if (v) bits[(p.y + ry) * w + p.x + rx] = 1; }));
    }
    const png = encodePng(w, h, bits);
    const pngName = `${spec.name}.png`;
    writeFileSync(join(outDir, pngName), png);

    // BMFont 정보를 JSON으로 압축(Phaser 내장 로더는 XML만 받지만 XML은 글자당 약 120B라 2,500자면 300KB).
    // 런타임 src/ui/bitmapFonts.ts 가 Phaser ParseXMLBitmapFont 와 같은 구조로 캐시에 등록한다.
    // chars 항목 = [id, x, y, width, height, xoffset, yoffset, xadvance] (BMFont .fnt 의 char 속성과 같은 의미)
    const byCp = [...placed].sort((a, b) => a.g.cp - b.g.cp);
    const fntJson = {
      format: 'bmfont-compact-1',
      notice: `${spec.name}: Modified Version of ${spec.sourceFamily} ${cfg.sourceVersion} (subset + bitmap atlas). `
        + `${font.props.COPYRIGHT ?? ''}. Licensed under the SIL Open Font License 1.1: see licenses/OFL-galmuri.txt. `
        + 'Generated by game/scripts/build-fonts.ts. Do not edit.',
      info: { face: spec.name, size },
      common: { lineHeight, base, scaleW: w, scaleH: h },
      page: pngName,
      fields: ['id', 'x', 'y', 'width', 'height', 'xoffset', 'yoffset', 'xadvance'],
      chars: byCp.map(({ g, x, y }) => [g.cp, x, y, g.w, g.h, g.xoff, base - (g.yoff + g.h), g.dw]),
    };
    const fnt = `${JSON.stringify(fntJson).replace(/\],\[/g, '],\n[')}\n`;
    writeFileSync(join(outDir, `${spec.name}.json`), fnt);

    console.log(`[fonts] ${spec.name} ← ${spec.source}: ${byCp.length}자, 아틀라스 ${w}×${h}, lineHeight ${lineHeight}, base ${base}, PNG ${png.length}B, JSON ${Buffer.byteLength(fnt)}B`);
    manifest.push({
      name: spec.name, role: spec.role, derivedFrom: `${spec.sourceFamily} ${cfg.sourceVersion}`,
      source: `${cfg.vendorDir}/${spec.source}`, sourceSha256: sha256(srcBuf),
      glyphs: byCp.length, atlas: `${w}x${h}`, lineHeight, base,
      pngSha256: sha256(png), jsonSha256: sha256(fnt),
      allowedMissing: allowed.map(hex),
    });
  }
  if (failed) {
    console.error('[fonts] 누락 글자가 있어 실패. 문구를 바꾸거나(기획) 다른 크기를 쓰세요. 다른 폰트의 글리프를 섞지 않습니다(compliance/font-selection.md §4).');
    process.exit(1);
  }

  // 라이선스 고지: 원 저작권 줄 + OFL 전문(원본 LICENSE.txt 그대로)
  const license = readFileSync(join(vendor, 'LICENSE.txt'), 'utf8').replace(/\r\n/g, '\n');
  const licensePath = join(ROOT, cfg.licenseOut);
  mkdirSync(dirname(licensePath), { recursive: true });
  const notice = [
    'Bitmap fonts mt-pixel-12, mt-pixel-10, mt-pixel-8 bundled with this game',
    `are Modified Versions (subset + bitmap atlas conversion) of Galmuri11, Galmuri9`,
    `and Galmuri7 version ${cfg.sourceVersion} by Lee Minseo. They are distributed under`,
    'the SIL Open Font License, Version 1.1, reproduced below.',
    '이 게임에 포함된 비트맵 폰트 mt-pixel-12/10/8은 이민서(Lee Minseo)의 Galmuri11/9/7',
    `${cfg.sourceVersion}을 서브셋·비트맵 변환한 수정 버전이며 SIL 오픈 폰트 라이선스 1.1로 배포됩니다.`,
    '',
    '----------------------------------------------------------------------',
    '',
    license.trimEnd(),
    '',
  ].join('\n');
  writeFileSync(licensePath, notice);
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify({
    generatedBy: 'game/scripts/build-fonts.ts', license: 'OFL-1.1', licenseFile: cfg.licenseOut,
    sourceUrl: cfg.sourceUrl, licenseSha256: sha256(notice), fonts: manifest,
  }, null, 2)}\n`);
  console.log(`[fonts] 고지 ${cfg.licenseOut} (${Buffer.byteLength(notice)}B), 매니페스트 ${cfg.outDir}/manifest.json`);
}

main();
