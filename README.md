# 📰 내 뉴스 피드

등록한 키워드의 뉴스를 Google 뉴스 RSS로 모아 키워드별 탭으로 보여주는 개인 사이트입니다.
GitHub Pages(정적 페이지) + GitHub Actions(정기 수집)만으로 동작하며 서버 비용이 없습니다.

## 동작 방식
- `keywords.json` — 등록 키워드 목록
- `scripts/fetch.mjs` — 키워드별 RSS 수집 → `data/news.json` (최근 7일 보관, 중복 제거)
- `.github/workflows/fetch-news.yml` — 한국시간 06~23시 2시간마다, 키워드 변경 시, 수동 실행 시 수집
- `index.html` — 키워드 탭 · 오늘/3일/7일 필터 · 검색 · NEW 표시 · 키워드 추가/삭제

## 처음 설정
1. 저장소 **Settings → Pages** → Source: `Deploy from a branch`, Branch: `main` / `(root)`
2. **Settings → Actions → General → Workflow permissions** → `Read and write permissions`
3. **Actions** 탭 → "뉴스 수집" → `Run workflow` 로 첫 수집
4. 사이트의 ⚙︎ 에서 Fine-grained 토큰(이 저장소만, Contents·Actions 읽기/쓰기)을 입력하면
   웹에서 키워드 추가·삭제와 즉시 수집이 가능합니다. 토큰은 각 기기 브라우저에만 저장됩니다.

## 로컬 수집 테스트
```bash
node scripts/fetch.mjs
```
