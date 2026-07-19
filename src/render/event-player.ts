// 한 줄 목적: 정본 GameEvent 목록을 보드 씬 연출로 재생한다(플레이 AI 턴·리플레이 재생 공용)
import type { GameEvent } from '../core/command';
import { sfx } from './sound';
import type { BoardScene } from './BoardScene';

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 정본 이벤트를 순서대로 연출한다. 이벤트가 공격·사망 시점 좌표를 보존하므로 연출 생략이 없다. */
export async function playEvents(scene: BoardScene | null, events: GameEvent[], skip = false): Promise<void> {
  if (!scene) return;
  // 건너뛰기: 연출 없이 결과만 반영
  if (skip) {
    scene.refresh();
    await delay(120);
    return;
  }
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    switch (ev.type) {
      case 'unit-moved': {
        scene.panTo(ev.to, 200);
        await scene.animateMove(ev.unitId, ev.path);
        break;
      }
      case 'unit-attacked': {
        sfx.attack();
        // 같은 교전의 반격 이벤트를 찾아 함께 연출한다
        let counter: number | undefined;
        for (let j = i + 1; j < events.length; j++) {
          const t = events[j];
          if (t.type === 'unit-countered') {
            counter = t.damage;
            break;
          }
          if (t.type !== 'unit-damaged' && t.type !== 'unit-died') break;
        }
        await scene.animateAttack({
          attackerId: ev.attackerId,
          attackerType: ev.attackerType,
          defenderId: ev.defenderId,
          defenderPos: ev.at,
          damage: ev.damage,
          counterDamage: counter,
          attackerPos: ev.from,
        });
        break;
      }
      case 'unit-died':
        sfx.hit();
        break;
      case 'building-captured': {
        sfx.capture();
        await scene.animateCapture(ev.at, ev.building !== 'village');
        break;
      }
      case 'unit-produced':
        await scene.animateSpawn(ev.unitId);
        break;
      default:
        break;
    }
  }
  scene.refresh();
}
