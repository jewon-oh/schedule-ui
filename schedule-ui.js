import {
  LitElement,
  html,
  css,
} from "https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js";

import "./timer-ui.js";

// 파일 로드 확인용 버전 로그 (이 메시지가 콘솔에 안 보이면 구버전이 캐시된 것)
console.log("%c[schedule-ui] v1.0.0 loaded", "color: #03a9f4; font-weight: bold; font-size: 14px;");

const LOCALES = {
  ko: {
    addBlock: "새 블록 추가",
    startTime: "시작 시간",
    endTime: "종료 시간",
    add: "시간 블록 추가하기",
    delete: "삭제",
    days: ["월", "화", "수", "목", "금", "토", "일"],
    daysShort: ["월", "화", "수", "목", "금", "토", "일"],
    everyday: "매일",
    empty: "설정된 스케줄이 없습니다.",
    errorEntity: "스케줄 엔티티를 설정해야 합니다.",
    scheduleManager: "스케줄 관리",
    // 루틴 생성 마법사
    createRoutine: "새 루틴 만들기",
    routineName: "루틴 이름",
    routineNamePlaceholder: "예: 거실 전등 루틴",
    targetDevice: "대상 기기",
    create: "루틴 생성",
    creating: "생성 중...",
    createSuccess: "루틴이 생성되었습니다!",
    createFailed: "루틴 생성에 실패했습니다.",
    createDescription: "기기를 선택하면 스케줄과 자동화가 자동으로 생성됩니다.",
    orSelectExisting: "또는 기존 스케줄을 편집기에서 선택하세요.",
    goToCard: "카드 편집에서 새 스케줄을 선택해주세요.",
  },
  en: {
    addBlock: "Add New Block",
    startTime: "Start Time",
    endTime: "End Time",
    add: "Add Time Block",
    delete: "Delete",
    days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    daysShort: ["M", "T", "W", "T", "F", "S", "S"],
    everyday: "Daily",
    empty: "No schedules configured.",
    errorEntity: "You need to define a schedule entity.",
    scheduleManager: "Schedule Manager",
    // 루틴 생성 마법사
    createRoutine: "Create New Routine",
    routineName: "Routine Name",
    routineNamePlaceholder: "e.g. Living Room Light",
    targetDevice: "Target Device",
    create: "Create Routine",
    creating: "Creating...",
    createSuccess: "Routine created successfully!",
    createFailed: "Failed to create routine.",
    createDescription: "Select a device to auto-create a schedule and automation.",
    orSelectExisting: "Or select an existing schedule in the editor.",
    goToCard: "Please select the new schedule in card settings.",
  },
};

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
// '매일(Everyday)' 가상 탭의 인덱스 상수
const EVERYDAY_INDEX = 7;

// 브릿지 자동화 ID 접두사
const AUTOMATION_PREFIX = "schedule_bridge_";

class HaCustomScheduleCard extends LitElement {
  static properties = {
    _config: { state: true },
    _hass: { state: false },
    _scheduleData: { state: true },
    _selectedDay: { state: true },
    _showAddForm: { state: true },
    _showCreateWizard: { state: true },
    _isCreating: { state: true },
    _createResult: { state: true },
  };

  constructor() {
    super();
    this._scheduleData = null;
    this._selectedDay = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1; // 0=Mon, 6=Sun
    this._showAddForm = false;
    this._showCreateWizard = false;
    this._isCreating = false;
    this._createResult = null; // { success: boolean, entityId?: string, message?: string }
    this._lang = "en";
    this._isEditing = false;
  }

  setConfig(config) {
    this._config = config;
    if (this._hass) this._loadSchedule();
  }

  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;

    let shouldUpdate = !oldHass; // 최초로 hass가 주입될 때 렌더링 강제 트리거

    // 언어 감지
    if (hass && hass.language) {
      const newLang = hass.language.startsWith("ko") ? "ko" : "en";
      if (this._lang !== newLang) {
        this._lang = newLang;
        shouldUpdate = true;
      }
    }

    if (shouldUpdate) {
      this.requestUpdate(); // hass 최초 주입 또는 언어 변경 시 화면 갱신
    }

