/**
 * 사운드 재생(Phaser 전역 SoundManager). game/assets/audio/audio-manifest.json 기준.
 * - 로드: 첫 터치 뒤(모바일 자동재생 정책, Phaser가 첫 입력에서 오디오 컨텍스트 unlock) AudioScene이 ogg → mp3 순 URL로 지연 로드.
 *   초기 번들·첫 판 진입 시간에 포함되지 않음. 로드 전·실패 시 소리만 없고 게임은 그대로(시각 신호는 항상 표시, rules.visualCues.alwaysOn).
 * - BGM: 두 스템(main·tension) 동시 루프, 같은 rate. 단계(stages)마다 rampSec 선형 보간. freeze = 일시정지(위치 유지) 후 재개, stopped = 정지.
 * - 마스터 볼륨: sound-list.md 권장(BGM 0.6은 stages의 mainVol에 이미 반영, 효과음 1.0).
 */
import Phaser from 'phaser';
import manifestJson from '../../assets/audio/audio-manifest.json';
import type { DangerStage } from './dangerStage';

const urls = import.meta.glob('../../assets/audio/**/*.{ogg,mp3}', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

interface SfxEntry { key: string; files: { ogg?: string; mp3?: string }; loop?: boolean }
interface StageParams { rate?: number; mainVol?: number; tensionVol?: number; rampSec?: number; stop?: boolean; fadeOutSec?: number; resumeFadeInSec?: number; resumeStage?: string }
interface Manifest {
  sfx: SfxEntry[];
  bgm: Record<string, { stems: Record<string, { key: string; files: { ogg?: string; mp3?: string } }>; stages: Record<string, StageParams | string>; hysteresis?: { downgradeDelaySec?: number } }>;
}
const manifest = manifestJson as unknown as Manifest;
const BGM_ID = 'bgm_office';
/** 같은 효과음 연타 중복 생략 간격(sound-list: 탭 60ms) */
const SFX_DEDUP_MS = 60;

function fileUrls(files: { ogg?: string; mp3?: string }): string[] {
  const out: string[] = [];
  for (const f of [files.ogg, files.mp3]) if (f) { const u = urls[`../../assets/audio/${f}`]; if (u) out.push(u); }
  return out;
}

export function bgmHysteresisSec(): number { return manifest.bgm[BGM_ID]?.hysteresis?.downgradeDelaySec ?? 1.5; }

/** 볼륨·속도를 바꿀 수 있는 사운드(WebAudio/HTML5 공통 메서드만) */
type Stem = Phaser.Sound.BaseSound & { setVolume(v: number): unknown; setRate(v: number): unknown };

class AudioController {
  private game: Phaser.Game | null = null;
  private loaded = false;
  private loading = false;
  private lastPlay = new Map<string, number>();
  private loops = new Map<string, Phaser.Sound.BaseSound>();
  private main: Stem | null = null;
  private tension: Stem | null = null;
  private stage: DangerStage | 'off' = 'off';
  private cur = { rate: 1, main: 0, tension: 0 };
  private from = { rate: 1, main: 0, tension: 0 };
  private to = { rate: 1, main: 0, tension: 0 };
  private rampT = 0;
  private rampDur = 0;
  private paused = false;
  private wantBgm = false;

  attach(game: Phaser.Game): void { this.game = game; }

  /** 첫 터치 뒤 호출(AudioScene). 로더는 그 씬 것을 쓴다 */
  load(scene: Phaser.Scene): void {
    if (this.loaded || this.loading) return;
    this.loading = true;
    for (const s of manifest.sfx) { const u = fileUrls(s.files); if (u.length) scene.load.audio(s.key, u); }
    for (const st of Object.values(manifest.bgm[BGM_ID]?.stems ?? {})) { const u = fileUrls(st.files); if (u.length) scene.load.audio(st.key, u); }
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.loaded = true; this.loading = false;
      if (this.wantBgm) this.startBgm();
    });
    scene.load.start();
  }

  setMuted(m: boolean): void { if (this.game) this.game.sound.mute = m; }

  private has(key: string): boolean { return !!this.game && this.loaded && this.game.cache.audio.exists(key); }

  sfx(key: string | undefined, volume = 1): void {
    if (!key || !this.has(key)) return;
    const now = performance.now();
    if (now - (this.lastPlay.get(key) ?? -1e9) < SFX_DEDUP_MS) return;
    this.lastPlay.set(key, now);
    this.game!.sound.play(key, { volume });
  }

  /** 루프 효과음 켜기/끄기(의심 루프·발소리). rate는 재생 속도 */
  loop(key: string, on: boolean, rate = 1): void {
    const s = this.loops.get(key);
    if (!on) { if (s) { s.stop(); s.destroy(); this.loops.delete(key); } return; }
    if (!this.has(key)) return;
    if (!s) { const n = this.game!.sound.add(key, { loop: true, rate }); n.play(); this.loops.set(key, n); }
    else (s as unknown as Stem).setRate(rate);
  }

  stopLoops(): void { for (const k of [...this.loops.keys()]) this.loop(k, false); }

  /** 판 시작: BGM 재생(로드 전이면 로드 완료 후 시작) */
  startBgm(): void {
    this.wantBgm = true;
    if (!this.game || !this.loaded) return;
    const stems = manifest.bgm[BGM_ID]?.stems;
    if (!stems?.['main'] || !stems['tension']) return;
    if (!this.main) {
      this.main = this.game.sound.add(stems['main'].key, { loop: true, volume: 0 }) as unknown as Stem;
      this.tension = this.game.sound.add(stems['tension'].key, { loop: true, volume: 0 }) as unknown as Stem;
    }
    if (!this.main!.isPlaying) { this.main!.play(); this.tension!.play(); }
    this.paused = false;
    this.stage = 'off';
    this.setStage('calm');
  }

  stopBgm(): void {
    this.wantBgm = false;
    this.main?.stop(); this.tension?.stop();
    this.stage = 'off';
    this.stopLoops();
  }

  private params(st: string): StageParams {
    const p = manifest.bgm[BGM_ID]?.stages[st];
    return typeof p === 'object' && p ? p : {};
  }

  setStage(st: DangerStage): void {
    if (st === this.stage || !this.main || !this.tension) { if (!this.main) this.stage = st; return; }
    const prev = this.stage;
    this.stage = st;
    const p = this.params(st);
    if (st === 'freeze' || st === 'stopped') {
      // 대표님 전조(BGM 정지, 위치 유지) / 적발·퇴근(정지)
      this.from = { ...this.cur }; this.to = { rate: this.cur.rate, main: 0, tension: 0 };
      this.rampT = 0; this.rampDur = Math.max(0.001, p.fadeOutSec ?? 0.05);
      return;
    }
    if (prev === 'freeze' && this.paused) {
      this.main.resume(); this.tension.resume(); this.paused = false;
      const fp = this.params('freeze');
      const rp = this.params(fp.resumeStage ?? 'calm');
      this.from = { rate: rp.rate ?? 1, main: 0, tension: 0 };
      this.to = { rate: p.rate ?? 1, main: p.mainVol ?? 0.6, tension: p.tensionVol ?? 0 };
      this.rampT = 0; this.rampDur = fp.resumeFadeInSec ?? 0.6;
      return;
    }
    if (prev === 'stopped') { if (!this.main.isPlaying) { this.main.play(); this.tension.play(); } }
    this.from = { ...this.cur };
    this.to = { rate: p.rate ?? 1, main: p.mainVol ?? 0.6, tension: p.tensionVol ?? 0 };
    this.rampT = 0; this.rampDur = p.rampSec ?? 0.5;
  }

  update(dt: number): void {
    if (!this.main || !this.tension) return;
    if (this.rampDur > 0 && this.rampT < this.rampDur) {
      this.rampT = Math.min(this.rampDur, this.rampT + dt);
      const k = this.rampT / this.rampDur;
      this.cur = {
        rate: this.from.rate + (this.to.rate - this.from.rate) * k,
        main: this.from.main + (this.to.main - this.from.main) * k,
        tension: this.from.tension + (this.to.tension - this.from.tension) * k,
      };
      this.main.setVolume(this.cur.main); this.tension.setVolume(this.cur.tension);
      this.main.setRate(this.cur.rate); this.tension.setRate(this.cur.rate);
      if (k >= 1 && (this.stage === 'freeze' || this.stage === 'stopped')) {
        if (this.stage === 'freeze') { this.main.pause(); this.tension.pause(); this.paused = true; }
        else { this.main.stop(); this.tension.stop(); }
      }
    }
  }
}

export const audio = new AudioController();
