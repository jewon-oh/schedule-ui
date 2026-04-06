# HA Custom Schedule Card (v1.0.0)

Home Assistant의 순정 `schedule` 헬퍼를 시각적으로 관리하고, 기기를 연결해 통째로 동작 브릿지(Automation)까지 자동으로 생성해주는 **올인원 커스텀 카드**입니다.

단일 JavaScript 파일로 구성되어 있으며, 외부 의존성 없이 동작합니다. 사용자의 Home Assistant 언어 설정에 따라 한국어와 영어 인터페이스가 자동으로 전환됩니다.

## ✨ 주요 기능

* **루틴 자동 생성 마법사 (초간편 설정)** — HA의 복잡한 스케줄 도우미 생성과 자동화 구축을 클릭 한 번으로 끝냅니다. 대시보드 편집창(좌측)에서 제어할 기기만 선택하면, 자동으로 'Schedule 헬퍼'와 '기기 켜짐/꺼짐 자동화(Bridge)'가 즉시 생성되어 화면에 연결됩니다.
* **단일 파일 구조** — `schedule-ui.js` 하나로 설치와 관리가 간단하며, HACS 커스텀 저장소 등록을 완벽하게 지원합니다.
* **24시간 주간 타임라인** — 등록된 요일별 시간 블록을 24시간 바 형태로 시각화하여 일정을 한눈에 파악할 수 있으며, 현재 시각 표시선을 지원합니다.
* **매일(Everyday) 통합 관리 탭** — 7개 요일의 공통 시간 블록을 '매일' 탭에서 교집합으로 추출하여 한 번에 확인하고 한꺼번에 삭제/추가할 수 있습니다.
* **표준 HA UI 호환** — Home Assistant의 Sections 기반 레이아웃에 완벽히 대응하여 디스플레이 크기에 맞게 자동으로 높이를 조절(Auto Resizing)합니다.
* **다크 테마 최적화** — 모던한 글래스모피즘(Glassmorphism) 스타일로 설계되어 Home Assistant의 다크/라이트 테마에 모두 어울립니다.

<div align="center">
  <img src="assets/preview.png" alt="스케줄 카드 미리보기 UI" width="700" />
</div>

---

## 🚀 설치 방법

### HACS를 통한 설치 (권장)

1. HACS 메뉴를 엽니다.
2. 우측 상단 메뉴에서 **사용자 지정 저장소(Custom repositories)**를 선택합니다.
3. 저장소 URL에 아래 주소를 입력합니다.

   ```text
   https://github.com/jewon-oh/schedule-ui
   ```

4. 카테고리를 **Lovelace**로 설정하고 추가합니다.
5. 목록에서 `Custom Schedule Card`를 찾아 다운로드(설치)합니다.
6. 대시보드 리소스 자동 추가를 확인하는 팝업이 나타나면 승인합니다.

### 수동 설치 (Manual)

1. `schedule-ui.js` 파일을 Home Assistant의 `/config/www/` 디렉토리에 복사합니다.
2. **설정 → 대시보드 → 리소스**에서 `/local/schedule-ui.js`를 `JavaScript Module` 유형으로 추가합니다.

---

## 🛠 사용 방법

이 카드는 사용자가 직접 YAML을 짤 필요 없이 **HA 대시보드 시각적 편집기(Visual Editor)**에서 모든 것을 해결할 수 있도록 고안되었습니다.

### 방법 1. 마법사로 새 루틴 한 번에 만들기 (권장)

1. HA 대시보드 편집 모드에서 `Custom Schedule Card`를 추가합니다.
2. 카드 편집기 화면 좌측 상단의 **[ ✨ 새 루틴 만들기 ]** 드롭다운을 클릭합니다.
3. 에어컨, 조명, 선풍기 등 **내가 켜고 끄고 싶은 기기**를 선택합니다.
4. 즉시 카드에 스케줄 헬퍼가 연동되며 설정창에 자동화 생성이 완료되었다는 녹색 메시지가 출력됩니다.
5. 우측 카드 본문 화면에서 스케줄 시간을 마음껏 추가/삭제하시면 실제 기기가 해당 시간에 맞춰 작동합니다!

### 방법 2. 기존 스케줄 연결하기

이미 Home Assistant 설정에서 등록해둔 `schedule.*` 도메인 헬퍼가 있다면,
카드 에디터의 **[ 스케줄 기기 (직접 선택) ]** 입력칸에서 원하는 스케줄 엔티티를 선택하시면 뷰어로 연동됩니다.

---

## 🗂 카드 설정 구조 (YAML 참조용)

비주얼 에디터 대신 YAML을 선호하시는 경우 아래와 같이 사용할 수 있습니다.

```yaml
type: custom:ha-custom-schedule-card
entity: schedule.livingroom_light      # 스케줄 엔티티 ID (필수)
title: 거실 전등 일정                  # 카드 제목 (선택사항)
```

| 옵션 | 필수 | 설명 |
|------|------|------|
| `entity` | O | 스케줄 헬퍼의 엔티티 ID. `schedule.*` 도메인만 지원합니다. |
| `title` | X | 카드 상단에 표시할 제목. 미입력 시 스케줄의 기본 이름이 표시됩니다. |

---

## 🔌 자동화 브릿지 동작 원리 (고급)

마법사를 통해 생성된 자동화는 `config/automation/config/{schedule_bridge_ID}` 형태로 HA에 저장됩니다.

```text
schedule.my_device 헬퍼가 ON이 되면 → 자동화 발동 → 대상 기기 turn_on 동작
schedule.my_device 헬퍼가 OFF가 되면 → 자동화 발동 → 대상 기기 turn_off 동작
```

만약, 켜지고 꺼짐을 넘어 특정 밝기, 색상, 온도 등 **나만의 복잡한 조건(Condition)**을 추가하고 싶다면 Home Assistant의 **설정 → 자동화** 메뉴로 들어가 이 카드가 생성해둔 자동화를 직접 수정하여 입맛에 맞게 커스텀 할 수 있습니다.

---

## 🖥 로컬 미리보기 (개발용)

Home Assistant 서버 없이 카드의 순수 UI 레이아웃을 확인하고 싶다면 포함된 `preview.html`을 활용하세요.

```bash
python -m http.server 8080
# http://localhost:8080/preview.html 로 브라우저 접속
```

---

## 📝 라이선스

MIT License
