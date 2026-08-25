# csv-dashboard

Car Stats Viewer(CSV)의 웹훅을 받아 **Google Sheets에 저장**하고,
**Google Sheets API**로 읽어서 대시보드에 보여주는 웹 앱입니다.

- 백엔드: Node.js + Express
- DB: Google Sheets (무료, 영구 저장)
- API: Google Sheets API (무료)
- 프론트: 정적 HTML + Chart.js
- 호스팅: Render 무료 (또는 자체 호스팅)

---

## 구조

1. **Polestar 4**: Car Stats Viewer 앱 → 주행 데이터 수집
2. **Google Apps Script**: CSV 웹훅 수신 → Google Sheets 저장
3. **이 백엔드** (Render): Google Sheets API로 데이터 읽기 → `/api/trips`, `/api/daily` 제공
4. **대시보드**: `/` 또는 앱 → 백엔드 API 호출해서 데이터 표시

---

## 로컬 실행 (테스트)

```bash
npm install
cp .env.example .env
npm start
# http://localhost:3000
```

---

## Render에 배포

### 1) GitHub에 업로드

이 폴더를 GitHub 저장소로 올립니다.

### 2) Render에서 Web Service 생성

1. render.com에 가입
2. New → Web Service → GitHub 저장소 선택
3. Environment: Node
4. Build Command: `npm install`
5. Start Command: `npm start`
6. Environment Variables 추가:
   - `SHEET_ID`: 구글 시트의 ID
   - `API_KEY`: Google Sheets API 키

### 3) Deploy

배포되면 `https://서비스명.onrender.com` 주소가 생깁니다.

---

## 필수 설정

### Google Sheets 준비

1. Google Sheets 생성
2. Sheet1의 첫 행(헤더):
   ```
   A1: timestamp
   B1: distance_m
   C1: energy_wh
   D1: soc
   E1: trip_type
   ```
3. 시트 공개 설정: **"Anyone with link can view"**

### Google Apps Script (웹훅 핸들러)

Google Sheets의 "확장 프로그램" → "Apps Script"에서 다음 코드 작성:

```javascript
function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSheet();
  const body = JSON.parse(e.postData.contents);
  
  if (!body.drivingPoints || !Array.isArray(body.drivingPoints)) {
    return ContentService.createTextOutput(JSON.stringify({ok: false, error: 'No drivingPoints'}));
  }

  for (const point of body.drivingPoints) {
    const row = [
      new Date(point.driving_point_epoch_time).toLocaleString('ko-KR'),
      point.distance_delta || 0,
      point.energy_delta || 0,
      point.state_of_charge || '',
      point.point_marker_type || ''
    ];
    sheet.appendRow(row);
  }

  return ContentService.createTextOutput(JSON.stringify({ok: true}));
}
```

배포 → 웹앱 → 모든 사용자 → 생성된 URL 복사

### CSV 앱 설정 (Polestar 4)

Car Stats Viewer 앱의 웹훅 설정:
- **Endpoint URL**: `Apps Script 웹앱 URL`
- **Telemetry type**: "Drive points"

---

## API

- `GET /` - 대시보드 HTML
- `GET /api/trips?limit=30` - 최근 트립 목록 (거리/전비/평균속도/소요시간)
- `GET /api/daily?days=30` - 일자별 거리·전비 집계

---

## 주의사항

- **API 키 보안**: .env 파일은 Git에 커밋하지 말고, Render 환경 변수로 설정하세요
- **Google Sheets 공개**: API로 읽으려면 시트가 "Anyone with link can view" 상태여야 합니다
- **Render 무료 티어**: 15분 요청 없으면 잠들지만, 구글 시트는 계속 저장되므로 데이터 유실 없음

