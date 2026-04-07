import {
  LitElement,
  html,
  css,
} from "https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js";


// 파일 로드 확인용 버전 로그 (이 메시지가 콘솔에 안 보이면 구버전이 캐시된 것)
console.log("%c[schedule-ui] v1.2.2 loaded", "color: #03a9f4; font-weight: bold; font-size: 14px;");

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
    empty: "설정된 스케쥴이 없습니다.",
    errorEntity: "스케쥴 엔티티를 설정해야 합니다.",
    scheduleManager: "스케쥴 관리",
    // 스케쥴 생성 마법사
    createRoutine: "새 스케쥴 만들기",
    routineName: "스케쥴 이름",
    routineNamePlaceholder: "예: 거실 전등 스케쥴",
    targetDevice: "대상 기기",
    create: "스케쥴 생성",
    creating: "생성 중...",
    createSuccess: "스케쥴이 생성되었습니다!",
    createFailed: "스케쥴 생성에 실패했습니다.",
    createDescription: "기기를 선택하면 스케쥴과 자동화가 자동으로 생성됩니다.",
    orSelectExisting: "또는 기존 스케쥴을 편집기에서 선택하세요.",
    goToCard: "카드 편집에서 새 스케쥴을 선택해주세요.",
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
    // 스케쥴 생성 마법사
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
    _addFormDays: { state: true },
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
      console.warn("[schedule-ui] _addBlock 차단: 스케쥴 데이터가 로드되지 않았습니다.");
      return;
    }
    if (this._addFormDays.length === 0) return;
    
    const form = e.target;
    // HH:MM 포맷에 :00을 붙여 HH:MM:00 형식으로 변환 (HA WebSocket 규격)
    const start = form.querySelector("#start").value + ":00";
    const end = form.querySelector("#end").value + ":00";
    
    if (!start || !end) return;

    const updatedData = { ...this._scheduleData };
    
    for (const dayIdx of this._addFormDays) {
      const dayStr = WEEKDAYS[dayIdx];
      const currentBlocks = updatedData[dayStr] ? [...updatedData[dayStr]] : [];
      currentBlocks.push({ from: start, to: end });
      updatedData[dayStr] = currentBlocks;
    }
    
    this._scheduleData = updatedData;
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
            <div class="name">${this._config.title || LOCALES["ko"].scheduleManager}</div>
            <div class="header-right">
              <ha-icon icon="mdi:calendar-clock"></ha-icon>
            </div>
          </div>
          <div class="card-content">
            <div class="empty-state">
              <ha-icon icon="mdi:calendar-plus" style="--mdc-icon-size: 48px; opacity: 0.4; margin-bottom: 12px;"></ha-icon>
              <p style="margin: 0; color: var(--secondary-text-color, #a0a0a0);">스마트 스케쥴 카드</p>
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
          <div class="name">${customTitle}</div>
          <div class="header-right">
            <ha-icon icon="${renderData?.icon || 'mdi:calendar-clock'}"></ha-icon>
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
                <div class="form-days">
                  <label style="display:block; font-size: 0.85rem; color: var(--custom-secondary); margin-bottom: 8px;">적용할 요일</label>
                  <div class="day-chip-group" style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px;">
                    ${WEEKDAYS.map((_, i) => html`
                      <div class="day-chip form-chip ${this._addFormDays.includes(i) ? 'selected' : ''}"
                           style="padding: 8px 14px; font-size: 0.95rem; font-weight: 600; cursor: pointer; border-radius: 8px; border: 1px solid var(--custom-border); background: ${this._addFormDays.includes(i) ? 'var(--custom-active-bg)' : 'transparent'}; color: ${this._addFormDays.includes(i) ? 'var(--custom-primary)' : 'var(--custom-secondary)'}; transition: all 0.2s ease;"
                           @click="${() => {
                             if(this._addFormDays.includes(i)) {
                               this._addFormDays = this._addFormDays.filter(d => d !== i);
                             } else {
                               this._addFormDays = [...this._addFormDays, i];
                             }
                           }}">
                        ${this._t("days")[i]}
                      </div>
                    `)}
                  </div>
                </div>
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
                <button type="submit" class="primary-btn" ?disabled=${this._isEditing || this._addFormDays.length === 0}>
                  <ha-icon icon="mdi:plus-circle"></ha-icon>
                  ${this._t("add")}
                </button>
              </form>
            ` : html`
              <button class="add-new-btn" @click="${() => {
                this._showAddForm = true;
                this._addFormDays = this._selectedDay === EVERYDAY_INDEX ? [0,1,2,3,4,5,6] : [this._selectedDay];
              }}">
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
      display: block;
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
      padding: 16px 16px 8px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .card-header .name {
      font-size: 1.15rem;
      font-weight: 600;
      color: var(--primary-text-color, #ffffff);
      letter-spacing: 0.1px;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .header-right ha-icon {
      color: var(--custom-primary);
      --mdc-icon-size: 20px;
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

    /* ── 스케쥴 생성 마법사 ── */
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
      /* color-scheme: dark 설정에 의해 기본적으로 흰색이 되므로 명시적 반전 제거 */
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

    // 기기 이름 기반으로 스케쥴 이름 자동 생성
    const entityObj = this.hass.states[targetEntityId];
    const friendlyName = entityObj?.attributes?.friendly_name || targetEntityId.split('.')[1] || "알 수 없는 기기";
    const routineName = `${friendlyName} 스케쥴`;

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
        alias: `스케쥴 브릿지: ${routineName}`,
        description: `[schedule-ui] ${routineName} 스케쥴에 따라 기기를 자동 제어합니다.`,
        use_blueprint: {
          path: "jewon-oh/schedule-bridge-blueprint.yaml",
          input: {
            schedule_helper: scheduleEntityId,
            target_device: targetEntityId
          }
        }
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
            <span>${isKo ? '새 스케쥴 만들기 (권장)' : 'Create New Routine'}</span>
          </div>
          <p style="font-size: 0.85rem; color: var(--secondary-text-color); margin: 8px 0 16px 0; line-height: 1.4;">
            ${isKo ? '자동화할 기기를 선택하면 스케쥴 제어 장치와 동작 브릿지가 즉시 생성되고 이 카드에 자동으로 연동됩니다.' : 'Pick a device to auto-create a schedule helper and automation bridge.'}
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
          ${isKo ? '기존 스케쥴 다시 불러오기 및 추가 설정' : 'Advanced Configuration'}
        </div>

        <ha-selector
          .hass=${this.hass}
          .selector=${{ entity: { domain: "schedule" } }}
          .value=${this._config.entity || ""}
          .required=${false}
          .label=${isKo ? '스케쥴 기기 (직접 선택)' : 'Schedule Entity'}
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
  type: "ha-custom-schedule-card",
  name: "스케쥴 카드",
  preview: true,
  description: "스케쥴 헬퍼의 시간 블록을 편집하고, 기기를 선택하면 스케쥴을 자동 생성합니다.",
  documentationURL: "https://github.com/jewon-oh/schedule-ui",
});



const KO_TRANSLATION = {
  addTitle: "+ 시간 추가",
  start: "시작",
  pause: "일시정지",
  resume: "계속",
  stop: "취소",
  preset5m: "+5분",
  preset10m: "+10분",
  preset30m: "+30분",
  presetMinus5m: "-5분",
  presetMinus10m: "-10분",
  presetMinus30m: "-30분",
  setDuration: "시간 설정",
  idleMessage: "대기 중",
  pausedMessage: "일시정지됨",
  editorTitle: "타이머 UI 설정",
  editorEntity: "연동된 타이머 엔티티",
  editorWizardTitle: "새 타이머 & 자동화 마법사",
  editorWizardDesc: "기기를 선택하면 타이머 헬퍼와 자동화 브릿지가 즉시 생성됩니다.",
  editorTargetDevice: "대상 기기 선택 (켜고 끌 기기)",
  editorActionType: "종료 시 동작",
  editorActionOff: "장치 끄기",
  editorActionOn: "장치 켜기",
  editorActionToggle: "상태 반전",
  editorCreateStr: "타이머 자동 생성"
};

const EN_TRANSLATION = {
  addTitle: "+ Add Time",
  start: "Start",
  pause: "Pause",
  resume: "Resume",
  stop: "Cancel",
  preset5m: "+5m",
  preset10m: "+10m",
  preset30m: "+30m",
  presetMinus5m: "-5m",
  presetMinus10m: "-10m",
  presetMinus30m: "-30m",
  setDuration: "Set Duration",
  idleMessage: "Idle",
  pausedMessage: "Paused",
  editorTitle: "Timer UI Config",
  editorEntity: "Linked Timer Entity",
  editorWizardTitle: "New Timer Wizard",
  editorWizardDesc: "Select a target device to auto-create timer and automation.",
  editorTargetDevice: "Select Target Device",
  editorActionType: "Action on finish",
  editorActionOff: "Turn Off",
  editorActionOn: "Turn On",
  editorActionToggle: "Toggle",
  editorCreateStr: "Auto Create Timer"
};

// ==========================================
// Main Card
// ==========================================
class HaCustomTimerCard extends LitElement {
  static properties = {
    hass: { type: Object },
    _config: { state: true },
    _now: { state: true },
    _inputHours: { state: true },
    _inputMinutes: { state: true },
    _inputSeconds: { state: true }
  };

  constructor() {
    super();
    this._now = Date.now();
    this._inputHours = 0;
    this._inputMinutes = 30;
    this._inputSeconds = 0;
  }

  connectedCallback() {
    super.connectedCallback();
    this._timerInterval = setInterval(() => {
      this._now = Date.now();
    }, 1000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
    }
  }

  static getConfigElement() {
    return document.createElement("ha-custom-timer-card-editor");
  }

  static getStubConfig() {
    return {
      type: "custom:ha-custom-timer-card"
    };
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    this._config = config;
  }

  get _lang() {
    return this.hass?.language && this.hass.language.includes('ko') ? 'ko' : 'en';
  }

  _t(key) {
    return this._lang === 'ko' ? KO_TRANSLATION[key] : EN_TRANSLATION[key];
  }

  // Parses "HH:MM:SS" into total seconds
  _parseDurationToSeconds(durationStr) {
    if (!durationStr) return 0;
    // Format could be "0:30:00" or "00:30:00"
    const parts = durationStr.split(':').map(Number);
    if (parts.length === 3) {
      return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
    }
    return 0;
  }

  _formatSeconds(sec) {
    if (sec <= 0) return "00:00:00";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  _callService(service, data = {}) {
    if (!this._config.entity) return;
    this.hass.callService("timer", service, { entity_id: this._config.entity, ...data });
  }

  _startTimerCustom() {
    const totalSec = (this._inputHours * 3600) + (this._inputMinutes * 60) + this._inputSeconds;
    if (totalSec <= 0) return;
    const durationStr = this._formatSeconds(totalSec);
    this._callService("start", { duration: durationStr });
  }

  _startTimerPreset(minutes) {
    this._callService("start", { duration: this._formatSeconds(minutes * 60) });
  }

  _addTime(minutes) {
    let totalMinutes = (this._inputHours * 60) + this._inputMinutes + minutes;
    if (totalMinutes < 0) totalMinutes = 0;

    this._inputHours = Math.floor(totalMinutes / 60);
    this._inputMinutes = totalMinutes % 60;
    
    // 최대 시간 초과 방지
    if (this._inputHours > 99) {
       this._inputHours = 99;
       this._inputMinutes = 59;
    }
    this.requestUpdate();
  }

  // 시간 값 증감 핸들러
  _adjustTime(field, delta) {
    const limits = { hours: { min: 0, max: 23 }, minutes: { min: 0, max: 59 }, seconds: { min: 0, max: 59 } };
    const fieldMap = { hours: '_inputHours', minutes: '_inputMinutes', seconds: '_inputSeconds' };
    const propName = fieldMap[field];
    const limit = limits[field];
    let val = (this[propName] || 0) + delta;
    if (val < limit.min) val = limit.max;
    if (val > limit.max) val = limit.min;
    this[propName] = val;
  }

  // 숫자 직접 입력 핸들러
  _onSpinInput(field, ev) {
    const limits = { hours: { min: 0, max: 23 }, minutes: { min: 0, max: 59 }, seconds: { min: 0, max: 59 } };
    const fieldMap = { hours: '_inputHours', minutes: '_inputMinutes', seconds: '_inputSeconds' };
    const limit = limits[field];
    let val = parseInt(ev.target.value) || 0;
    if (val < limit.min) val = limit.min;
    if (val > limit.max) val = limit.max;
    this[fieldMap[field]] = val;
  }

  render() {
    if (!this._config) return html`<ha-card><div class="error">Not configured</div></ha-card>`;

    const isDummy = !this._config.entity;
    let state = "idle";
    let remainingSec = 0;
    let totalDurationSec = 3600;
    let customTitle = this._config.title || "타이머 설정";

    if (!isDummy && this.hass && this.hass.states[this._config.entity]) {
      const stateObj = this.hass.states[this._config.entity];
      state = stateObj.state;
      customTitle = this._config.title || stateObj.attributes.friendly_name || this._config.entity;
      totalDurationSec = this._parseDurationToSeconds(stateObj.attributes.duration) || 3600;

      if (state === "active" && stateObj.attributes.finishes_at) {
        let calcSec = Math.floor((new Date(stateObj.attributes.finishes_at).getTime() - this._now) / 1000);
        
        // 동적 오차 보정: 클라이언트 시간이 느려 calcSec가 기준시간을 초과하면 오차(offset)를 고정 저장
        if (this._timeOffset === undefined || this._lastTimerState !== "active") {
          this._timeOffset = Math.max(0, calcSec - totalDurationSec);
        }
        
        // 오차를 빼서 0까지 정확히 떨어지도록 맞춤
        remainingSec = Math.max(0, calcSec - (this._timeOffset || 0));
        remainingSec = Math.min(totalDurationSec, remainingSec);
      } else if (state === "paused" && stateObj.attributes.remaining) {
        remainingSec = this._parseDurationToSeconds(stateObj.attributes.remaining);
        this._timeOffset = undefined;
      } else if (state === "idle") {
        remainingSec = 0;
        this._timeOffset = undefined;
      }
      this._lastTimerState = state;
    } else if (isDummy) {
      state = "idle";
      this._inputHours = 0;
      this._inputMinutes = 30;
    }

    const progressPercent = totalDurationSec > 0
      ? Math.max(0, Math.min(100, (remainingSec / totalDurationSec) * 100))
      : 0;

    const h = Math.floor(remainingSec / 3600);
    const m = Math.floor((remainingSec % 3600) / 60);
    const s = Math.floor(remainingSec % 60);

    return html`
      <ha-card>
        <div class="card-header">
          <div class="name">${customTitle}</div>
          <div class="header-right">
            ${state !== 'idle' ? html`
              <span class="state-badge ${state}">${state === 'active' ? this._t('start') : this._t('pausedMessage')}</span>
            ` : ''}
            <ha-icon icon="${state === 'active' ? 'mdi:timer-sand' : 'mdi:timer'}"></ha-icon>
          </div>
        </div>

        <div class="card-content">
          ${state === "idle" ? html`
            <!-- 대기 상태: 숫자 증감 입력 -->
            <div class="time-spinner-row">
              <div class="time-spinner">
                <button class="spin-btn" @click="${() => this._adjustTime('hours', 1)}"><ha-icon icon="mdi:chevron-up"></ha-icon></button>
                <input class="spin-value" type="number" min="0" max="23" .value="${String(this._inputHours).padStart(2, '0')}" @change="${e => this._onSpinInput('hours', e)}" @focus="${e => e.target.select()}">
                <button class="spin-btn" @click="${() => this._adjustTime('hours', -1)}"><ha-icon icon="mdi:chevron-down"></ha-icon></button>
                <div class="spin-label">시간</div>
              </div>
              <div class="spin-separator">:</div>
              <div class="time-spinner">
                <button class="spin-btn" @click="${() => this._adjustTime('minutes', 1)}"><ha-icon icon="mdi:chevron-up"></ha-icon></button>
                <input class="spin-value" type="number" min="0" max="59" .value="${String(this._inputMinutes).padStart(2, '0')}" @change="${e => this._onSpinInput('minutes', e)}" @focus="${e => e.target.select()}">
                <button class="spin-btn" @click="${() => this._adjustTime('minutes', -1)}"><ha-icon icon="mdi:chevron-down"></ha-icon></button>
                <div class="spin-label">분</div>
              </div>
              <div class="spin-separator">:</div>
              <div class="time-spinner">
                <button class="spin-btn" @click="${() => this._adjustTime('seconds', 1)}"><ha-icon icon="mdi:chevron-up"></ha-icon></button>
                <input class="spin-value" type="number" min="0" max="59" .value="${String(this._inputSeconds).padStart(2, '0')}" @change="${e => this._onSpinInput('seconds', e)}" @focus="${e => e.target.select()}">
                <button class="spin-btn" @click="${() => this._adjustTime('seconds', -1)}"><ha-icon icon="mdi:chevron-down"></ha-icon></button>
                <div class="spin-label">초</div>
              </div>
            </div>
          ` : html`
            <!-- 동작/일시정지 상태: 남은 시간 표시 + 바 -->
            <div class="timer-display">
              <div class="timer-remaining">
                <span class="time-digit">${String(h).padStart(2, '0')}</span>
                <span class="time-colon">:</span>
                <span class="time-digit">${String(m).padStart(2, '0')}</span>
                <span class="time-colon">:</span>
                <span class="time-digit">${String(s).padStart(2, '0')}</span>
              </div>
            </div>
            <div class="progress-bar-container">
              <div class="progress-bar ${state}" style="width: ${progressPercent}%;"></div>
            </div>
          `}

          <div class="presets-container" style="display: flex; flex-direction: column; gap: 8px; width: 100%;">
            <div class="presets">
              <button class="preset-btn minus" @click="${() => this._addTime(-5)}" ?disabled="${state !== 'idle' && !isDummy}">${this._t('presetMinus5m')}</button>
              <button class="preset-btn minus" @click="${() => this._addTime(-10)}" ?disabled="${state !== 'idle' && !isDummy}">${this._t('presetMinus10m')}</button>
              <button class="preset-btn minus" @click="${() => this._addTime(-30)}" ?disabled="${state !== 'idle' && !isDummy}">${this._t('presetMinus30m')}</button>
            </div>
            <div class="presets">
              <button class="preset-btn" @click="${() => this._addTime(5)}" ?disabled="${state !== 'idle' && !isDummy}">${this._t('preset5m')}</button>
              <button class="preset-btn" @click="${() => this._addTime(10)}" ?disabled="${state !== 'idle' && !isDummy}">${this._t('preset10m')}</button>
              <button class="preset-btn" @click="${() => this._addTime(30)}" ?disabled="${state !== 'idle' && !isDummy}">${this._t('preset30m')}</button>
            </div>
          </div>

          <div class="controls">
            ${state === "idle" ? html`
              <button class="btn btn-primary start-btn" @click="${() => this._startTimerCustom()}" ?disabled="${isDummy}">
                <ha-icon icon="mdi:play"></ha-icon> ${this._t('start')}
              </button>
            ` : html`
              ${state === "active" ? html`
                <button class="btn btn-secondary" @click="${() => this._callService('pause')}" ?disabled="${isDummy}">
                  <ha-icon icon="mdi:pause"></ha-icon> ${this._t('pause')}
                </button>
              ` : html`
                <button class="btn btn-primary" @click="${() => this._callService('start')}" ?disabled="${isDummy}">
                  <ha-icon icon="mdi:play"></ha-icon> ${this._t('resume')}
                </button>
              `}
              <button class="btn btn-danger" @click="${() => this._callService('cancel')}" ?disabled="${isDummy}">
                <ha-icon icon="mdi:stop"></ha-icon> ${this._t('stop')}
              </button>
            `}
          </div>
        </div>
      </ha-card>
    `;
  }

  static styles = css`
    :host {
      display: block;
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
      padding: 16px 16px 8px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .card-header .name {
      font-size: 1.15rem;
      font-weight: 600;
      color: var(--primary-text-color, #ffffff);
      letter-spacing: 0.1px;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .header-right ha-icon {
      color: var(--custom-primary);
      --mdc-icon-size: 20px;
      filter: drop-shadow(0 0 6px rgba(3, 169, 244, 0.4));
    }

    .state-badge {
      font-size: 0.75rem;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 20px;
      letter-spacing: 0.3px;
    }

    .state-badge.active {
      background: var(--custom-active-bg);
      color: var(--custom-primary);
    }

    .state-badge.paused {
      background: rgba(255, 152, 0, 0.15);
      color: #ff9800;
    }

    .card-content {
      padding: 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
    }

    /* === 숫자 스피너 (대기 상태) === */
    .time-spinner-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 0;
    }

    .time-spinner {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }

    .spin-btn {
      width: 48px;
      height: 32px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--custom-border);
      border-radius: 8px;
      color: var(--custom-secondary);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
      --mdc-icon-size: 20px;
    }

    .spin-btn:hover {
      background: rgba(255, 255, 255, 0.12);
      color: var(--custom-text);
      border-color: rgba(255, 255, 255, 0.2);
    }

    .spin-btn:active {
      transform: scale(0.92);
      background: rgba(3, 169, 244, 0.15);
    }

    .spin-value {
      width: 64px;
      font-size: 2.4rem;
      font-weight: 700;
      color: var(--custom-text);
      background: transparent;
      border: 1px solid transparent;
      border-radius: 8px;
      text-align: center;
      line-height: 1;
      font-variant-numeric: tabular-nums;
      font-family: inherit;
      padding: 4px 0;
      outline: none;
      transition: border-color 0.2s, background 0.2s;
      -moz-appearance: textfield;
    }

    .spin-value::-webkit-outer-spin-button,
    .spin-value::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }

    .spin-value:focus {
      border-color: var(--custom-primary);
      background: rgba(3, 169, 244, 0.08);
      box-shadow: 0 0 8px rgba(3, 169, 244, 0.2);
    }

    .spin-label {
      font-size: 0.7rem;
      color: var(--custom-secondary);
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-top: 2px;
    }

    .spin-separator {
      font-size: 2rem;
      font-weight: 700;
      color: var(--custom-secondary);
      padding: 0 2px;
      align-self: center;
      margin-bottom: 24px;
    }

    /* === 타이머 표시 (동작/일시정지 상태) === */
    .timer-display {
      padding: 16px 0;
    }

    .timer-remaining {
      display: flex;
      align-items: baseline;
      gap: 4px;
    }

    .time-digit {
      font-size: 3rem;
      font-weight: 700;
      color: var(--custom-text);
      font-variant-numeric: tabular-nums;
      letter-spacing: 1px;
    }

    .time-colon {
      font-size: 2.4rem;
      font-weight: 300;
      color: var(--custom-secondary);
      margin: 0 2px;
    }

    /* === 프로그레스 바 === */
    .progress-bar-container {
      width: 100%;
      height: 6px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 3px;
      overflow: hidden;
    }

    .progress-bar {
      height: 100%;
      border-radius: 3px;
      transition: width 1s linear;
    }

    .progress-bar.active {
      background: linear-gradient(90deg, var(--custom-primary), #29b6f6);
      box-shadow: 0 0 8px rgba(3, 169, 244, 0.4);
    }

    .progress-bar.paused {
      background: #ff9800;
      box-shadow: none;
    }

    /* === 프리셋 버튼 === */
    .presets {
      display: flex;
      gap: 12px;
      justify-content: center;
      width: 100%;
    }

    .preset-btn {
      flex: 1;
      height: 44px;
      background: rgba(255,255,255,0.05);
      border: 1px solid var(--custom-border);
      color: var(--custom-text);
      border-radius: 12px;
      font-size: 0.95rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .preset-btn:hover:not(:disabled) {
      background: rgba(255,255,255,0.1);
      border-color: rgba(255,255,255,0.2);
    }

    .preset-btn:active:not(:disabled) {
      transform: scale(0.95);
    }

    .preset-btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }

    /* === 컨트롤 버튼 === */
    .controls {
      display: flex;
      gap: 12px;
      width: 100%;
      justify-content: center;
    }

    .btn {
      flex: 1;
      height: 48px;
      border: none;
      border-radius: 12px;
      font-family: inherit;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.2s ease;
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-primary {
      background: var(--custom-primary);
      color: var(--text-primary-color, #fff);
      box-shadow: 0 4px 12px rgba(3, 169, 244, 0.3);
    }

    .btn-primary:active:not(:disabled) {
      transform: scale(0.96);
    }

    .btn-secondary {
      background: rgba(255, 255, 255, 0.1);
      color: var(--custom-text);
    }

    .btn-secondary:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.15);
    }

    .btn-danger {
      background: var(--custom-danger);
      color: #fff;
    }

    .btn-danger:hover:not(:disabled) {
      background: #e53935;
      box-shadow: 0 4px 12px rgba(244, 67, 54, 0.3);
    }
  `;
}
customElements.define("ha-custom-timer-card", HaCustomTimerCard);


// ==========================================
// Editor Card (Wizard)
// ==========================================
class HaCustomTimerCardEditor extends LitElement {
  static properties = {
    hass: {},
    _config: { state: true },
    _selectedEntity: { state: true },
    _selectedAction: { state: true },
    _isLoading: { state: true },
    _creationError: { state: true }
  };

  setConfig(config) {
    this._config = config;
    this._selectedAction = config.action_type || "turn_off";
  }

  get _lang() {
    return this.hass?.language && this.hass.language.includes('ko') ? 'ko' : 'en';
  }

  _t(key) {
    return this._lang === 'ko' ? KO_TRANSLATION[key] : EN_TRANSLATION[key];
  }

  // 1. Target Entity 선택 시 Timer 헬퍼 및 브릿지 자동 생성
  async _onTargetEntityPicked(ev) {
    const targetEntityId = ev.detail.value;
    if (!targetEntityId || targetEntityId === this._selectedEntity) return;
    
    this._selectedEntity = targetEntityId;
    this._isLoading = true;
    this._creationError = null;
    
    try {
      const entityState = this.hass.states[targetEntityId];
      const entityName = entityState?.attributes?.friendly_name || targetEntityId;
      
      let timerId = null;
      let timerEntityId = null;

      // Step A: Timer 헬퍼 생성 (Schedule처럼 내부 WS API 활용)
      try {
        const payload = {
          type: "timer/create",
          name: `${entityName} 타이머`,
          icon: "mdi:timer-sand"
        };
        const timerResult = await this.hass.callWS(payload);
        timerId = timerResult.id;
        timerEntityId = `timer.${timerId}`;
        console.log("[schedule-ui] timer helper create SUCCESS:", timerEntityId);
      } catch (e) {
        console.warn("Timer helper auto-creation failed via config/timer/create. Error:", e);
        this._creationError = `(안내) 타이머 헬퍼 생성 실패. 해당 HA 버전에서는 플러그인이 헬퍼를 완전 자동 생성할 수 없습니다. 수동 구성 권장.`;
        this._isLoading = false;
        return;
      }

      // Step B: 블루프린트 참조 방식으로 자동화 브릿지 생성
      const actionType = this._selectedAction || "turn_off";
      const bridgeId = `timer_bridge_${timerId}`;
      const alias = `타이머 브릿지: ${entityName}`;
      
      console.log("[schedule-ui] Creating timer bridge (blueprint):", bridgeId, "for target:", targetEntityId);

      // 기존 동일 ID 브릿지 중복 제거
      try {
        const automations = await this.hass.callWS({ type: "config/entity_registry/list" });
        const existing = automations.find(a => a.entity_id === `automation.${bridgeId}`);
        if (existing) {
          await this.hass.callWS({ type: "config/entity_registry/remove", entity_id: existing.entity_id });
        }
      } catch(e) {}

      // 블루프린트 참조 형식 — HA '사용중' 카운트에 반영됨
      const bridgePayload = {
        alias: alias,
        description: "Timer UI 카드에서 자동으로 생성한 브릿지입니다.",
        use_blueprint: {
          path: "jewon-oh/timer-bridge-blueprint.yaml",
          input: {
            timer_helper: timerEntityId,
            target_device: targetEntityId,
            action_type: actionType
          }
        }
      };

      await this.hass.callApi("POST", `config/automation/config/${bridgeId}`, bridgePayload);
      console.log("[schedule-ui] timer automation bridge (blueprint) create SUCCESS:", bridgeId);

      // 설정 임시 업데이트
      this._config = {
        ...this._config,
        entity: timerEntityId,
        title: `${entityName} 타이머`
      };

      // 설정 이벤트 발송 (HA UI에 저장 트리거)
      this.dispatchEvent(new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true
      }));
      
    } catch (e) {
      console.error(e);
      this._creationError = `생성 중 오류가 발생했습니다: ${e.message}`;
    } finally {
      this._isLoading = false;
    }
  }

  // _createAutomationBridge: 블루프린트 참조 방식으로 _onTargetEntityPicked에 통합 (삭제됨)

  _onActionChange(ev) {
    this._selectedAction = ev.target.value;
  }

  render() {
    if (!this.hass || !this._config) return html``;

    return html`
      <div class="card-config">
        <div class="wizard-header">
          <ha-icon icon="mdi:magic-staff"></ha-icon>
          <div>
            <h3>${this._t("editorWizardTitle")}</h3>
            <p>${this._t("editorWizardDesc")}</p>
          </div>
        </div>

        <div class="wizard-fields">
          <!-- 타겟 기기 픽커 -->
          <div class="wizard-field">
            <label>${this._t("editorTargetDevice")}</label>
            <ha-selector
              .hass=${this.hass}
              .selector=${{ entity: { domain: ["light", "switch", "fan", "climate", "media_player"] } }}
              .value=${this._selectedEntity}
              @value-changed=${this._onTargetEntityPicked}
            ></ha-selector>
          </div>
          
          <!-- 동작 방식 픽커 -->
          <div class="wizard-field">
            <label>${this._t("editorActionType")}</label>
            <select class="custom-select" .value="${this._selectedAction}" @change="${this._onActionChange}">
              <option value="turn_off">${this._t("editorActionOff")}</option>
              <option value="turn_on">${this._t("editorActionOn")}</option>
              <option value="toggle">${this._t("editorActionToggle")}</option>
            </select>
          </div>
        </div>

        ${this._isLoading ? html`
          <div class="status-msg info">
            <ha-icon icon="mdi:loading" class="spin"></ha-icon>
            동기화 중입니다... 
          </div>
        ` : ""}

        ${this._creationError ? html`
          <div class="status-msg error">
            <ha-icon icon="mdi:alert-circle"></ha-icon>
            ${this._creationError}
          </div>
        ` : ""}

        <!-- 수동 모드 지원 -->
        <hr class="divider" />
        
        <div class="wizard-field">
          <label>${this._t("editorEntity")} (생성된 타이머)</label>
          <ha-entity-picker
            .hass=${this.hass}
            .value=${this._config.entity}
            domain="timer"
            .configValue=${"entity"}
            @value-changed=${(e) => {
              this._config = { ...this._config, entity: e.detail.value };
              this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
            }}
          ></ha-entity-picker>
        </div>
      </div>
    `;
  }

  static styles = css`
    .card-config {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .wizard-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px;
      background: rgba(3, 169, 244, 0.1);
      border: 1px solid rgba(3, 169, 244, 0.2);
      border-radius: 8px;
    }
    .wizard-header ha-icon {
      color: #03a9f4;
      --mdc-icon-size: 32px;
    }
    .wizard-header h3 {
      margin: 0 0 4px 0;
      color: var(--primary-text-color);
      font-size: 1rem;
    }
    .wizard-header p {
      margin: 0;
      color: var(--secondary-text-color);
      font-size: 0.85rem;
      line-height: 1.4;
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
      color: var(--secondary-text-color);
      font-weight: 500;
    }
    .custom-select {
      width: 100%;
      height: 48px;
      background: var(--card-background-color, transparent);
      border: 1px solid var(--divider-color, rgba(128, 128, 128, 0.3));
      border-radius: 4px;
      color: var(--primary-text-color);
      padding: 0 12px;
      font-size: 1rem;
      outline: none;
    }
    .divider {
      border: 0;
      height: 1px;
      background: var(--divider-color, rgba(128, 128, 128, 0.3));
      margin: 8px 0;
    }
    .status-msg {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px;
      border-radius: 8px;
      font-size: 0.9rem;
    }
    .status-msg.info {
      background: rgba(3, 169, 244, 0.1);
      color: #03a9f4;
    }
    .status-msg.error {
      background: rgba(244, 67, 54, 0.1);
      color: #f44336;
    }
    .spin {
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      100% { transform: rotate(360deg); }
    }
  `;
}
customElements.define("ha-custom-timer-card-editor", HaCustomTimerCardEditor);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "ha-custom-timer-card",
  name: "타이머 카드",
  preview: true,
  description: "타이머 헬퍼를 제어하고, 기기를 선택하면 자동화 브릿지를 자동 생성합니다.",
  documentationURL: "https://github.com/jewon-oh/schedule-ui",
});
