// 한 줄 목적: 일반 플레이와 에디터가 공유하는 보드 렌더 계층(지형·건물·유닛 토큰·좌표 변환·카메라 맞춤)
import Phaser from 'phaser';
import { axialToPixel, hexKey } from '../core/hex';
import type { Axial, FactionId, Tile, UnitTypeId } from '../core/types';
import { HEX_SIZE, textureKey, type AssetId } from './assets';
import { clearCameraFit, registerCameraFit } from './camera-fit-lifecycle';

export { clearCameraFit, getCameraFitHandler, registerCameraFit } from './camera-fit-lifecycle';

export const UNIT_Y_OFFSET = -8;

/** 렌더 계층이 그리는 유닛 표현(게임 유닛·에디터 배치 유닛 공용). */
export interface ViewUnit {
  key: number;
  type: UnitTypeId;
  faction: FactionId;
  q: number;
  r: number;
  /** null이면 HP 바를 그리지 않는다(에디터 배치 화면) */
  hpRatio: number | null;
  dim: boolean;
}

export interface UnitView {
  container: Phaser.GameObjects.Container;
  token: Phaser.GameObjects.Image;
  hpBar: Phaser.GameObjects.Graphics;
}

/** 화면 좌표(월드) → 육각 좌표. 입력 정책과 무관한 순수 변환이다. */
export function pixelToHex(x: number, y: number, size = HEX_SIZE): Axial {
  const q = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;
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

/** 타일 전체가 화면에 들어오도록 카메라 경계·줌을 맞춘다. 리사이즈에도 다시 맞춘다. */
export function fitCameraToTiles(scene: Phaser.Scene, tiles: { q: number; r: number }[]): void {
  if (tiles.length === 0) return;
  const pts = tiles.map((t) => axialToPixel(t, HEX_SIZE));
  const pad = HEX_SIZE * 3;
  const minX = Math.min(...pts.map((p) => p.x)) - pad;
  const maxX = Math.max(...pts.map((p) => p.x)) + pad;
  const minY = Math.min(...pts.map((p) => p.y)) - pad;
  const maxY = Math.max(...pts.map((p) => p.y)) + pad * 1.6;
  const cam = scene.cameras.main;
  const fit = () => {
    cam.setBounds(minX, minY, maxX - minX, maxY - minY);
    const zoom = Math.min(
      scene.scale.width / (maxX - minX),
      scene.scale.height / (maxY - minY),
    );
    cam.setZoom(Phaser.Math.Clamp(zoom * 1.05, 0.45, 1.4));
    cam.centerOn((minX + maxX) / 2, (minY + maxY) / 2);
  };
  fit();
  // 화면 회전·Safari 주소창 변화 시 지도가 다시 화면에 맞도록 재조정
  registerCameraFit(scene.scale, fit, scene);
}

/** 씬 종료 시 호출해 resize 수명주기를 정리한다. */
export function disposeCameraFit(scene: Phaser.Scene): void {
  clearCameraFit(scene.scale, scene);
}

/**
 * 지형·건물·유닛 토큰을 그리는 공유 렌더러.
 * 입력 정책(플레이 탭·에디터 칠하기)은 각 씬이 별도로 구현한다.
 */
export class BoardView {
  private scene: Phaser.Scene;
  private terrainSprites = new Map<string, Phaser.GameObjects.Image>();
  private buildingSprites = new Map<string, Phaser.GameObjects.Image>();
  private unitViews = new Map<number, UnitView>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  pos(h: Axial): { x: number; y: number } {
    return axialToPixel(h, HEX_SIZE);
  }

  /** 지형 스프라이트를 전부 다시 만든다(보드 구조가 바뀔 때). */
  buildTerrain(tiles: Tile[]): void {
    for (const s of this.terrainSprites.values()) s.destroy();
    this.terrainSprites.clear();
    for (const tile of tiles) this.createTerrainSprite(tile);
  }

  /** 지형을 증분 동기화한다(에디터 칠하기: 바뀐 타일만 텍스처 교체). */
  syncTerrain(tiles: Tile[]): void {
    const present = new Set<string>();
    for (const tile of tiles) {
      const key = hexKey(tile.q, tile.r);
      present.add(key);
      const sprite = this.terrainSprites.get(key);
      const tex = textureKey(`terrain.${tile.terrain}` as AssetId);
      if (!sprite) this.createTerrainSprite(tile);
      else if (sprite.texture.key !== tex) sprite.setTexture(tex);
    }
    for (const [key, sprite] of this.terrainSprites) {
      if (!present.has(key)) {
        sprite.destroy();
        this.terrainSprites.delete(key);
      }
    }
  }

  private createTerrainSprite(tile: Tile): void {
    const { x, y } = this.pos(tile);
    const img = this.scene.add.image(x, y, textureKey(`terrain.${tile.terrain}` as AssetId));
    img.setDisplaySize(Math.sqrt(3) * HEX_SIZE + 4, HEX_SIZE * 2 + 4);
    img.setDepth(0);
    this.terrainSprites.set(hexKey(tile.q, tile.r), img);
  }

  /** 건물 스프라이트를 상태와 동기화한다(추가·소유 변경·제거). */
  syncBuildings(tiles: Tile[]): void {
    const present = new Set<string>();
    for (const tile of tiles) {
      if (!tile.building) continue;
      const key = hexKey(tile.q, tile.r);
      present.add(key);
      const owner = tile.owner ?? 'neutral';
      const assetId = `building.${tile.building}.${owner}` as AssetId;
      let sprite = this.buildingSprites.get(key);
      const { x, y } = this.pos(tile);
      if (!sprite) {
        sprite = this.scene.add.image(x, y - 4, textureKey(assetId));
        sprite.setDepth(1 + y / 10000);
        this.buildingSprites.set(key, sprite);
      } else if (sprite.texture.key !== textureKey(assetId)) {
        sprite.setTexture(textureKey(assetId));
      }
      const size = tile.building === 'village' ? 54 : 62;
      sprite.setDisplaySize(size, size);
    }
    for (const [key, sprite] of this.buildingSprites) {
      if (!present.has(key)) {
        sprite.destroy();
        this.buildingSprites.delete(key);
      }
    }
  }

  /** 유닛 토큰을 목록과 동기화한다(추가·이동·HP·흐림·제거). */
  syncUnits(units: ViewUnit[]): void {
    const present = new Set(units.map((u) => u.key));
    for (const [key, view] of this.unitViews) {
      if (!present.has(key)) {
        view.container.destroy();
        this.unitViews.delete(key);
      }
    }
    for (const unit of units) {
      let view = this.unitViews.get(unit.key);
      const assetId = `unit.${unit.type}.${unit.faction}` as AssetId;
      if (!view) {
        const token = this.scene.add.image(0, 0, textureKey(assetId));
        token.setDisplaySize(46, 51);
        const hpBar = this.scene.add.graphics();
        const container = this.scene.add.container(0, 0, [token, hpBar]);
        view = { container, token, hpBar };
        this.unitViews.set(unit.key, view);
      } else if (view.token.texture.key !== textureKey(assetId)) {
        view.token.setTexture(textureKey(assetId));
        view.token.setDisplaySize(46, 51);
      }
      const { x, y } = this.pos(unit);
      view.container.setPosition(x, y + UNIT_Y_OFFSET);
      view.container.setDepth(3 + y / 10000);
      this.drawHpBar(view.hpBar, unit.hpRatio);
      view.container.setAlpha(unit.dim ? 0.55 : 1);
    }
  }

  private drawHpBar(g: Phaser.GameObjects.Graphics, ratio: number | null): void {
    g.clear();
    if (ratio === null) return;
    const clamped = Phaser.Math.Clamp(ratio, 0, 1);
    const w = 34;
    const h = 5;
    const x = -w / 2;
    const y = 27;
    g.fillStyle(0x1d1a14, 0.85);
    g.fillRoundedRect(x - 1, y - 1, w + 2, h + 2, 2);
    const color = clamped > 0.55 ? 0x64a05a : clamped > 0.28 ? 0xc9a227 : 0xa33636;
    g.fillStyle(color, 1);
    g.fillRoundedRect(x, y, w * clamped, h, 2);
  }

  unitView(key: number): UnitView | undefined {
    return this.unitViews.get(key);
  }

  /** 씬이 children을 파괴한 뒤 내부 참조만 초기화한다. */
  resetRefs(): void {
    this.terrainSprites.clear();
    this.buildingSprites.clear();
    this.unitViews.clear();
  }
}
