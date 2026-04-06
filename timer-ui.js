import {
  LitElement,
  html,
  css,
} from "https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js";

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
    // If active or paused, we can add time. Wait, timer.start with existing timer OVERRIDES the duration?
    // Wait, adding time to a running timer in HA dynamically can be done via timer.change?
    // No, there is no generic "timer.change".
    // Actually, HA timer doesn't support adding time casually unless cancelled and restarted, 
    // OR we can just override it with new duration. 
    // Wait, timer supports "timer.add"! Service is "timer.add", let's use it? No, wait... 
    // As of recent HA versions, timer.start doesn't append time, it resets. 
    // Let's just reset the timer if user clicks presets during IDLE.
    this._startTimerPreset(minutes);
  }

  render() {
    if (!this._config) return html`<ha-card><div class="error">Not configured</div></ha-card>`;

    const isDummy = !this._config.entity;
    let state = "idle";
    let remainingSec = 0;
    let totalDurationSec = 3600; // 1 hour dummy
    let customTitle = this._config.title || "타이머 설정";

    if (!isDummy && this.hass && this.hass.states[this._config.entity]) {
      const stateObj = this.hass.states[this._config.entity];
      state = stateObj.state; // 'idle', 'active', 'paused'
      customTitle = this._config.title || stateObj.attributes.friendly_name || this._config.entity;

      // Extract duration (original duration string, e.g., "0:10:00")
      totalDurationSec = this._parseDurationToSeconds(stateObj.attributes.duration) || 3600;

      if (state === "active" && stateObj.attributes.finishes_at) {
        remainingSec = Math.max(0, Math.floor((new Date(stateObj.attributes.finishes_at).getTime() - this._now) / 1000));
      } else if (state === "paused" && stateObj.attributes.remaining) {
        remainingSec = this._parseDurationToSeconds(stateObj.attributes.remaining);
      } else if (state === "idle") {
        remainingSec = 0;
      }
    } else if (isDummy) {
      // Dummy visual state
      state = "idle";
      this._inputHours = 0;
      this._inputMinutes = 30;
    }

    const progressPercent = totalDurationSec > 0 
      ? Math.max(0, Math.min(100, (remainingSec / totalDurationSec) * 100)) 
      : 0;

    return html`
      <ha-card>
        <div class="card-header">
          <div class="title-group">
            <ha-icon icon="${state === 'active' ? 'mdi:timer-sand' : 'mdi:timer'}"></ha-icon>
            <h2>${customTitle}</h2>
          </div>
        </div>

        <div class="card-content">
          ${state === "idle" ? html`
            <div class="timer-container idle">
              <svg class="progress-ring" width="220" height="220">
                <circle class="progress-ring-circle bg" r="100" cx="110" cy="110"></circle>
              </svg>
              <div class="timer-text-container">
                <div class="time-inputs">
                  <input type="number" min="0" max="23" .value="${this._inputHours}" @change="${e => this._inputHours = parseInt(e.target.value) || 0}"><span>h</span>
                  <input type="number" min="0" max="59" .value="${this._inputMinutes}" @change="${e => this._inputMinutes = parseInt(e.target.value) || 0}"><span>m</span>
                </div>
              </div>
            </div>
          ` : html`
            <div class="timer-container ${state}">
              <!-- Circular Progress SVG -->
              <svg class="progress-ring" width="220" height="220">
                <circle class="progress-ring-circle bg" r="100" cx="110" cy="110"></circle>
                <circle class="progress-ring-circle fg" r="100" cx="110" cy="110" 
                        style="stroke-dasharray: 628.31; stroke-dashoffset: ${628.31 - (628.31 * progressPercent) / 100};"></circle>
              </svg>
              <div class="timer-text-container">
                <div class="timer-remaining">${this._formatSeconds(remainingSec)}</div>
                <div class="timer-state-label">${state === 'paused' ? this._t('pausedMessage') : ''}</div>
              </div>
            </div>
          `}

          <div class="presets">
            <button class="preset-btn" @click="${() => this._addTime(10)}" ?disabled="${state !== 'idle' && !isDummy}">${this._t('preset10m')}</button>
            <button class="preset-btn" @click="${() => this._addTime(30)}" ?disabled="${state !== 'idle' && !isDummy}">${this._t('preset30m')}</button>
            <button class="preset-btn" @click="${() => this._addTime(60)}" ?disabled="${state !== 'idle' && !isDummy}">${this._t('preset1h')}</button>
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
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid var(--custom-border);
      background: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 100%);
    }

    .title-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .title-group ha-icon {
      color: var(--custom-primary);
      --mdc-icon-size: 24px;
      filter: drop-shadow(0 0 6px rgba(3, 169, 244, 0.4));
    }

    .title-group h2 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
      letter-spacing: 0.3px;
    }

    .card-content {
      padding: 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
    }



    .time-inputs {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .time-inputs input {
      width: 50px;
      height: 60px;
      background: rgba(0, 0, 0, 0.2);
      border: 1px solid var(--custom-border);
      border-radius: 12px;
      color: var(--custom-text);
      font-size: 2rem;
      text-align: center;
      font-family: inherit;
      outline: none;
      transition: border-color 0.2s;
    }

    .time-inputs input:focus {
      border-color: var(--custom-primary);
      box-shadow: 0 0 8px rgba(3, 169, 244, 0.3);
    }
    
    .time-inputs input::-webkit-outer-spin-button,
    .time-inputs input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }

    .time-inputs span {
      font-size: 1.2rem;
      color: var(--custom-secondary);
      font-weight: 500;
      margin-right: 4px;
    }

    .timer-container {
      position: relative;
      display: flex;
      justify-content: center;
      align-items: center;
      width: 220px;
      height: 220px;
    }

    .progress-ring {
      transform: rotate(-90deg);
    }

    .progress-ring-circle {
      fill: transparent;
      stroke-width: 6;
      transition: stroke-dashoffset 1s linear;
    }

    .progress-ring-circle.bg {
      stroke: rgba(255, 255, 255, 0.1);
    }

    .progress-ring-circle.fg {
      stroke: var(--custom-primary);
      stroke-linecap: round;
      filter: drop-shadow(0 0 4px rgba(3, 169, 244, 0.4));
    }

    .timer-container.paused .progress-ring-circle.fg {
      stroke: #ff9800; /* Pause orange */
      filter: none;
    }

    .timer-text-container {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
    }

    .timer-remaining {
      font-size: 2.6rem;
      font-weight: 700;
      color: var(--custom-text);
      letter-spacing: 1px;
    }

    .timer-state-label {
      font-size: 0.85rem;
      color: #ff9800;
      font-weight: 500;
      margin-top: 4px;
      height: 14px;
    }

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

      // Step B: 자동화 브릿지 생성 (생성된 timerId를 기반으로 Bridge ID 부여)
      const actionType = this._selectedAction || "turn_off";
      const bridgeId = `timer_bridge_${timerId}`;
      const alias = `[Timer Bridge] ${entityName}`;
      
      console.log("[schedule-ui] Creating timer bridge:", bridgeId, "for target:", targetEntityId);

      // (브릿지 중복 제거 로직은 필요시 추가하거나, 새로운 브릿지로 안전하게 덮어쓰기)
      try {
        const automations = await this.hass.callWS({ type: "config/entity_registry/list" });
        const existing = automations.find(a => a.entity_id === `automation.${bridgeId}`);
        if (existing) {
          await this.hass.callWS({ type: "config/entity_registry/remove", entity_id: existing.entity_id });
        }
      } catch(e) {}

      const bridgePayload = {
        id: bridgeId,
        alias: alias,
        description: "Timer UI 카드에서 자동으로 생성한 브릿지입니다.",
        mode: "single",
        trigger: [
          {
            platform: "event",
            event_type: "timer.finished",
            event_data: {
              entity_id: timerEntityId
            }
          }
        ],
        action: [
          {
            service: `homeassistant.${actionType}`,
            target: {
              entity_id: targetEntityId
            }
          }
        ]
      };

      await this.hass.callApi("POST", `config/automation/config/${bridgeId}`, bridgePayload);
      console.log("[schedule-ui] timer automation bridge create SUCCESS:", bridgeId);

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

  async _createAutomationBridge(timerEntityId, targetEntityId, actionType, entityName) {
      // 동일한 safeSuffix 생성을 통해 삭제/업데이트 추적
      const safeAscii = targetEntityId.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
      const hash = Math.abs(targetEntityId.split('').reduce((a,b)=>{a=((a<<5)-a)+b.charCodeAt(0);return a&a},0)).toString(16);
      const safeSuffix = `${safeAscii}_${hash}`;
      
      const bridgeId = `timer_bridge_${safeSuffix}`;
      const alias = `[Timer Bridge] ${entityName}`;
      
      console.log("[schedule-ui] Creating timer bridge:", bridgeId, "for target:", targetEntityId);

      // 자동화 삭제 (기존 방식 유지)
    try {
      const automations = await this.hass.callWS({ type: "config/entity_registry/list" });
      const existing = automations.find(a => a.entity_id === `automation.${bridgeId}`);
      if (existing) {
        await this.hass.callWS({
          type: "config/automation/delete",
          automation_id: existing.unique_id || bridgeId
        });
      }
    } catch(e) {}

    const payload = {
      id: bridgeId,
      alias: alias,
      description: "Timer UI 카드에서 자동으로 생성한 브릿지입니다.",
      mode: "single",
      trigger: [
        {
          platform: "event",
          event_type: "timer.finished",
          event_data: {
            entity_id: timerEntityId
          }
        }
      ],
      action: [
        {
          service: `homeassistant.${actionType}`,
          target: {
            entity_id: targetEntityId
          }
        }
      ]
    };

    // WebSocket 'Unknown command' 에러 해결을 위해 REST API 규격으로 변경 (스케줄 카드와 동일 패턴)
    await this.hass.callApi("POST", `config/automation/config/${bridgeId}`, payload);
  }

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
  name: "스마트 타이머 카드",
  preview: true,
  description: "고급스러운 Glassmorphism 기반의 타이머 카드. 연동 대상을 누르면 자동으로 헬퍼 및 브릿지를 세팅합니다."
});