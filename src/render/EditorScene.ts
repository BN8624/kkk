// 한 줄 목적: 시나리오 문서를 공유 렌더 계층으로 그리고 칠하기·팬·핀치 입력 정책을 담당하는 에디터 씬
import Phaser from 'phaser';
import { UNIT_STATS } from '../core/data';
import type { ScenarioDocumentV1 } from '../core/scenario/types';
import type { Axial, Tile } from '../core/types';
import { ensureGeneratedTextures, HEX_SIZE, queueExternalAssets, textureKey } from './assets';
import {
  BoardView,
  disposeCameraFit,
  fitCameraToTiles,
  pixelToHex,
  type ViewUnit,
} from './board-view';

export interface EditorSceneCallbacks {
  /** 탭(선택·유닛 배치 등 도구별 처리) */
  onTap: (q: number, r: number) => void;
  /** 드래그 칠하기 중 지나간 육각(중복 호출 가능 — 컨트롤러가 dedupe) */
  onPaint: (q: number, r: number) => void;
  onStrokeStart: () => void;
  onStrokeEnd: () => void;
  /** true면 한 손가락 드래그가 칠하기, false면 팬 */
  isPaintTool: () => boolean;
  onReady: () => void;
}

export class EditorScene extends Phaser.Scene {
  private doc!: ScenarioDocumentV1;
  private callbacks!: EditorSceneCallbacks;
  private view!: BoardView;
  private selectRing!: Phaser.GameObjects.Image;
  private pinchDist = 0;
  private downAt = { x: 0, y: 0, t: 0 };
  private dragging = false;
  private painting = false;
  private lastPaintKey = '';

  constructor() {
    super('editor');
  }

  init(data: { doc: ScenarioDocumentV1; callbacks: EditorSceneCallbacks }): void {
    this.doc = data.doc;
    this.callbacks = data.callbacks;
  }

  preload(): void {
    queueExternalAssets(this);
  }

  create(): void {
    ensureGeneratedTextures(this);
    this.cameras.main.setBackgroundColor('#1d2a44');
    this.view = new BoardView(this);
    this.buildAll();
    this.setupInput();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => disposeCameraFit(this));
    this.events.once(Phaser.Scenes.Events.DESTROY, () => disposeCameraFit(this));
    this.callbacks.onReady();
  }

  /** 새 문서로 전체를 다시 그린다(문서 교체·크기 변경 시). */
  setDoc(doc: ScenarioDocumentV1): void {
    this.doc = doc;
    this.children.removeAll(true);
    this.view.resetRefs();
    this.buildAll();
  }

  private buildAll(): void {
    this.view.buildTerrain(this.doc.board.tiles as Tile[]);
    this.selectRing = this.add.image(0, 0, textureKey('ui.ring.select'));
    this.selectRing.setDisplaySize(Math.sqrt(3) * HEX_SIZE + 4, HEX_SIZE * 2 + 4);
    this.selectRing.setDepth(2);
    this.selectRing.setVisible(false);
    this.refresh();
    fitCameraToTiles(this, this.doc.board.tiles);
  }

  /** 문서와 화면을 동기화한다. 지형은 바뀐 타일만 증분 갱신한다. */
  refresh(): void {
    this.view.syncTerrain(this.doc.board.tiles as Tile[]);
    this.view.syncBuildings(this.doc.board.tiles as Tile[]);
    const units: ViewUnit[] = this.doc.units.map((u, i) => ({
      key: i,
      type: u.type,
      faction: u.faction,
      q: u.q,
      r: u.r,
      hpRatio: u.hp !== undefined && u.hp < UNIT_STATS[u.type].hp ? u.hp / UNIT_STATS[u.type].hp : null,
      dim: u.canAct === false,
    }));
    this.view.syncUnits(units);
    this.selectRing.setDepth(5);
  }

  showSelection(h: Axial | null): void {
    if (!h) {
      this.selectRing.setVisible(false);
      return;
    }
    const { x, y } = this.view.pos(h);
    this.selectRing.setPosition(x, y);
    this.selectRing.setVisible(true);
  }

  zoomBy(factor: number): void {
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * factor, 0.4, 2.2));
  }

  panTo(h: Axial, duration = 350): void {
    const { x, y } = this.view.pos(h);
    this.cameras.main.pan(x, y, duration, 'Sine.easeInOut');
  }

  private hexAtPointer(p: Phaser.Input.Pointer): Axial {
    const world = this.cameras.main.getWorldPoint(p.x, p.y);
    return pixelToHex(world.x, world.y);
  }

  // ---------------- 입력(에디터 정책: 칠 도구 드래그 = 칠하기, 선택 도구 드래그 = 팬) ----------------

  private setupInput(): void {
    this.input.addPointer(1); // 두 손가락 핀치 지원

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.downAt = { x: p.x, y: p.y, t: this.time.now };
      this.dragging = false;
      this.painting = false;
      this.lastPaintKey = '';
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;
      if (p1.isDown && p2.isDown) {
        // 핀치 줌(칠하기 중이었다면 획을 종료한다)
        if (this.painting) {
          this.painting = false;
          this.callbacks.onStrokeEnd();
        }
        const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        if (this.pinchDist > 0) {
          const cam = this.cameras.main;
          cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dist / this.pinchDist), 0.4, 2.2));
        }
        this.pinchDist = dist;
        this.dragging = true;
        return;
      }
      this.pinchDist = 0;
      if (!p.isDown) return;
      const moved =
        Math.abs(p.x - this.downAt.x) > 8 || Math.abs(p.y - this.downAt.y) > 8;
      if (!this.dragging && !moved) return;
      this.dragging = true;
      if (this.callbacks.isPaintTool()) {
        if (!this.painting) {
          this.painting = true;
          this.callbacks.onStrokeStart();
          this.paintPointer(p, this.downAt.x, this.downAt.y);
        }
        this.paintPointer(p, p.x, p.y);
      } else {
        const cam = this.cameras.main;
        cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
        cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
      }
    });

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const wasPinch = this.pinchDist > 0;
      if (!this.input.pointer1.isDown && !this.input.pointer2.isDown) this.pinchDist = 0;
      if (this.painting) {
        this.painting = false;
        this.callbacks.onStrokeEnd();
        return;
      }
      if (wasPinch || this.dragging) return;
      if (this.time.now - this.downAt.t > 600) return;
      const hex = this.hexAtPointer(p);
      this.callbacks.onTap(hex.q, hex.r);
    });
  }

  private paintPointer(_p: Phaser.Input.Pointer, x: number, y: number): void {
    const world = this.cameras.main.getWorldPoint(x, y);
    const hex = pixelToHex(world.x, world.y);
    const key = `${hex.q},${hex.r}`;
    if (key === this.lastPaintKey) return;
    this.lastPaintKey = key;
    this.callbacks.onPaint(hex.q, hex.r);
  }
}
