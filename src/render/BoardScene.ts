// 한 줄 목적: 게임 상태를 육각 보드로 그리고 터치 입력·카메라·전투 연출을 담당하는 Phaser 씬
import Phaser from 'phaser';
import type { Axial, GameState, Unit } from '../core/types';
import { UNIT_STATS } from '../core/data';
import { axialToPixel, hexKey } from '../core/hex';
import {
  ensureGeneratedTextures,
  HEX_SIZE,
  queueExternalAssets,
  textureKey,
  type AssetId,
} from './assets';

export interface BoardCallbacks {
  onTileTap: (q: number, r: number) => void;
  onReady: () => void;
}

interface UnitView {
  container: Phaser.GameObjects.Container;
  token: Phaser.GameObjects.Image;
  hpBar: Phaser.GameObjects.Graphics;
}

const UNIT_Y_OFFSET = -8;

export class BoardScene extends Phaser.Scene {
  private state!: GameState;
  private callbacks!: BoardCallbacks;
  private buildingSprites = new Map<string, Phaser.GameObjects.Image>();
  private unitViews = new Map<number, UnitView>();
  private highlightPool: Phaser.GameObjects.Image[] = [];
  private selectRing!: Phaser.GameObjects.Image;
  private ringTween?: Phaser.Tweens.Tween;
  private pinchDist = 0;
  private downAt = { x: 0, y: 0, t: 0 };
  private dragging = false;

  constructor() {
    super('board');
  }

  init(data: { state: GameState; callbacks: BoardCallbacks }): void {
    this.state = data.state;
    this.callbacks = data.callbacks;
  }

  preload(): void {
    queueExternalAssets(this);
  }

  create(): void {
    ensureGeneratedTextures(this);
    this.cameras.main.setBackgroundColor('#1d2a44');
    this.buildBoard();
    this.setupCamera();
    this.setupInput();
    this.callbacks.onReady();
  }

  /** 새 게임 상태로 보드를 다시 그린다. */
  setState(state: GameState): void {
    this.state = state;
    this.children.removeAll(true);
    this.buildingSprites.clear();
    this.unitViews.clear();
    this.highlightPool = [];
    this.buildBoard();
    this.setupCamera();
  }

  private pos(h: Axial): { x: number; y: number } {
    return axialToPixel(h, HEX_SIZE);
  }

  private buildBoard(): void {
    for (const tile of this.state.tiles) {
      const { x, y } = this.pos(tile);
      const img = this.add.image(x, y, textureKey(`terrain.${tile.terrain}` as AssetId));
      img.setDisplaySize(Math.sqrt(3) * HEX_SIZE + 4, HEX_SIZE * 2 + 4);
      img.setDepth(0);
    }
    this.selectRing = this.add.image(0, 0, textureKey('ui.ring.select'));
    this.selectRing.setDisplaySize(Math.sqrt(3) * HEX_SIZE + 4, HEX_SIZE * 2 + 4);
    this.selectRing.setDepth(2);
    this.selectRing.setVisible(false);
    this.refresh();
  }

  /** 상태와 화면을 동기화한다(건물 소유·유닛 위치·체력·사망). */
  refresh(): void {
    for (const tile of this.state.tiles) {
      if (!tile.building) continue;
      const key = hexKey(tile.q, tile.r);
      const owner = tile.owner ?? 'neutral';
      const assetId = `building.${tile.building}.${owner}` as AssetId;
      let sprite = this.buildingSprites.get(key);
      const { x, y } = this.pos(tile);
      if (!sprite) {
        sprite = this.add.image(x, y - 4, textureKey(assetId));
        sprite.setDepth(1 + y / 10000);
        this.buildingSprites.set(key, sprite);
      } else if (sprite.texture.key !== textureKey(assetId)) {
        sprite.setTexture(textureKey(assetId));
      }
      const size = tile.building === 'village' ? 54 : 62;
      sprite.setDisplaySize(size, size);
    }

    const alive = new Set(this.state.units.map((u) => u.id));
    for (const [id, view] of this.unitViews) {
      if (!alive.has(id)) {
        view.container.destroy();
        this.unitViews.delete(id);
      }
    }
    for (const unit of this.state.units) {
      let view = this.unitViews.get(unit.id);
      if (!view) view = this.createUnitView(unit);
      const { x, y } = this.pos(unit);
      view.container.setPosition(x, y + UNIT_Y_OFFSET);
      view.container.setDepth(3 + y / 10000);
      this.drawHpBar(view.hpBar, unit);
      const done = unit.moved && unit.attacked;
      const humanTurn = this.state.controllers[this.state.current] === 'human';
      view.container.setAlpha(done && unit.faction === this.state.current && humanTurn ? 0.55 : 1);
    }
  }

