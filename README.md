# 한고연몰 파손 클레임 월별 비교 분석

- 운영 주소: https://hangoyeon-claim-dashboard.vercel.app/
- 배포 저장소: `aropet-joohyun/hangoyeon-claim-dashboard` (`main` → Vercel Production)
- 화면: `index.html`, 서버 API: `api/claims.js`, 변환·집계: `lib/claim-data.js`

## 데이터 기준

페이지를 열거나 새로고침 버튼을 누르면 서버가 원본 CSV를 새로 조회합니다. Google 측 반영 지연은 있을 수 있습니다. 원장 CSV 자체를 브라우저로 전달하지 않습니다.

- 5~8월: 기존 공개 가공 시트의 집계를 유지합니다.
- 9월: CRM `1Ju4GnBA9JtsZZckSWqZ9jRYtblLOLvhXs-upLbUFAK0`, 탭 `2026 9월` (`108127051`). 한고연 판매처의 최종 분류 `파손` → 고객 클레임, `파손반송` → 택배사 파손반송. 자유서술 메모의 키워드로 추정하지 않습니다. 기존 가공 시트의 9월 CRM 기록은 대체하며, 클레임폼 기록은 유지합니다. 서로 다른 사건은 같은 주문이어도 보존하고 동일 사건UID만 중복 제거합니다.
- 공장: `16dmX76WWbAyyHQrCnhwrw51bpmkY9n0QQ3Q0r-3gD1Q`, 탭 `2609 ` (`1947637381`). 한고연몰의 반품 원장 기록·정상 수량·원장 파손 수량을 별도 표시합니다. CRM 건수와 합산하지 않습니다. 개봉 회수 제품도 원장 파손 수량에 포함될 수 있습니다. 미입력 수량은 해당 항목 합산에서 제외하고 행 수를 안내합니다.
- 이름·주문번호는 서버에서 마스킹합니다. 새 CRM의 연락처·주소·자유서술 상담내용은 응답하지 않습니다. 사진은 명시적인 Google Drive 링크가 있을 때만 표시합니다.
- 원본 CRM 또는 기존 가공 시트 조회가 실패하면 집계를 표시하지 않고 재시도 안내를 보여줍니다. 공장 원장만 실패하면 경고와 함께 CRM 집계를 표시합니다.

현재 직접 연결 범위는 **2026년 9월**입니다. 다음 달 연결은 `LIVE_MONTH`와 CRM/공장 탭의 `gid`, 화면 안내를 함께 갱신해야 합니다.

## 개발·검증·배포

```sh
npm test
npm run build
npm run dev
```

로컬 미리보기: http://127.0.0.1:4173

Vercel은 `npm run build`로 생성된 `public/index.html`과 루트 `api/claims.js` 함수를 함께 배포합니다. 원본 고객 CSV는 저장소에 저장하지 않습니다. 시트의 CSV 읽기 권한이 유지되어야 자동 갱신됩니다.
