# 📊 내 대시보드

뉴스(키워드 RSS) + 일정·할 일 + 투자(주식·금·코인) 수익률·배당을 한 화면에서 보는 개인 대시보드입니다.
개인 데이터는 비공개 저장소 `my-data` 에 저장되고, 토큰으로 연결한 기기에서만 보입니다.

## 뉴스 피드

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

## 📱 매일 아침 핸드폰 알림 (ntfy)
`.github/workflows/morning-notify.yml` 이 매일 한국시간 07:30에 최신 뉴스를 수집하고 (06:37에 미리 시작해 07:30까지 대기)
최근 24시간 기사 요약을 [ntfy](https://ntfy.sh) 푸시 알림으로 보냅니다.

1. 핸드폰에 **ntfy** 앱 설치 (iOS App Store / Google Play)
2. 앱에서 `+` → 남이 추측하기 어려운 토픽 이름으로 구독 (예: `news-xxxx-랜덤문자열`)
3. 저장소 **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `NTFY_TOPIC`, Secret: 위에서 정한 토픽 이름
4. **Actions → 아침 알림 → Run workflow** 로 테스트

토픽 이름을 아는 사람은 누구나 알림을 받을 수 있으므로 길고 랜덤하게 정하세요.

## 구글 캘린더 연동
구글 캘린더 일정이 대시보드 달력·홈·아침 알림에 함께 표시됩니다. (구글 → 대시보드 방향, 2시간마다 동기화)
대시보드에서 만든 일정은 옆의 **G+** 버튼으로 구글 캘린더에 바로 추가할 수 있습니다.

1. PC에서 [구글 캘린더 설정](https://calendar.google.com/calendar/r/settings) → 왼쪽 **내 캘린더의 설정**에서 캘린더 선택
2. **캘린더 통합** → **iCal 형식의 비밀 주소** 복사 (`https://calendar.google.com/calendar/ical/.../private-.../basic.ics`)
3. `my-data` 저장소 **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `GCAL_ICS_URL`, Secret: 복사한 주소 (캘린더가 여러 개면 줄바꿈으로 여러 줄)
4. `my-data` → **Actions → 구글 캘린더 가져오기 → Run workflow**

비밀 주소를 아는 사람은 캘린더를 볼 수 있으니 다른 곳에 공유하지 마세요. 유출되면 같은 화면에서 **재설정**하면 됩니다.