  private createUnitView(unit: Unit): UnitView {
    const token = this.add.image(0, 0, textureKey(`unit.${unit.type}.${unit.faction}` as AssetId));
    token.setDisplaySize(46, 51);
    const hpBar = this.add.graphics();
    const container = this.add.container(0, 0, [token, hpBar]);
    const view = { container, token, hpBar };
    this.unitViews.set(unit.id, view);
    return view;
  }

  private drawHpBar(g: Phaser.GameObjects.Graphics, unit: Unit): void {
    const max = UNIT_STATS[unit.type].hp;
    const ratio = Phaser.Math.Clamp(unit.hp / max, 0, 1);
    g.clear();
    const w = 34;
    const h = 5;
    const x = -w / 2;
    const y = 27;
    g.fillStyle(0x1d1a14, 0.85);
    g.fillRoundedRect(x - 1, y - 1, w + 2, h + 2, 2);
    const color = ratio > 0.55 ? 0x64a05a : ratio > 0.28 ? 0xc9a227 : 0xa33636;
    g.fillStyle(color, 1);
    g.fillRoundedRect(x, y, w * ratio, h, 2);
  }

  // ---------------- 하이라이트 ----------------

  showHighlights(moves: Axial[], attacks: Axial[]): void {
    this.clearHighlights();
    const place = (h: Axial, asset: AssetId) => {
      const { x, y } = this.pos(h);
      const img = this.add.image(x, y, textureKey(asset));
      img.setDisplaySize(Math.sqrt(3) * HEX_SIZE + 4, HEX_SIZE * 2 + 4);
      img.setDepth(1.5);
      this.highlightPool.push(img);
    };
    for (const m of moves) place(m, 'ui.highlight.move');
    for (const a of attacks) place(a, 'ui.highlight.attack');
  }

  clearHighlights(): void {
    for (const img of this.highlightPool) img.destroy();
    this.highlightPool = [];
  }

  showSelection(h: Axial | null): void {
    this.ringTween?.stop();
    if (!h) {
      this.selectRing.setVisible(false);
      return;
    }
    const { x, y } = this.pos(h);
    this.selectRing.setPosition(x, y);
    this.selectRing.setVisible(true);
    this.selectRing.setAlpha(1);
    this.ringTween = this.tweens.add({
      targets: this.selectRing,
      alpha: 0.45,
      duration: 600,
      yoyo: true,
      repeat: -1,
    });
  }

  // ---------------- 연출 ----------------

  /** AI 턴 재생 속도(트윈·타이머 배속) */
  setSpeed(factor: number): void {
    this.tweens.timeScale = factor;
    this.time.timeScale = factor;
  }

  animateMove(unitId: number, path: Axial[]): Promise<void> {
    return new Promise((resolve) => {
      const view = this.unitViews.get(unitId);
      if (!view || path.length < 2) {
        this.refresh();
        resolve();
        return;
      }
      // 병과별 이동 속도: 기병은 빠르고 궁병은 느리다
      const unit = this.state.units.find((u) => u.id === unitId);
      const stepMs = unit?.type === 'cavalry' ? 80 : unit?.type === 'archer' ? 125 : 105;
      const points = path.map((p) => this.pos(p));
      let i = 1;
      const step = () => {
        if (i >= points.length) {
          this.refresh();
          resolve();
          return;
        }
        const target = points[i];
        i++;
        this.tweens.add({
          targets: view.container,
          x: target.x,
          y: target.y + UNIT_Y_OFFSET,
          duration: stepMs,
          ease: 'Sine.easeInOut',
          onComplete: step,
        });
      };
      step();
    });
  }

