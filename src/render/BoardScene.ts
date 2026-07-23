// 한 줄 목적: 게임 상태를 육각 보드로 그리고 터치 입력·카메라·전투 연출을 담당하는 Phaser 씬
import Phaser from 'phaser';
import type { Axial, GameState, UnitTypeId } from '../core/types';
import { UNIT_STATS } from '../core/data';
import { axialToPixel } from '../core/hex';
import {
  ensureGeneratedTextures,
  HEX_SIZE,
  queueExternalAssets,
  textureKey,
  type AssetId,
} from './assets';
import { attackAnimKind, isRangedAttackAnim, projectileStyle } from './attack-presentation';
import {
  BoardView,
  disposeCameraFit,
  fitCameraToTiles,
  pixelToHex,
  UNIT_Y_OFFSET,
  type ViewUnit,
} from './board-view';

export interface BoardCallbacks {
  onTileTap: (q: number, r: number) => void;
  onReady: () => void;
  /** 사용자가 드래그·핀치로 카메라를 움직였을 때(제스처 종료 시점, 관측 메타데이터용) */
  onCameraDrag?: () => void;
}

export class BoardScene extends Phaser.Scene {
  private state!: GameState;
  private callbacks!: BoardCallbacks;
  private view!: BoardView;
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
    this.view = new BoardView(this);
    this.buildBoard();
    fitCameraToTiles(this, this.state.tiles);
    this.setupInput();
    // 씬 종료 시 자신이 등록한 resize 콜백만 정리
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => disposeCameraFit(this));
    this.events.once(Phaser.Scenes.Events.DESTROY, () => disposeCameraFit(this));
    this.callbacks.onReady();
  }

  /** 새 게임 상태로 보드를 다시 그린다. */
  setState(state: GameState): void {
    this.state = state;
    this.children.removeAll(true);
    this.view.resetRefs();
    this.highlightPool = [];
    this.buildBoard();
    // fitCameraToTiles가 이전 콜백을 교체하므로 누적되지 않는다
    fitCameraToTiles(this, this.state.tiles);
  }

  private pos(h: Axial): { x: number; y: number } {
    return axialToPixel(h, HEX_SIZE);
  }

  private buildBoard(): void {
    this.view.buildTerrain(this.state.tiles);
    this.selectRing = this.add.image(0, 0, textureKey('ui.ring.select'));
    this.selectRing.setDisplaySize(Math.sqrt(3) * HEX_SIZE + 4, HEX_SIZE * 2 + 4);
    this.selectRing.setDepth(2);
    this.selectRing.setVisible(false);
    this.refresh();
  }

  /** 상태와 화면을 동기화한다(건물 소유·유닛 위치·체력·사망). */
  refresh(): void {
    this.view.syncBuildings(this.state.tiles);
    const humanTurn = this.state.controllers[this.state.current] === 'human';
    const units: ViewUnit[] = this.state.units.map((u) => ({
      key: u.id,
      type: u.type,
      faction: u.faction,
      q: u.q,
      r: u.r,
      hpRatio: u.hp / UNIT_STATS[u.type].hp,
      dim: u.moved && u.attacked && u.faction === this.state.current && humanTurn,
    }));
    this.view.syncUnits(units);
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
      const view = this.view.unitView(unitId);
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
    attackerType: UnitTypeId;
    defenderId: number;
    defenderPos: Axial;
    damage: number;
    counterDamage?: number;
    attackerPos?: Axial;
  }): Promise<void> {
    return new Promise((resolve) => {
      const view = this.view.unitView(o.attackerId);
      const target = this.pos(o.defenderPos);
      if (!view) {
        this.refresh();
        resolve();
        return;
      }
      // 전투 종료 처리: 사망 유닛 페이드 후 화면 동기화
      const finish = () => {
        const deadIds = [o.attackerId, o.defenderId].filter(
          (id) => !this.state.units.some((u) => u.id === id) && this.view.unitView(id) !== undefined,
        );
        for (const id of deadIds) {
          const v = this.view.unitView(id)!;
          this.tweens.add({ targets: v.container, alpha: 0, scale: 0.5, duration: 200 });
        }
        this.time.delayedCall(deadIds.length > 0 ? 220 : 0, () => {
          this.refresh();
          resolve();
        });
      };
      const anim = attackAnimKind(o.attackerType);
      const impact = () => {
        const dmgColor =
          anim === 'bolt'
            ? projectileStyle('bolt').damageTextColor
            : anim === 'arrow'
              ? projectileStyle('arrow').damageTextColor
              : '#ffd9d9';
        this.floatText(target.x, target.y - 26, `-${o.damage}`, dmgColor);
        if (anim === 'bolt') {
          // 관통 특성을 알아볼 수 있는 피격 플래시(규칙·피해량은 불변)
          const style = projectileStyle('bolt');
          const flash = this.add.circle(
            target.x,
            target.y + UNIT_Y_OFFSET,
            style.impactFlashRadius,
            style.impactFlashColor,
            0.85,
          );
          flash.setDepth(10);
          this.tweens.add({
            targets: flash,
            alpha: 0,
            scale: 1.6,
            duration: 160,
            onComplete: () => flash.destroy(),
          });
        }
        this.cameras.main.shake(
          anim === 'cavalry-charge' ? 140 : 90,
          anim === 'cavalry-charge' ? 0.006 : 0.004,
        );
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

      if (isRangedAttackAnim(o.attackerType)) {
        // 궁병 화살 / 쇠뇌대 볼트: 돌진 대신 투사체 연출
        const kind = anim === 'bolt' ? 'bolt' : 'arrow';
        const style = projectileStyle(kind);
        const proj = this.add.circle(
          view.container.x,
          view.container.y - 10,
          style.radius,
          style.color,
        );
        proj.setDepth(9);
        this.tweens.add({
          targets: proj,
          x: target.x,
          y: target.y + UNIT_Y_OFFSET,
          duration: style.durationMs,
          ease: style.ease,
          onComplete: () => {
            proj.destroy();
            impact();
          },
        });
      } else {
        // 보병·수호·약탈·기병: 돌진(기병은 더 깊고 빠르게)
        const ox = view.container.x;
        const oy = view.container.y;
        const depth = anim === 'cavalry-charge' ? 0.5 : 0.3;
        const dx = (target.x - ox) * depth;
        const dy = (target.y + UNIT_Y_OFFSET - oy) * depth;
        this.tweens.add({
          targets: view.container,
          x: ox + dx,
          y: oy + dy,
          duration: anim === 'cavalry-charge' ? 85 : 100,
          yoyo: true,
          ease: 'Sine.easeIn',
          onComplete: impact,
        });
      }
    });
  }

  /** 피격 흔들림 */
  private hitShake(unitId: number): void {
    const view = this.view.unitView(unitId);
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
      const view = this.view.unitView(unitId);
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

  // ---------------- 입력(플레이 정책: 탭 = 행동, 드래그 = 팬) ----------------

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
      if (wasPinch || this.dragging) {
        this.callbacks.onCameraDrag?.();
        return;
      }
      if (this.time.now - this.downAt.t > 500) return;
      const world = this.cameras.main.getWorldPoint(p.x, p.y);
      const hex = pixelToHex(world.x, world.y);
      this.callbacks.onTileTap(hex.q, hex.r);
    });
  }

  zoomBy(factor: number): void {
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * factor, 0.4, 2.2));
  }
}
