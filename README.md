# 면접ON

> 학교생활기록부를 분석해 예상 질문을 만들고, 답변을 기록 근거와 비교해 코칭하는 대학 면접 연습 서비스

생기부의 활동·역량·검증 포인트를 구조화하고 코칭 연습 또는 실전 모의면접을 제공합니다. Google 계정으로 로그인하면 분석 결과와 면접 기록이 사용자별로 Firestore에 저장됩니다.

## 주요 기능

- PDF, DOC, DOCX, TXT, JPG, PNG, WEBP, GIF 생기부 분석
- 학생부 활동 근거 기반 질문과 꼬리질문 생성
- 답변 직후 피드백을 제공하는 코칭 연습
- 종료 후 종합 평가를 제공하는 실전 모의면접
- 구체성·논리·진정성·전달력·기록 일치도 리포트
- Firebase Authentication 기반 Google 로그인
- Firestore 기반 사용자별 분석 및 면접 기록 저장
- Vercel Blob 비공개 직접 업로드와 분석 후 원본 삭제

## 구성

```mermaid
flowchart LR
    U[브라우저] -->|Google 로그인| A[Firebase Authentication]
    U -->|비공개 직접 업로드| B[Vercel Blob]
    U -->|ID 토큰과 요청| S[Vercel Express API]
    S -->|토큰 검증| A
    S -->|임시 원본 읽기·삭제| B
    S -->|분석·피드백| O[OpenAI API]
    S -->|계정별 결과 저장| F[(Cloud Firestore)]
```

원본 파일은 Firestore에 저장하지 않습니다. 최대 20MB 파일을 Vercel Blob에 비공개로 임시 업로드하고, 서버가 분석을 마치면 즉시 삭제합니다. 중간 오류로 삭제되지 않은 업로드도 1일 TTL을 적용합니다.

## 기술 스택

| 영역 | 기술 |
| --- | --- |
| 프론트엔드 | HTML, CSS, Vanilla JavaScript, esbuild |
| 서버 | Node.js 24.12+, Express 5, Vercel Functions |
| 인증 | Firebase Authentication, Google Provider |
| 데이터 | Cloud Firestore |
| 임시 파일 | Vercel Blob Private Storage |
| AI | OpenAI Responses API, Structured Outputs |

## 로컬 실행

```bash
git clone <repository-url>
cd interview_ai
npm ci
cp .env.example .env
npm run dev
```