  animateAttack(o: {
    attackerId: number;
    attackerType: 'infantry' | 'archer' | 'cavalry';
    defenderId: number;
    defenderPos: Axial;
    damage: number;
    counterDamage?: number;
    attackerPos?: Axial;
  }): Promise<void> {
    return new Promise((resolve) => {
      const view = this.unitViews.get(o.attackerId);
      const target = this.pos(o.defenderPos);
      if (!view) {
        this.refresh();
        resolve();
        return;
      }
      // 전투 종료 처리: 사망 유닛 페이드 후 화면 동기화
      const finish = () => {
        const deadIds = [o.attackerId, o.defenderId].filter(
          (id) => !this.state.units.some((u) => u.id === id) && this.unitViews.has(id),
        );
        for (const id of deadIds) {
          const v = this.unitViews.get(id)!;
          this.tweens.add({ targets: v.container, alpha: 0, scale: 0.5, duration: 200 });
        }
        this.time.delayedCall(deadIds.length > 0 ? 220 : 0, () => {
          this.refresh();
          resolve();
        });
      };
      const impact = () => {
        this.floatText(target.x, target.y - 26, `-${o.damage}`, '#ffd9d9');
        this.cameras.main.shake(o.attackerType === 'cavalry' ? 140 : 90, o.attackerType === 'cavalry' ? 0.006 : 0.004);
        this.hitShake(o.defenderId);
        if (o.counterDamage && o.attackerPos) {
          const ap = this.pos(o.attackerPos);
          this.time.delayedCall(220, () => {
            this.floatText(ap.x, ap.y - 26, `-${o.counterDamage}`, '#ffeebb');
            this.hitShake(o.attackerId);
            finish();
          });
        } else {
          finish();
        }
      };

      if (o.attackerType === 'archer') {
        // 궁병: 돌진 대신 투사체 연출
        const proj = this.add.circle(view.container.x, view.container.y - 10, 3.5, 0xf2ead8);
        proj.setDepth(9);
        this.tweens.add({
          targets: proj,
          x: target.x,
          y: target.y + UNIT_Y_OFFSET,
          duration: 220,
          ease: 'Sine.easeIn',
          onComplete: () => {
            proj.destroy();
            impact();
          },
        });
      } else {
        // 보병·기병: 돌진(기병은 더 깊고 빠르게)
        const ox = view.container.x;
        const oy = view.container.y;
        const depth = o.attackerType === 'cavalry' ? 0.5 : 0.3;
        const dx = (target.x - ox) * depth;
        const dy = (target.y + UNIT_Y_OFFSET - oy) * depth;
        this.tweens.add({
          targets: view.container,
          x: ox + dx,
          y: oy + dy,
          duration: o.attackerType === 'cavalry' ? 85 : 100,
          yoyo: true,
          ease: 'Sine.easeIn',
          onComplete: impact,
        });
      }
    });
  }

  /** 피격 흔들림 */
  private hitShake(unitId: number): void {
    const view = this.unitViews.get(unitId);
    if (!view) return;
    const x = view.container.x;
    this.tweens.add({
      targets: view.container,
      x: x + 4,
      duration: 40,
      yoyo: true,
      repeat: 2,
      onComplete: () => view.container.setX(x),
    });
  }

  animateSpawn(unitId: number): Promise<void> {
    return new Promise((resolve) => {
      this.refresh();
      const view = this.unitViews.get(unitId);
      if (!view) {
        resolve();
        return;
      }
      view.container.setScale(0.2);
      this.tweens.add({
        targets: view.container,
        scale: 1,
        duration: 200,
        ease: 'Back.easeOut',
        onComplete: () => resolve(),
      });
    });
  }

  animateCapture(at: Axial, major = false): Promise<void> {
    return new Promise((resolve) => {
      this.refresh();
      const { x, y } = this.pos(at);
      const rings = major ? 2 : 1;
      if (major) this.cameras.main.shake(160, 0.005);
      for (let i = 0; i < rings; i++) {
        const ring = this.add.image(x, y, textureKey('ui.ring.select'));
        ring.setDisplaySize(Math.sqrt(3) * HEX_SIZE + 4, HEX_SIZE * 2 + 4);
        ring.setDepth(5);
        this.tweens.add({
          targets: ring,
          scale: ring.scale * (1.6 + i * 0.5),
          alpha: 0,
          duration: 450 + i * 150,
          delay: i * 120,
          onComplete: () => {
            ring.destroy();
            if (i === rings - 1) resolve();
          },
        });
      }
    });
  }