    // 최초 연결 시 데이터 초기화
    if (!oldHass && hass && this._config) {
      this._loadSchedule();
    }
  }

  _t(key) {
    return LOCALES[this._lang][key] || LOCALES["en"][key];
  }

  async _loadSchedule() {
    if (!this._hass || !this._config.entity) return;

    try {
      const result = await this._hass.callWS({
        type: "schedule/list",
      });
      
      const entityId = this._config.entity;
      const entitySlug = entityId.split(".")[1];
      
      // entity registry에서 unique_id(=storage id)를 WebSocket으로 직접 조회
      // HA에서 entity_id를 rename하면 slug와 storage id가 달라지므로 필수
      let storageId = entitySlug;
      try {
        const regEntry = await this._hass.callWS({
          type: "config/entity_registry/get",
          entity_id: entityId,
        });
        if (regEntry && regEntry.unique_id) {
          storageId = regEntry.unique_id;
          console.log("[schedule-ui] entity registry → unique_id:", storageId);
        }
      } catch (regErr) {
        console.warn("[schedule-ui] entity registry 조회 실패, slug 사용:", entitySlug, regErr);
      }
      
      // 1차: storage id(unique_id)로 매칭
      let match = result.find(s => s.id === storageId);
      
      // 2차: entity_id slug로 매칭
      if (!match) {
        match = result.find(s => s.id === entitySlug);
      }
      
      // 3차: friendly_name으로 매칭
      if (!match) {
        const entityState = this._hass.states?.[entityId];
        const friendlyName = entityState?.attributes?.friendly_name;
        if (friendlyName) {
          match = result.find(s => s.name === friendlyName);
        }
      }
      
      console.log("[schedule-ui] loadSchedule - entity:", entityId, "storageId:", storageId, "matched:", match ? match.id : "NONE");
      if (!match && result.length > 0) {
        console.warn("[schedule-ui] 매칭 실패! available ids:", result.map(s => `${s.id}(${s.name})`));
      }

      if (match) {
        this._scheduleData = match;
      }
    } catch (e) {
      console.error("[schedule-ui] Failed to load schedules", e);
    }
  }

  async _updateSchedule() {
    if (!this._hass || !this._scheduleData) return;
    this._isEditing = true;
    
    try {
      const scheduleId = this._scheduleData.id;
      
      // HA schedule/update 스키마에 허용된 필드만 전송 (name, icon, 요일별 시간 블록)
      const updatePayload = {
        name: this._scheduleData.name,
      };

      // 아이콘이 있을 경우에만 포함
      if (this._scheduleData.icon) {
        updatePayload.icon = this._scheduleData.icon;
      }

      // 요일별 시간 블록 데이터만 추출
      for (const day of WEEKDAYS) {
        updatePayload[day] = this._scheduleData[day] || [];
      }

      console.log("[schedule-ui] updateSchedule - schedule_id:", scheduleId);
      console.log("[schedule-ui] updateSchedule - payload:", JSON.stringify(updatePayload, null, 2));
      
      const updated = await this._hass.callWS({
        type: "schedule/update",
        schedule_id: scheduleId,
        ...updatePayload
      });
      
      console.log("[schedule-ui] updateSchedule - success:", updated);
      
      // 업데이트 후 최신 데이터를 다시 로드하여 동기화
      await this._loadSchedule();
    } catch (e) {
      console.error("[schedule-ui] updateSchedule FAILED:", e);
      console.error("[schedule-ui] error details:", JSON.stringify(e, null, 2));
      await this._loadSchedule();
    } finally {
      this._isEditing = false;
    }
  }



  // '매일' 탭에서 7개 요일의 공통 시간 블록(교집합)을 계산하는 헬퍼
  _getEverydayBlocks(dataObj = this._scheduleData) {
    if (!dataObj) return [];
    // 첫 번째 요일(월요일)의 블록 목록을 기준으로 시작
    const baseBlocks = dataObj[WEEKDAYS[0]] || [];
    // 기준 블록 중에서 7개 요일 모두에 존재하는 것만 필터링
    return baseBlocks.filter(block =>
      WEEKDAYS.every(day => {
        const dayBlocks = dataObj[day] || [];
        return dayBlocks.some(b => b.from === block.from && b.to === block.to);
      })
    );
  }

  _deleteBlock(day, index) {
    if (this._isEditing || !this._scheduleData || !this._config?.entity) return;

    // '매일' 탭: 7개 요일 모두에서 해당 시간 블록을 일괄 삭제
    if (this._selectedDay === EVERYDAY_INDEX) {
      const everydayBlocks = this._getEverydayBlocks(this._scheduleData);
      const target = everydayBlocks[index];
      if (!target) return;

      const updatedData = { ...this._scheduleData };
      for (const weekday of WEEKDAYS) {
        const blocks = updatedData[weekday] || [];
        updatedData[weekday] = blocks.filter(
          b => !(b.from === target.from && b.to === target.to)
        );
      }
      this._scheduleData = updatedData;
      this._updateSchedule();
      return;
    }

    const currentBlocks = [...this._scheduleData[day]];
    currentBlocks.splice(index, 1);
    this._scheduleData = { ...this._scheduleData, [day]: currentBlocks };
    this._updateSchedule();
  }

  _addBlock(e) {
    e.preventDefault();
    if (this._isEditing || !this._config?.entity) return;
    if (!this._scheduleData) {
      console.warn("[schedule-ui] _addBlock 차단: 스케줄 데이터가 로드되지 않았습니다.");
      return;
    }
    
    const form = e.target;
    // HH:MM 포맷에 :00을 붙여 HH:MM:00 형식으로 변환 (HA WebSocket 규격)
    const start = form.querySelector("#start").value + ":00";
    const end = form.querySelector("#end").value + ":00";
    
    if (!start || !end) return;

    // '매일' 탭: 7개 요일 모두에 동일한 시간 블록을 일괄 추가
    if (this._selectedDay === EVERYDAY_INDEX) {
      const updatedData = { ...this._scheduleData };
      for (const weekday of WEEKDAYS) {
        const blocks = updatedData[weekday] ? [...updatedData[weekday]] : [];
        blocks.push({ from: start, to: end });
        updatedData[weekday] = blocks;
      }
      this._scheduleData = updatedData;
      this._showAddForm = false;
      this._updateSchedule();
      return;
    }

    const dayStr = WEEKDAYS[this._selectedDay];
    const currentBlocks = this._scheduleData[dayStr] ? [...this._scheduleData[dayStr]] : [];
    
    currentBlocks.push({ from: start, to: end });
    
    this._scheduleData = { ...this._scheduleData, [dayStr]: currentBlocks };
    this._showAddForm = false;
    this._updateSchedule();
  }

  _formatTime(timeStr) {
    if (!timeStr) return "";
    let [hours, minutes] = timeStr.split(":");
    let date = new Date();
    date.setHours(parseInt(hours));
    date.setMinutes(parseInt(minutes));
    
    return new Intl.DateTimeFormat(this._lang, {
      hour: 'numeric',
      minute: 'numeric',
      hour12: true
    }).format(date);
  }

  // "HH:MM:SS" 형식의 시간 문자열을 하루 기준 분(minutes)으로 변환
  _timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(":");
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  }



  render() {
    if (!this._config) return html`<ha-card><div class="error">Not configured</div></ha-card>`;

    // 카드 피커 프리뷰 또는 hass 미로드 시: 간단한 플레이스홀더 표시
    if (!this._hass) {
      return html`
        <ha-card>
          <div class="card-header">
            <div class="title-group">
              <ha-icon icon="mdi:calendar-clock"></ha-icon>
              <h2>${this._config.title || LOCALES["ko"].scheduleManager}</h2>
            </div>
          </div>
          <div class="card-content">
            <div class="empty-state">
              <ha-icon icon="mdi:calendar-plus" style="--mdc-icon-size: 48px; opacity: 0.4; margin-bottom: 12px;"></ha-icon>
              <p style="margin: 0; color: var(--secondary-text-color, #a0a0a0);">스마트 스케줄 카드</p>
            </div>
          </div>
        </ha-card>
      `;
    }

    let isDummy = false;
    let renderData = this._scheduleData;

    // 엔티티가 선택되지 않은 초기 배치 상태 → 카드 피커 피드백용 더미 데이터 노출
    if (!this._config.entity) {
      isDummy = true;
      renderData = {
        name: this._t("scheduleManager") + " (미리보기)",
        icon: "mdi:calendar-star",
        monday: [{from: "09:00:00", to: "18:00:00"}],
        tuesday: [{from: "09:00:00", to: "18:00:00"}],
        wednesday: [{from: "09:00:00", to: "18:00:00"}],
        thursday: [{from: "09:00:00", to: "18:00:00"}],
        friday: [{from: "09:00:00", to: "12:00:00"}, {from: "13:00:00", to: "18:00:00"}],
        saturday: [],
        sunday: []
      };
    }

    const customTitle = this._config.title || (renderData ? renderData.name : this._t("scheduleManager"));
    const isEveryday = this._selectedDay === EVERYDAY_INDEX;
    const dayStr = isEveryday ? null : WEEKDAYS[this._selectedDay];
    const blocks = renderData
      ? (isEveryday ? this._getEverydayBlocks(renderData) : (renderData[dayStr] || []))
      : [];

    // 시작 시간 순으로 정렬
    const sortedBlocks = [...blocks].sort((a, b) => a.from.localeCompare(b.from));

    return html`
      <ha-card>

        <div class="card-header">
          <div class="title-group">
            <ha-icon icon="${renderData?.icon || 'mdi:calendar-clock'}"></ha-icon>
            <h2>${customTitle}</h2>
          </div>
        </div>

        <div class="card-content">
          <div class="days-container">
              ${WEEKDAYS.map((_, i) => html`
                <div class="day-chip ${this._selectedDay === i ? 'selected' : ''}" @click="${() => { this._selectedDay = i; this._showAddForm = false; }}">
                  ${this._t("days")[i]}
                </div>
              `)}
              <div class="day-chip everyday ${this._selectedDay === EVERYDAY_INDEX ? 'selected' : ''}" @click="${() => { this._selectedDay = EVERYDAY_INDEX; this._showAddForm = false; }}">
                ${this._t("everyday")}
              </div>
            </div>

            <!-- 주간 타임라인 -->
            <div class="weekly-timeline">
              ${WEEKDAYS.map((day, idx) => {
                const dayBlocks = renderData ? (renderData[day] || []) : [];
                const isSelected = this._selectedDay === idx;
                const MINUTES_IN_DAY = 1440;
                return html`
                  <div class="weekly-row ${isSelected ? 'selected' : ''}" @click="${() => { this._selectedDay = idx; this._showAddForm = false; }}">
                    <span class="weekly-day-label">${this._t("daysShort")[idx]}</span>
                    <div class="weekly-bar">
                      ${dayBlocks.map(block => {
                        const startMin = this._timeToMinutes(block.from);
                        const endMin = this._timeToMinutes(block.to);
                        const left = (startMin / MINUTES_IN_DAY) * 100;
                        const width = ((endMin - startMin) / MINUTES_IN_DAY) * 100;
                        return html`
                          <div class="timeline-block" 
                               style="left: ${left}%; width: ${Math.max(width, 0.5)}%;"
                               title="${this._formatTime(block.from)} ~ ${this._formatTime(block.to)}">
                          </div>
                        `;
                      })}
                      ${(() => {
                        const now = new Date();
                        const todayIdx = (now.getDay() + 6) % 7;
                        if (todayIdx !== idx) return '';
                        const nowMin = now.getHours() * 60 + now.getMinutes();
                        const pos = (nowMin / MINUTES_IN_DAY) * 100;
                        return html`<div class="timeline-now" style="left: ${pos}%;"></div>`;
                      })()}
                    </div>
                  </div>
                `;
              })}
              <div class="timeline-labels">
                <span class="weekly-day-label"></span>
                <div class="timeline-labels-inner">
                  <span>0</span><span>6</span><span>12</span><span>18</span><span>24</span>
                </div>
              </div>
            </div>

            <div class="blocks-container">
              ${sortedBlocks.length === 0 ? html`
                <div class="empty-state">${this._t("empty")}</div>
              ` : sortedBlocks.map((block, i) => html`
                <div class="time-block">
                  <div class="time-text">
                    <span>${this._formatTime(block.from)}</span>
                    <span class="divider">~</span>
                    <span>${this._formatTime(block.to)}</span>
                  </div>
                  <button class="icon-btn delete-btn" @click="${() => this._deleteBlock(isEveryday ? null : dayStr, i)}" ?disabled=${this._isEditing}>
                    <ha-icon icon="mdi:trash-can-outline"></ha-icon>
                  </button>
                </div>
              `)}
            </div>

            ${this._showAddForm ? html`
              <form class="add-form" @submit="${this._addBlock}">
                <div class="time-inputs">
                  <div class="input-group">
                    <label>${this._t("startTime")}</label>
                    <input type="time" id="start" required>
                  </div>
                  <div class="input-group">
                    <label>${this._t("endTime")}</label>
                    <input type="time" id="end" required>
                  </div>
                </div>
                <button type="submit" class="primary-btn" ?disabled=${this._isEditing}>
                  <ha-icon icon="mdi:plus-circle"></ha-icon>
                  ${this._t("add")}
                </button>
              </form>
            ` : html`
              <button class="add-new-btn" @click="${() => this._showAddForm = true}">
                <ha-icon icon="mdi:plus"></ha-icon>
                ${this._t("addBlock")}
              </button>
            `}
        </div>
      </ha-card>
    `;
  }

  static styles = css`
    :host {
      --custom-primary: var(--primary-color, #03a9f4);
      --custom-bg: var(--card-background-color, rgba(255, 255, 255, 0.05));
      --custom-border: var(--divider-color, rgba(255, 255, 255, 0.1));
      --custom-text: var(--primary-text-color, #ffffff);
      --custom-secondary: var(--secondary-text-color, #a0a0a0);
      --custom-danger: var(--error-color, #f44336);
      --custom-active-bg: rgba(3, 169, 244, 0.15);
      --custom-success: #4caf50;
    }

    ha-card {
      background: var(--custom-bg);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border-radius: 16px;
      border: 1px solid var(--custom-border);
      overflow: hidden;
      font-family: var(--paper-font-body1_-_font-family, system-ui, -apple-system, sans-serif);
      color: var(--custom-text);
      transition: all 0.3s ease;
    }

    .card-header {
      padding: 16px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--custom-border);
      background: rgba(0,0,0,0.1);
    }

    .title-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .title-group ha-icon {
      color: var(--custom-primary);
      --mdc-icon-size: 24px;
    }

    h2 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
      letter-spacing: 0.5px;
    }

    .card-content {
      padding: 20px;
      position: relative;
    }

    /* ── 루틴 생성 마법사 ── */
    .create-wizard {
      animation: fadeIn 0.3s ease;
    }

    .wizard-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }

    .wizard-header ha-icon {
      color: var(--custom-primary);
      --mdc-icon-size: 28px;
    }

    .wizard-header h3 {
      margin: 0;
      font-size: 1.05rem;
      font-weight: 600;
    }

    .wizard-desc {
      margin: 0 0 20px 0;
      font-size: 0.85rem;
      color: var(--custom-secondary);
      line-height: 1.5;
    }

    .wizard-fields {
      display: flex;
      flex-direction: column;
      gap: 16px;
      margin-bottom: 20px;
    }

    .wizard-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .wizard-field label {
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--custom-secondary);
    }

    .wizard-field input[type="text"] {
      padding: 12px;
      background: rgba(0,0,0,0.2);
      border: 1px solid var(--custom-border);
      color: var(--custom-text);
      border-radius: 8px;
      font-size: 1rem;
      outline: none;
      font-family: inherit;
      transition: border-color 0.2s ease;
    }

    .wizard-field input[type="text"]:focus {
      border-color: var(--custom-primary);
    }

    .wizard-field input[type="text"]::placeholder {
      color: var(--custom-secondary);
      opacity: 0.5;
    }

    .wizard-field select {
      padding: 12px;
      background: rgba(0,0,0,0.2);
      border: 1px solid var(--custom-border);
      color: var(--custom-text);
      border-radius: 8px;
      font-size: 1rem;
      outline: none;
      font-family: inherit;
      cursor: pointer;
      appearance: none;
      -webkit-appearance: none;
      transition: border-color 0.2s ease;
    }

    .wizard-field select:focus {
      border-color: var(--custom-primary);
    }

    .wizard-field select option {
      background: var(--card-background-color, #2b2b2b);
      color: var(--primary-text-color, #fff);
      font-size: 1rem;
    }

    .wizard-field ha-entity-picker {
      display: block;
    }

    .create-btn {
      width: 100%;
      padding: 14px;
      background: linear-gradient(135deg, var(--custom-primary), #7c4dff);
      color: var(--text-primary-color, #fff);
      border: none;
      border-radius: 12px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 4px 16px rgba(3, 169, 244, 0.35);
      transition: all 0.2s ease;
    }

    .create-btn:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(3, 169, 244, 0.45);
    }

    .create-btn:active:not(:disabled) {
      transform: scale(0.98);
    }

    .create-btn:disabled {
      opacity: 0.7;
      cursor: not-allowed;
    }

    .result-msg {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 14px 16px;
      border-radius: 12px;
      margin-bottom: 16px;
      animation: fadeIn 0.3s ease;
    }

    .result-msg.success {
      background: rgba(76, 175, 80, 0.12);
      border: 1px solid rgba(76, 175, 80, 0.3);
    }

    .result-msg.success ha-icon {
      color: var(--custom-success);
      --mdc-icon-size: 24px;
      flex-shrink: 0;
      margin-top: 2px;
    }

    .result-msg.success strong {
      color: var(--custom-success);
      display: block;
      margin-bottom: 4px;
    }

    .result-msg.success p {
      margin: 0;
      font-size: 0.9rem;
      color: var(--custom-secondary);
      word-break: break-all;
    }

    .result-msg.success .hint {
      margin-top: 8px;
      font-size: 0.8rem;
      opacity: 0.7;
    }

    .result-msg.error {
      background: rgba(244, 67, 54, 0.1);
      border: 1px solid rgba(244, 67, 54, 0.3);
      color: var(--custom-danger);
      font-size: 0.85rem;
    }

    .result-msg.error ha-icon {
      --mdc-icon-size: 20px;
      flex-shrink: 0;
    }

    .wizard-hint {
      text-align: center;
      font-size: 0.8rem;
      color: var(--custom-secondary);
      opacity: 0.6;
      margin: 16px 0 0 0;
    }

    .wizard-close-btn {
      position: absolute;
      top: 12px;
      right: 12px;
      background: rgba(255,255,255,0.08);
      border: none;
      color: var(--custom-secondary);
      cursor: pointer;
      padding: 6px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }

    .wizard-close-btn:hover {
      background: rgba(255,255,255,0.15);
      color: var(--custom-text);
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .spin {
      animation: spin 1s linear infinite;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* ── 요일 칩 ── */
    .days-container {
      display: flex;
      justify-content: space-between;
      margin-bottom: 24px;
      gap: 4px;
      flex-wrap: wrap;
    }

    .day-chip {
      flex: 1;
      text-align: center;
      padding: 10px 0;
      border-radius: 12px;
      font-size: 0.9rem;
      font-weight: 500;
      cursor: pointer;
      background: rgba(255,255,255,0.03);
      border: 1px solid var(--custom-border);
      transition: all 0.2s cubic-bezier(0.4, 0.0, 0.2, 1);
      min-width: 0;
    }

    .day-chip:hover {
      background: rgba(255,255,255,0.08);
      transform: translateY(-2px);
    }

    .day-chip.selected {
      background: var(--custom-primary);
      color: var(--text-primary-color, #fff);
      border-color: var(--custom-primary);
      box-shadow: 0 4px 12px rgba(3, 169, 244, 0.3);
      transform: translateY(-2px);
    }

    /* '매일' 탭 전용 스타일 */
    .day-chip.everyday {
      flex: 1.4;
      font-size: 0.85rem;
      letter-spacing: 0.5px;
    }

    .day-chip.everyday.selected {
      background: linear-gradient(135deg, var(--custom-primary), #7c4dff);
      border-color: transparent;
    }

    /* ── 주간 타임라인 ── */
    .weekly-timeline {
      margin-bottom: 20px;
    }

    .weekly-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 2px 0;
      cursor: pointer;
      border-radius: 6px;
      transition: background 0.15s ease;
    }

    .weekly-row:hover {
      background: rgba(255,255,255,0.04);
    }

    .weekly-row.selected {
      background: rgba(3, 169, 244, 0.08);
    }

    .weekly-row.selected .weekly-day-label {
      color: var(--custom-primary);
      font-weight: 600;
    }

    .weekly-day-label {
      width: 24px;
      font-size: 0.75rem;
      color: var(--custom-secondary);
      text-align: center;
      flex-shrink: 0;
    }

    .weekly-bar {
      position: relative;
      flex: 1;
      height: 18px;
      background: rgba(255,255,255,0.04);
      border-radius: 4px;
      border: 1px solid rgba(255,255,255,0.06);
      overflow: hidden;
    }

    .timeline-block {
      position: absolute;
      top: 2px;
      bottom: 2px;
      background: linear-gradient(135deg, var(--custom-primary), rgba(3, 169, 244, 0.6));
      border-radius: 3px;
      min-width: 2px;
      transition: opacity 0.2s ease;
    }

    .timeline-block:hover {
      opacity: 0.8;
      box-shadow: 0 0 6px rgba(3, 169, 244, 0.5);
    }

    .timeline-now {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 2px;
      background: #ff5252;
      box-shadow: 0 0 4px rgba(255, 82, 82, 0.6);
      z-index: 1;
    }

    .timeline-labels {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
    }

    .timeline-labels-inner {
      flex: 1;
      display: flex;
      justify-content: space-between;
    }

    .timeline-labels span {
      font-size: 0.6rem;
      color: var(--custom-secondary);
      opacity: 0.6;
    }

    /* ── 시간 블록 ── */
    .blocks-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 16px;
    }

    .empty-state {
      text-align: center;
      padding: 24px 0;
      color: var(--custom-secondary);
      font-size: 0.9rem;
    }

    .time-block {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 14px 16px;
      background: rgba(0,0,0,0.15);
      border: 1px solid var(--custom-border);
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.05);
      transition: opacity 0.2s ease;
    }

    .time-text {
      font-size: 1.1rem;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .divider {
      color: var(--custom-secondary);
      font-weight: 300;
    }

    .icon-btn {
      background: none;
      border: none;
      color: var(--custom-secondary);
      cursor: pointer;
      padding: 6px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }

    .delete-btn:hover {
      color: var(--custom-danger);
      background: rgba(244, 67, 54, 0.1);
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .add-new-btn {
      width: 100%;
      padding: 14px;
      background: transparent;
      border: 2px dashed var(--custom-border);
      border-radius: 12px;
      color: var(--custom-secondary);
      font-size: 0.95rem;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.2s;
    }

    .add-new-btn:hover {
      border-color: var(--custom-primary);
      color: var(--custom-primary);
      background: rgba(3, 169, 244, 0.05);
    }

    .add-form {
      background: rgba(0,0,0,0.15);
      border: 1px solid var(--custom-border);
      border-radius: 12px;
      padding: 16px;
      animation: slideDown 0.3s cubic-bezier(0.4, 0.0, 0.2, 1);
    }

    .time-inputs {
      display: flex;
      gap: 16px;
      margin-bottom: 20px;
    }

    .input-group {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .input-group label {
      font-size: 0.85rem;
      color: var(--custom-secondary);
    }

    input[type="time"] {
      padding: 12px;
      background: rgba(0,0,0,0.2);
      border: 1px solid var(--custom-border);
      color: var(--custom-text);
      border-radius: 8px;
      font-size: 1rem;
      outline: none;
      font-family: inherit;
      color-scheme: dark;
    }

    input[type="time"]::-webkit-calendar-picker-indicator {
      filter: invert(1) brightness(2);
      opacity: 0.8;
      cursor: pointer;
    }

    .primary-btn {
      width: 100%;
      padding: 12px;
      background: var(--custom-primary);
      color: var(--text-primary-color, #fff);
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 4px 12px rgba(3, 169, 244, 0.3);
      transition: transform 0.1s ease;
    }

    .primary-btn:active {
      transform: scale(0.98);
    }

    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;

  // HA 커스텀 카드 편집기 인스턴스 연동
  static getConfigElement() {
    return document.createElement("ha-custom-schedule-card-editor");
  }

  // 카드 피커에서 처음 배치될 때의 기본값 (type은 HA가 자동 추가하므로 포함 금지)
  static getStubConfig() {
    return {};
  }

  // masonry 뷰를 위한 기본 예상 카드 높이 (1단위 = 50px)
  getCardSize() {
    return this._config?.entity ? 5 : 7;
  }

  // sections 뷰를 위한 그리드 옵션 (세로 길이를 내용에 맞추기 위해 rows는 지정하지 않음)
  getGridOptions() {
    return {
      columns: 12,
      min_rows: 3,
    };
  }
}

// ---------------------------------------------------------
// Visual Editor 구현 영역
// ---------------------------------------------------------
class HaCustomScheduleCardEditor extends LitElement {
  static properties = {
    hass: {},
    _config: {},
    _isCreating: { type: Boolean },
    _createResult: { type: Object },
  };

  setConfig(config) {
    this._config = config;
  }

  configChanged(newConfig) {
    const event = new Event("config-changed", { bubbles: true, composed: true });
    event.detail = { config: newConfig };
    this.dispatchEvent(event);
  }

  async _onAutoCreateDevicePicker(ev) {
    const targetEntityId = ev.detail.value;
    if (this._isCreating || !this.hass || !targetEntityId) return;

    // 기기 이름 기반으로 루틴 이름 자동 생성
    const entityObj = this.hass.states[targetEntityId];
    const friendlyName = entityObj?.attributes?.friendly_name || targetEntityId.split('.')[1] || "알 수 없는 기기";
    const routineName = `${friendlyName} 루틴`;

    this._isCreating = true;
    this._createResult = null;
    this.requestUpdate();

    try {
      console.log("[schedule-ui] Editor Auto createRoutine - name:", routineName, "target:", targetEntityId);
      
      const schedulePayload = {
        type: "schedule/create",
        name: routineName,
        icon: "mdi:calendar-clock",
      };


      const scheduleResult = await this.hass.callWS(schedulePayload);
      console.log("[schedule-ui] schedule/create SUCCESS:", scheduleResult);

      const scheduleId = scheduleResult.id;
      const scheduleEntityId = `schedule.${scheduleId}`;

      const automationId = `bridge_${scheduleId}`;
      const automationPayload = {
        alias: `스케줄 브릿지: ${routineName}`,
        description: `[schedule-ui] ${routineName} 스케줄에 따라 기기를 자동 제어합니다.`,
        trigger: [
          { platform: "state", entity_id: scheduleEntityId, to: "on", id: "schedule_started" },
          { platform: "state", entity_id: scheduleEntityId, to: "off", id: "schedule_ended" },
        ],
        action: [
          {
            choose: [
              {
                conditions: [{ condition: "trigger", id: "schedule_started" }],
                sequence: [{ service: "homeassistant.turn_on", target: { entity_id: targetEntityId } }],
              },
              {
                conditions: [{ condition: "trigger", id: "schedule_ended" }],
                sequence: [{ service: "homeassistant.turn_off", target: { entity_id: targetEntityId } }],
              },
            ],
          },
        ],
        mode: "single",
      };

      await this.hass.callApi("POST", `config/automation/config/${automationId}`, automationPayload);
      console.log("[schedule-ui] automation create SUCCESS:", automationId);

      this._createResult = { success: true, entityId: scheduleEntityId };

      // 자동 생성 완료 시 곧바로 config의 entity 속성을 교체
      this.configChanged({ ...this._config, entity: scheduleEntityId });

    } catch (e) {
      console.error("[schedule-ui] createRoutine FAILED:", e);
      this._createResult = { success: false, message: e.message || JSON.stringify(e) };
    } finally {
      this._isCreating = false;
      this.requestUpdate();
    }
  }

  render() {
    if (!this.hass || !this._config) {
      return html``;
    }

    const lang = this.hass.language?.startsWith('ko') ? 'ko' : 'en';
    const isKo = lang === 'ko';

    return html`
      <div class="card-config">
        
        <div class="wizard-section">
          <div style="font-weight: 600; color: var(--primary-color); display: flex; align-items: center; gap: 8px;">
            <ha-icon icon="mdi:magic-staff"></ha-icon> 
            <span>${isKo ? '새 루틴 만들기 (권장)' : 'Create New Routine'}</span>
          </div>
          <p style="font-size: 0.85rem; color: var(--secondary-text-color); margin: 8px 0 16px 0; line-height: 1.4;">
            ${isKo ? '자동화할 기기를 선택하면 스케줄 제어 장치와 동작 브릿지가 즉시 생성되고 이 카드에 자동으로 연동됩니다.' : 'Pick a device to auto-create a schedule helper and automation bridge.'}
          </p>

          ${this._isCreating ? html`
            <div style="text-align: center; padding: 20px; color: var(--primary-color);">
              <ha-icon icon="mdi:loading" class="spin"></ha-icon>
              <span style="margin-left: 8px;">${isKo ? '생성 중...' : 'Creating...'}</span>
            </div>
          ` : html`
            <ha-selector
              .hass=${this.hass}
              .selector=${{ entity: { domain: ["switch", "light", "fan", "climate", "cover"] } }}
              .value=${""}
              .required=${false}
              .label=${isKo ? '제어할 대상 기기 선택' : 'Target Device'}
              @value-changed=${this._onAutoCreateDevicePicker}
            ></ha-selector>
          `}

          ${this._createResult?.success ? html`
            <div style="margin-top: 12px; color: var(--success-color, #4caf50); font-size: 0.9rem; display: flex; align-items: center; gap: 6px;">
              <ha-icon icon="mdi:check-circle" style="--mdc-icon-size: 18px;"></ha-icon>
              <span>${this._createResult.entityId} 생성 및 연결 성공!</span>
            </div>
          ` : ''}
          ${this._createResult && !this._createResult.success ? html`
            <div style="margin-top: 12px; color: var(--error-color, #f44336); font-size: 0.9rem;">
              오류 발생: ${this._createResult.message}
            </div>
          ` : ''}
        </div>

        <div style="height: 1px; background: var(--divider-color, rgba(100,100,100,0.2)); margin: 24px 0;"></div>

        <div style="font-weight: 600; margin-bottom: 16px; color: var(--primary-text-color);">
          ${isKo ? '기존 스케줄 다시 불러오기 및 추가 설정' : 'Advanced Configuration'}
        </div>

        <ha-selector
          .hass=${this.hass}
          .selector=${{ entity: { domain: "schedule" } }}
          .value=${this._config.entity || ""}
          .required=${false}
          .label=${isKo ? '스케줄 기기 (직접 선택)' : 'Schedule Entity'}
          @value-changed=${this._entityChanged}
        ></ha-selector>

        <br/>

        <ha-textfield
          label="${isKo ? '카드 표출 제목 (선택사항)' : 'Card Title (Optional)'}"
          .value=${this._config.title || ""}
          @input=${this._titleChanged}
          style="width: 100%;"
        ></ha-textfield>
      </div>
    `;
  }

  _entityChanged(ev) {
    if (!this._config || !this.hass) return;
    const value = ev.detail.value;
    if (this._config.entity === value) return;
    
    this.configChanged({
      ...this._config,
      entity: value,
    });
  }

  _titleChanged(ev) {
    if (!this._config || !this.hass) return;
    const value = ev.target.value;
    if (this._config.title === value) return;
    
    if (value === "") {
      const tmpConfig = { ...this._config };
      delete tmpConfig.title;
      this.configChanged(tmpConfig);
    } else {
      this.configChanged({
        ...this._config,
        title: value,
      });
    }
  }

  static styles = css`
    .card-config {
      display: flex;
      flex-direction: column;
    }
    .wizard-section {
      background: var(--secondary-background-color, rgba(0,0,0,0.05));
      padding: 16px;
      border-radius: 8px;
    }
    .spin {
      animation: spin 1.5s linear infinite;
    }
    @keyframes spin {
      100% { transform: rotate(360deg); }
    }
  `;
}

customElements.define("ha-custom-schedule-card-editor", HaCustomScheduleCardEditor);
customElements.define("ha-custom-schedule-card", HaCustomScheduleCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "ha-custom-schedule-card", // custom: 접두어 제거 (HA 공식 문서 권장 사항)
  name: "스마트 스케줄 카드 (Custom Schedule)",
  preview: true,
  description: "스케줄 헬퍼의 시간 블록을 편집하고, 기기를 선택하면 루틴을 자동 생성합니다.",
  documentationURL: "https://github.com/jewon-oh/schedule-ui",
});
