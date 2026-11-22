# 면접온

학교생활기록부를 기반으로 대학 면접 질문을 만들고 답변을 코칭하는 웹 MVP입니다.

## 주요 기능

- PDF, DOC, DOCX, TXT와 JPG, PNG, WEBP, GIF 이미지 생기부 분석
- 이메일 회원가입, 로그인·로그아웃, 30일 로그인 유지
- 사용자별 생기부 분석과 면접 기록 분리 저장
- 활동 근거와 평가 의도를 포함한 예상 질문 생성
- 답변 직후 피드백을 받는 `코칭 연습`
- 중간 피드백 없이 끝까지 진행하는 `실전 모의면접`
- 음성 입력(지원 브라우저)과 답변 시간 기록
- 구체성, 논리, 진정성, 전달력, 학생부 일치도 종합 리포트
- 답변별 좋은 점, 개선점, 45~75초 개선 답변

## 실행

Node.js 22 이상을 권장합니다.

```bash
cp .env.example .env
# .env의 OPENAI_API_KEYS에 새로 발급한 키를 쉼표로 구분해 입력
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다. API 키는 반드시 서버의 `.env`에만 두고 브라우저 코드에 넣지 마세요.

처음 실행하면 회원가입 화면이 표시됩니다. 로그인 도입 전에 로컬에 저장된 분석과 면접 기록은 첫 번째로 가입한 계정에 자동으로 연결됩니다.

키를 두 개 이상 순환해서 사용하려면 다음처럼 설정합니다.

```env
OPENAI_API_KEYS=sk-new-key-1,sk-new-key-2
```

각 생기부 분석, 답변 피드백, 종합 리포트 요청은 등록된 키를 라운드 로빈 방식으로 하나씩 사용합니다. 생기부 파일 업로드와 해당 파일 분석은 파일 접근 권한이 유지되도록 반드시 같은 키로 처리합니다. 키 하나만 사용할 때는 기존 `OPENAI_API_KEY`도 지원합니다. 두 환경변수가 모두 있으면 `OPENAI_API_KEYS`가 우선합니다.

## 데이터 처리

- 문서 파일은 서버 메모리에서 OpenAI Files API로 전송하고, 이미지는 응답 요청에 Base64 입력으로 직접 전달합니다.
- 문서 분석이 끝나거나 실패하면 OpenAI에 업로드한 파일 삭제를 시도합니다.
- 로컬 `storage/database.json`에는 원본 파일이 아닌 비식별 분석 결과와 면접 답변만 저장합니다.
- 비밀번호는 `scrypt` 해시로만 저장하며, 로그인 쿠키는 JavaScript에서 읽을 수 없는 HttpOnly 쿠키입니다.
- 계정마다 분석 및 면접 기록에 소유자 ID를 저장하고 모든 API에서 소유권을 확인합니다.
- 생기부 분석을 삭제하면 연결된 면접 기록도 함께 삭제됩니다.
- 현재 저장소는 소규모 친구 테스트를 위한 JSON 파일 방식입니다. 사용자가 늘어나면 관리형 PostgreSQL로 이전하는 것을 권장합니다.

## GitHub에서 배포하기

GitHub Pages는 정적 사이트만 제공하므로 이 프로젝트의 Express 서버와 OpenAI API 호출을 직접 실행할 수 없습니다. 대신 다음 구성으로 배포합니다.

1. 이 폴더를 비공개 GitHub 저장소에 올립니다. `.env`와 `storage/database.json`은 `.gitignore`에 의해 제외되어야 합니다.
2. Render에서 **New Blueprint**를 선택하고 GitHub 저장소를 연결합니다. 루트의 `render.yaml`이 Node 웹 서비스와 영속 디스크를 설정합니다.
3. Render 환경 변수 `OPENAI_API_KEYS`에 새로 발급한 키를 등록합니다.
4. `INVITE_CODE`에 친구들에게만 전달할 긴 초대 코드를 등록합니다.
5. 첫 배포 후 제공되는 `onrender.com` 주소와 초대 코드를 친구들과 공유합니다.

`render.yaml`은 저장 결과가 재배포 후에도 유지되도록 유료 Starter 웹 서비스와 1GB 영속 디스크를 사용합니다. 무료 웹 서비스의 로컬 파일은 재배포 때 사라질 수 있으므로 이 앱의 JSON 저장 방식에는 적합하지 않습니다.

GitHub Actions는 push와 pull request마다 테스트 및 문법 검사를 실행합니다.

> 보안: 저장소의 예제 환경 파일에 실제 API 키가 들어간 적이 있다면 해당 키를 즉시 폐기하고 새 키를 발급하세요. Git 기록에서 파일을 지우는 것만으로는 이미 노출된 키를 안전하게 만들 수 없습니다.

## 기술 구성

- Node.js + Express
- OpenAI Responses API + Structured Outputs
- 기본 모델: `gpt-6.2-sol` (`OPENAI_MODEL`로 변경 가능)
- 외부 프론트엔드 프레임워크 없는 반응형 웹 UI

## 검증

```bash
npm test
node --check server.js
node --check public/app.js
```
# interview_ai