  floatText(x: number, y: number, text: string, color: string): void {
    const t = this.add.text(x, y, text, {
      fontFamily: 'Georgia, serif',
      fontSize: '20px',
      color,
      stroke: '#1d1a14',
      strokeThickness: 4,
    });
    t.setOrigin(0.5);
    t.setDepth(10);
    this.tweens.add({
      targets: t,
      y: y - 30,
      alpha: 0,
      duration: 900,
      ease: 'Sine.easeOut',
      onComplete: () => t.destroy(),
    });
  }

  /** 육각 좌표의 현재 화면 좌표를 반환한다(E2E 테스트·입력 검증용). */
  screenPos(h: Axial): { x: number; y: number } {
    const { x, y } = this.pos(h);
    const cam = this.cameras.main;
    return { x: (x - cam.worldView.x) * cam.zoom, y: (y - cam.worldView.y) * cam.zoom };
  }

  /** 특정 타일이 화면 중앙 부근에 오도록 카메라를 이동한다. */
  panTo(h: Axial, duration = 350): void {
    const { x, y } = this.pos(h);
    this.cameras.main.pan(x, y, duration, 'Sine.easeInOut');
  }

  // ---------------- 카메라·입력 ----------------

  private setupCamera(): void {
    const xs = this.state.tiles.map((t) => this.pos(t).x);
    const ys = this.state.tiles.map((t) => this.pos(t).y);
    const pad = HEX_SIZE * 3;
    const minX = Math.min(...xs) - pad;
    const maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad;
    const maxY = Math.max(...ys) + pad * 1.6;
    const cam = this.cameras.main;
    const fit = () => {
      cam.setBounds(minX, minY, maxX - minX, maxY - minY);
      const zoom = Math.min(
        this.scale.width / (maxX - minX),
        this.scale.height / (maxY - minY),
      );
      cam.setZoom(Phaser.Math.Clamp(zoom * 1.05, 0.45, 1.4));
      cam.centerOn((minX + maxX) / 2, (minY + maxY) / 2);
    };
    fit();

    // 화면 회전·Safari 주소창 변화 시 지도가 다시 화면에 맞도록 재조정
    this.scale.off('resize');
    this.scale.on('resize', fit);
  }

  private setupInput(): void {
    this.input.addPointer(1); // 두 손가락 핀치 지원

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.downAt = { x: p.x, y: p.y, t: this.time.now };
      this.dragging = false;
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;
      if (p1.isDown && p2.isDown) {
        // 핀치 줌
        const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        if (this.pinchDist > 0) {
          const cam = this.cameras.main;
          const next = Phaser.Math.Clamp(cam.zoom * (dist / this.pinchDist), 0.4, 2.2);
          cam.setZoom(next);
        }
        this.pinchDist = dist;
        this.dragging = true;
        return;
      }
      this.pinchDist = 0;
      if (!p.isDown) return;
      const dx = p.x - p.prevPosition.x;
      const dy = p.y - p.prevPosition.y;
      if (
        this.dragging ||
        Math.abs(p.x - this.downAt.x) > 8 ||
        Math.abs(p.y - this.downAt.y) > 8
      ) {
        this.dragging = true;
        const cam = this.cameras.main;
        cam.scrollX -= dx / cam.zoom;
        cam.scrollY -= dy / cam.zoom;
      }
    });

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const wasPinch = this.pinchDist > 0;
      if (!this.input.pointer1.isDown && !this.input.pointer2.isDown) this.pinchDist = 0;
      if (wasPinch || this.dragging) return;
      if (this.time.now - this.downAt.t > 500) return;
      const world = this.cameras.main.getWorldPoint(p.x, p.y);
      const hex = this.pixelToHex(world.x, world.y);
      this.callbacks.onTileTap(hex.q, hex.r);
    });
  }

  zoomBy(factor: number): void {
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * factor, 0.4, 2.2));
  }

  private pixelToHex(x: number, y: number): Axial {
    const q = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / HEX_SIZE;
    const r = ((2 / 3) * y) / HEX_SIZE;
    // cube round
    const s = -q - r;
    let rq = Math.round(q);
    let rr = Math.round(r);
    const rs = Math.round(s);
    const dq = Math.abs(rq - q);
    const dr = Math.abs(rr - r);
    const ds = Math.abs(rs - s);
    if (dq > dr && dq > ds) rq = -rr - rs;
    else if (dr > ds) rr = -rq - rs;
    return { q: rq, r: rr };
  }
}
