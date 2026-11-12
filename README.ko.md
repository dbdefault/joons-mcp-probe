# JOONS MCP Probe

개발자를 위한 가벼운 MCP 서버 검사 및 검증 도구입니다.

![Preview](https://img.shields.io/badge/status-Preview-orange) [![CI](https://github.com/dbdefault/joons-mcp-probe/actions/workflows/ci.yml/badge.svg)](https://github.com/dbdefault/joons-mcp-probe/actions/workflows/ci.yml) ![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)

[JOONS ecosystem](https://github.com/dbdefault/joons-ecosystem)의 일부입니다.

## 검사 항목

stdio 또는 Streamable HTTP로 서버에 연결하여 MCP 프로토콜을 협상하고, 서버 정보와 제공 기능을 확인합니다. 도구 목록을 가져와 각 도구의 이름과 설명, 스키마를 검증합니다. 보고서에는 발견 사항과 각 단계의 소요 시간, 실패 내용이 포함됩니다. 페이지로 나누어진 도구 목록은 정해진 상한까지 확인합니다.

## 수행하지 않는 작업

검사는 읽기 전용으로 진행되며 `tools/call`, `resources/read`, `prompts/get`을 호출하지 않습니다. 초기화, 초기화 완료 알림, `tools/list`를 사용하며 `ping`을 사용할 수도 있습니다. 다만 stdio 서버를 시작하면 사용자가 지정한 명령 자체는 실행되므로, 신뢰하는 서버만 실행하세요.

## 설치

Node.js 20 이상이 필요합니다. 소스에서 전역으로 설치하거나 전역 설치 없이 실행할 수 있습니다.

```sh
npm install -g github:dbdefault/joons-mcp-probe#v0.1.0
npx github:dbdefault/joons-mcp-probe#v0.1.0 --help
```

소스 체크아웃에서 의존성을 설치했다면 `joons-mcp-probe` 대신 `node bin/joons-mcp-probe.js`를 사용할 수 있습니다.

## 빠른 시작

전역 설치 후에는 본인 서버의 절대 경로를 사용하세요. 저장소 예제는 복제한 저장소 루트에서 `node bin/joons-mcp-probe.js stdio -- node examples/stdio-server.js`로 실행하세요.

```sh
joons-mcp-probe stdio -- node /absolute/path/to/your-server.js
joons-mcp-probe http https://example.com/mcp
```

인증이 필요한 HTTP 서버를 검사하려면 비밀 관리 도구나 셸을 통해 전체 헤더 값을 환경 변수에 설정한 다음, 아래처럼 변수 이름을 전달하세요. 헤더 값에는 필요한 경우 `Bearer` 접두사도 포함해야 합니다.

```sh
joons-mcp-probe http https://example.com/mcp --header Authorization=PROBE_TOKEN
```

`--header NAME=ENVVAR`는 지정한 환경 변수의 현재 값을 읽습니다. 변수가 없으면 사용 오류가 발생합니다. 토큰은 URL이나 명령 인수에 직접 넣지 마세요. stdio에서는 `--env NAME`으로 현재 환경 변수 값을 자식 프로세스에 전달할 수 있습니다. 헤더 값과 전달된 환경 변수 값은 보고서에서 마스킹할 비밀값으로 등록됩니다. 자세한 사용법은 [HTTP 예제](examples/probe-http.md)와 [라이브러리 예제](examples/probe-stdio.js)를 참고하세요.

## 보고서 예시

다음은 이해를 돕기 위한 출력 예시입니다. 실제 실행 시 시작 및 종료 시각과 소요 시간은 달라지며, 검사 대상 서버가 제공하는 정보와 발견된 문제에 따라 보고서의 내용도 달라집니다. JSON 예시는 도구 정보 부분을 포함하여 스키마 버전 1의 전체 보고서를 보여줍니다.

```text
# MCP Probe: PASS

Target: stdio node examples/stdio-server.js

## Server

| Field | Value |
| --- | --- |
| Name | example-server |
| Version | 1.0.0 |
| Protocol version | 2025-11-25 |
| Capabilities | {"tools":{}} |
| Instructions present | false |

## Timings

| Step | Milliseconds |
| --- | ---: |
| Connect | 1 |
| Initialize | 2 |
| Tools list | 3 |
| Total | 6 |

## Tools

| Name | Description | Schema valid |
| --- | --- | --- |
| hello | true | true |

## Findings
```

```json
{
  "schemaVersion": 1,
  "tool": { "name": "joons-mcp-probe", "version": "0.1.0" },
  "startedAt": "2026-01-01T00:00:00.000Z",
  "finishedAt": "2026-01-01T00:00:00.006Z",
  "target": { "transport": "stdio", "command": "node", "args": ["examples/stdio-server.js"] },
  "status": "PASS",
  "server": { "name": "example-server", "version": "1.0.0", "protocolVersion": "2025-11-25", "capabilities": { "tools": {} }, "instructionsPresent": false },
  "timings": { "connectMs": 1, "initializeMs": 2, "toolsListMs": 3, "totalMs": 6 },
  "tools": { "count": 1, "pages": 1, "items": [{ "name": "hello", "hasDescription": true, "schemaValid": true }] },
  "findings": [],
  "failure": null
}
```

## 종료 코드

| 코드 | 의미 |
| --- | --- |
| 0 | PASS 또는 기본 설정인 `--fail-on fail`에서의 WARNING |
| 1 | `--fail-on warning` 설정에서의 WARNING |
| 2 | FAIL |
| 3 | 사용 오류 |
| 4 | 출력 오류 |

## CI에서 사용하기

`--json-out report.json`을 지정하면 기계가 읽을 수 있는 JSON 보고서를 저장할 수 있습니다. `--fail-on warning`을 함께 지정하면 경고도 실패로 처리합니다. [GitHub Actions 예제](examples/github-actions.yml)는 검사가 실패한 경우에도 보고서 업로드를 시도합니다. CI 제공 서비스에 비밀값을 설정하고, `--header`에는 비밀값 자체가 아닌 환경 변수 이름을 전달하세요.

## 제한 사항

이 버전은 0.1.0 Preview이며 보안 감사나 서버가 안전하다는 증명을 대신하지 않습니다. 검사 결과가 정상이더라도 서버의 실제 동작이나 배포 환경 전체의 안전성을 보장하는 것은 아닙니다. 도구를 실행하지 않고 메타데이터와 스키마를 검사합니다. stdio와 Streamable HTTP를 지원하며 도구 목록은 최대 50페이지까지 확인합니다. 또한 시간 초과와 stderr 수집량에 제한을 적용합니다. 서버에 도구 기능이 없으면 경고로 보고합니다. 보고서는 전달받아 알고 있는 비밀값과 HTTP URL의 사용자 정보 및 쿼리 값을 마스킹합니다. 알려지지 않은 임의의 비밀값까지 마스킹 기능이 모두 알아낼 것이라고 가정하지 마세요.

## 추가 정보

[API](docs/API.md) · [아키텍처](docs/ARCHITECTURE.md) · [실전 검증 사례(영문)](docs/REAL_WORLD_VALIDATION.md) · [기여 안내](CONTRIBUTING.md) · [보안](SECURITY.md) · [변경 내역](CHANGELOG.md) · [한국어](README.ko.md)

Windows 배치 파일(.cmd/.bat, PATH/PATHEXT 검색 포함)은 사용 오류(3)로 거부합니다. 셸 해석이 필요하면 stdio -- cmd.exe /d /s /c <file>을 명시적으로 선택하세요. 비밀값은 일반적인 URL/base64/base64url 인코딩과 Authorization 에코까지 마스킹하며, Markdown과 터미널 JSON에서는 bidi 및 제어문자를 비활성화합니다. 정확한 범위는 docs/API.md에 설명되어 있습니다.

모든 길이의 비어 있지 않은 비밀값과 지원 인코딩은 자유 텍스트 및 서버가 만든 객체 키의 부분 문자열에서 마스킹합니다. 전체 토큰 예외는 없습니다. 계약 제어 키·필드와 상태·시각·수치는 보존하며 상태 및 종료 코드는 마스킹 전에 계산합니다. 깊이 64를 넘는 데이터는 [depth limit]로 바꾸고 RESPONSE_TOO_DEEP 경고를 남깁니다.

probe()는 totalTimeoutMs + closeTimeoutMs + 1000 ms 안에 완료됩니다. 정리는 별도 closeTimeoutMs 예산(기본 3000)을 사용합니다. 직접 자식, 소유한 POSIX 그룹 및 Windows에서 발견한 하위 프로세스는 정리·검증합니다. 트리·그룹에서 이탈한 프로세스는 보장할 수 없으며 알려진 생존 프로세스 또는 검증 불가 시 CLEANUP_INCOMPLETE 경고를 남깁니다. POSIX 실제 실행과 Windows 네이티브 Ctrl+C는 로컬에서 미검증입니다. 출력 오류는 종료 코드 4입니다. 이번 계약 소유자의 Amendments A1–A4에 따릅니다.
