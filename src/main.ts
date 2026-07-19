// 한 줄 목적: 앱 진입점 — AppShell을 만들어 부팅한다(조율 로직은 src/app·src/controllers에 있다)
import { AppShell } from './app/app-shell';
import { applyDocumentLanguage } from './i18n';

applyDocumentLanguage();
new AppShell().boot();
