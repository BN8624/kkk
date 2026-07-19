// 한 줄 목적: 저장소의 시나리오 초안 목록을 화면용 항목으로 읽어 온다(제작실·커스텀 목록 공용)
import type { ScenarioDocumentV1 } from '../core/scenario/types';
import { documentStore } from '../storage/idb';
import type { EditorDraftItem } from '../ui/editor';

/** 초안 요약 목록. 저장소 접근 실패 시 빈 목록을 돌려준다. */
export async function loadDraftItems(): Promise<EditorDraftItem[]> {
  const drafts: EditorDraftItem[] = [];
  try {
    const list = await documentStore().list('scenario-drafts');
    for (const s of list) {
      const rec = await documentStore().get<ScenarioDocumentV1>('scenario-drafts', s.id);
      if (rec?.data) {
        drafts.push({
          id: s.id,
          title: rec.data.title,
          updatedAt: s.updatedAt,
          sizeBytes: s.size,
          imported: rec.data.metadata?.tags?.includes('imported') ?? false,
        });
      }
    }
  } catch {
    /* 저장소 접근 실패: 초안 없이 표시 */
  }
  return drafts;
}