[http://localhost:3000](http://localhost:3000)을 열어 확인합니다. 프론트엔드 코드를 수정한 뒤에는 개발 서버를 다시 시작하거나 `npm run build`를 실행합니다.

## 환경변수

`.env.example`을 참고해 로컬 `.env`와 Vercel의 **Project Settings → Environment Variables**에 설정합니다.

| 변수 | 용도 | 공개 가능 여부 |
| --- | --- | --- |
| `OPENAI_API_KEYS` | 쉼표로 구분한 서버용 OpenAI 키 | 비공개 |
| `OPENAI_MODEL` | 사용할 OpenAI 모델 | 공개 가능 |
| `FIREBASE_WEB_API_KEY` | Firebase 웹 앱 설정의 `apiKey` | 공개 가능 |
| `FIREBASE_AUTH_DOMAIN` | Firebase 웹 앱 설정의 `authDomain` | 공개 가능 |
| `FIREBASE_PROJECT_ID` | Firebase 프로젝트 ID | 공개 가능 |
| `FIREBASE_APP_ID` | Firebase 웹 앱 ID | 공개 가능 |
| `FIREBASE_MESSAGING_SENDER_ID` | 웹 앱 설정값, 선택 | 공개 가능 |
| `FIREBASE_CLIENT_EMAIL` | 서비스 계정 이메일 | 비공개 |
| `FIREBASE_PRIVATE_KEY` | 서비스 계정 JSON의 `private_key` 전체 | 비공개 |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob 연결 시 자동 생성 | 비공개 |

`FIREBASE_PRIVATE_KEY`는 Firebase Web API Key가 아닙니다. Firebase 콘솔의 **프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성**으로 받은 JSON 파일에서 `private_key` 값을 사용합니다. Vercel에는 `-----BEGIN PRIVATE KEY-----`부터 끝까지 그대로 붙여 넣고, 로컬 `.env`에서는 줄바꿈을 `\n`으로 표현할 수 있습니다.

웹 Firebase 설정은 로그인할 프로젝트를 식별하는 값이라 브라우저에 전달됩니다. 반대로 OpenAI 키, 서비스 계정 비공개 키, Blob 토큰은 서버에서만 사용하며 Git에 커밋하면 안 됩니다.

## Firebase 설정

1. Firebase 콘솔에서 웹 앱을 추가합니다.
2. **Authentication → Sign-in method → Google**을 활성화합니다.
3. **Authentication → Settings → Authorized domains**에 배포할 `*.vercel.app` 도메인과 커스텀 도메인을 추가합니다.
4. Firestore Database를 생성합니다.
5. 서비스 계정 JSON을 발급하고 필요한 두 값을 Vercel 환경변수에 넣습니다.
6. `firestore.rules`를 배포합니다.

```bash
firebase deploy --only firestore:rules
```

브라우저가 Firestore에 직접 접근하지 않고 서버의 Admin SDK만 사용하므로, 제공된 규칙은 클라이언트의 모든 직접 읽기·쓰기를 차단합니다. 이 프로젝트는 Firebase Storage를 사용하지 않습니다.

## Vercel 배포

1. 저장소를 GitHub에 push합니다.
2. Vercel에서 저장소를 Import합니다.
3. 프로젝트에 **Storage → Blob** Store를 생성하고 연결합니다.
4. 위 환경변수를 Production, Preview, Development에 필요한 범위로 등록합니다.
5. Deploy 또는 Redeploy를 실행합니다.
6. 배포 주소를 Firebase Authentication의 승인된 도메인에 추가합니다.

환경변수를 새로 추가하거나 변경한 경우 이미 끝난 배포에는 반영되지 않으므로 반드시 다시 배포해야 합니다. Vercel Blob 연결 시 `BLOB_READ_WRITE_TOKEN`은 보통 자동 등록됩니다.

## 데이터 구조

```text
users/{firebaseUid}
├── profiles/{profileId}   # 생기부 분석과 예상 질문
└── sessions/{sessionId}   # 면접 답변과 종합 리포트
```

서버는 검증된 Firebase UID를 기준으로 경로를 만들기 때문에 사용자가 요청 본문에서 다른 UID를 지정할 수 없습니다.

## 테스트

```bash
npm test
node --check server.js
git diff --check
```

GitHub Actions는 push와 pull request마다 테스트를 실행합니다.

## 프로젝트 구조

```text
.
├── client/app.js          # 브라우저 원본 코드
├── lib/
│   ├── firebase.js        # Firebase Admin 초기화 및 ID 토큰 검증
│   ├── repository.js      # 사용자별 Firestore 저장소
│   ├── openai.js          # AI 분석·피드백·리포트
│   └── schemas.js         # Structured Outputs 스키마
├── public/                # 정적 파일과 빌드된 app.js
├── scripts/build-client.mjs
├── test/
├── firebase.json
├── firestore.rules
├── vercel.json
└── server.js
```

## 보안 및 개인정보 주의사항

- `.env`, 서비스 계정 JSON, 사용자 데이터는 `.gitignore`에서 제외됩니다.
- 키가 Git 기록에 한 번이라도 포함됐다면 파일 삭제만 하지 말고 해당 키를 폐기하고 재발급해야 합니다.
- 생기부에는 민감한 개인정보가 포함될 수 있습니다. 공개 운영 전 동의 절차, 보존 기간, 계정 탈퇴 및 데이터 일괄 삭제, 사용량 제한 정책을 추가하세요.
- 현재 구성은 소규모 친구 테스트용 MVP입니다. 불특정 다수에게 공개하기 전 비용 한도와 악용 방지 정책을 점검하세요.
