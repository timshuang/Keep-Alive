export function renderAdminPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Keepalive 账号管理</title>
    <style>
      :root {
        --card: rgba(255, 255, 255, 0.88);
        --text: #1f2937;
        --muted: #6b7280;
        --line: rgba(148, 163, 184, 0.28);
        --brand: #d97706;
        --brand-strong: #b45309;
        --danger-soft: rgba(254, 226, 226, 0.92);
        --success-soft: rgba(220, 252, 231, 0.9);
        --info: #1d4ed8;
        --info-soft: rgba(219, 234, 254, 0.9);
        --shadow: 0 24px 60px rgba(120, 53, 15, 0.12);
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(251, 191, 36, 0.25), transparent 30%),
          radial-gradient(circle at top right, rgba(251, 146, 60, 0.22), transparent 32%),
          linear-gradient(135deg, #f8f5ef 0%, #efe5d2 100%);
      }

      .shell {
        width: min(1180px, calc(100vw - 32px));
        margin: 32px auto;
        padding: 28px;
        border: 1px solid rgba(255, 255, 255, 0.55);
        border-radius: 28px;
        background: var(--card);
        backdrop-filter: blur(14px);
        box-shadow: var(--shadow);
      }

      .hero {
        display: flex;
        justify-content: space-between;
        gap: 20px;
        align-items: end;
        margin-bottom: 24px;
      }

      .eyebrow {
        margin: 0 0 10px;
        color: var(--brand-strong);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      h1 {
        margin: 0;
        font-size: clamp(28px, 4vw, 42px);
        line-height: 1.05;
      }

      .subtitle {
        margin: 10px 0 0;
        color: var(--muted);
        max-width: 680px;
        line-height: 1.6;
      }

      .actions {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }

      button {
        border: 0;
        border-radius: 999px;
        padding: 12px 18px;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        transition: transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease;
      }

      button:hover { transform: translateY(-1px); }
      button:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }

      .primary {
        color: white;
        background: linear-gradient(135deg, var(--brand) 0%, #f97316 100%);
        box-shadow: 0 12px 24px rgba(217, 119, 6, 0.28);
      }

      .secondary,
      .ghost,
      .pager-btn {
        color: var(--text);
        background: rgba(255, 255, 255, 0.82);
        border: 1px solid var(--line);
      }

      .status {
        margin: 0 0 18px;
        padding: 14px 16px;
        border-radius: 16px;
        border: 1px solid transparent;
        display: none;
      }

      .status.show { display: block; }
      .status.info {
        color: var(--info);
        background: var(--info-soft);
        border-color: rgba(96, 165, 250, 0.35);
      }
      .status.success {
        color: #166534;
        background: var(--success-soft);
        border-color: rgba(34, 197, 94, 0.35);
      }
      .status.error {
        color: #991b1b;
        background: var(--danger-soft);
        border-color: rgba(248, 113, 113, 0.4);
      }

      .dialog-alert {
        margin: 0 0 18px;
        padding: 14px 16px;
        border-radius: 16px;
        border: 1px solid transparent;
        display: none;
        line-height: 1.5;
      }

      .dialog-alert.show { display: block; }
      .dialog-alert.info {
        color: var(--info);
        background: var(--info-soft);
        border-color: rgba(96, 165, 250, 0.35);
      }
      .dialog-alert.success {
        color: #166534;
        background: var(--success-soft);
        border-color: rgba(34, 197, 94, 0.35);
      }
      .dialog-alert.error {
        color: #991b1b;
        background: var(--danger-soft);
        border-color: rgba(248, 113, 113, 0.4);
      }

      .table-wrap {
        overflow: hidden;
        border-radius: 22px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.72);
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th, td {
        padding: 18px 20px;
        border-bottom: 1px solid var(--line);
        vertical-align: middle;
      }

      th {
        text-align: center;
        background: rgba(255, 250, 242, 0.95);
        color: #7c2d12;
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      td {
        text-align: left;
      }

      td.center-cell,
      td.actions-cell {
        text-align: center;
      }

      tbody tr:last-child td { border-bottom: 0; }
      tbody tr:hover { background: rgba(255, 247, 237, 0.72); }

      .code {
        font-family: "Consolas", "SFMono-Regular", monospace;
        font-size: 13px;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.7);
        border: 1px solid rgba(217, 119, 6, 0.18);
      }

      .platforms {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: center;
      }

      .chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(217, 119, 6, 0.12);
        color: #9a3412;
        font-size: 13px;
        font-weight: 700;
      }

      .chip.muted {
        background: rgba(148, 163, 184, 0.18);
        color: var(--muted);
      }

      .row-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        justify-content: center;
      }

      .ghost {
        padding: 9px 14px;
        font-size: 13px;
        font-weight: 700;
      }

      .empty {
        padding: 48px 24px;
        text-align: center;
        color: var(--muted);
      }

      .pager {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        padding: 18px 20px;
        border-top: 1px solid var(--line);
        background: rgba(255, 250, 242, 0.8);
      }

      .pager-meta {
        color: var(--muted);
        font-size: 14px;
        line-height: 1.5;
      }

      .pager-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 10px;
      }

      .pager-btn {
        padding: 10px 14px;
        font-size: 13px;
        font-weight: 700;
      }

      .pager-btn.active {
        color: white;
        background: linear-gradient(135deg, var(--brand) 0%, #f97316 100%);
        box-shadow: 0 10px 18px rgba(217, 119, 6, 0.22);
      }

      dialog {
        width: min(560px, calc(100vw - 24px));
        border: 0;
        padding: 0;
        border-radius: 26px;
        background: #fffdf9;
        box-shadow: 0 30px 70px rgba(120, 53, 15, 0.22);
      }

      dialog::backdrop {
        background: rgba(17, 24, 39, 0.38);
        backdrop-filter: blur(6px);
      }

      .dialog-body {
        padding: 24px;
      }

      .dialog-header {
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 22px;
      }

      .dialog-title {
        margin: 0;
        font-size: 24px;
      }

      .dialog-copy {
        margin: 8px 0 0;
        color: var(--muted);
        line-height: 1.6;
      }

      .close-btn {
        width: 40px;
        height: 40px;
        padding: 0;
        border-radius: 50%;
        background: rgba(148, 163, 184, 0.16);
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
      }

      label {
        display: block;
        font-size: 14px;
        font-weight: 700;
        margin-bottom: 8px;
      }

      input[type="text"] {
        width: 100%;
        border-radius: 16px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        background: white;
        padding: 13px 14px;
        font-size: 15px;
        color: var(--text);
      }

      input[readonly] {
        background: #f8fafc;
        color: #64748b;
      }

      .check-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin-top: 12px;
      }

      .check-card {
        border: 1px solid rgba(148, 163, 184, 0.28);
        background: white;
        border-radius: 18px;
        padding: 14px;
      }

      .check-card label {
        margin: 0;
        display: flex;
        gap: 10px;
        align-items: center;
        cursor: pointer;
      }

      .check-card span {
        display: block;
        font-size: 13px;
        color: var(--muted);
        font-weight: 500;
        margin-top: 2px;
      }

      .dialog-footer {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        margin-top: 24px;
      }

      @media (max-width: 860px) {
        .hero {
          flex-direction: column;
          align-items: stretch;
        }

        .grid {
          grid-template-columns: 1fr;
        }

        th:nth-child(3),
        td:nth-child(3) {
          min-width: 220px;
        }
      }

      @media (max-width: 640px) {
        .shell {
          width: calc(100vw - 16px);
          margin: 8px auto;
          padding: 18px;
          border-radius: 24px;
        }

        th,
        td {
          padding: 14px;
        }

        .check-grid {
          grid-template-columns: 1fr;
        }

        .row-actions {
          flex-direction: column;
          align-items: stretch;
        }

        .pager {
          flex-direction: column;
          align-items: stretch;
        }

        .pager-actions {
          justify-content: stretch;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <div>
          <p class="eyebrow">Keepalive Admin</p>
          <h1>账号管理页</h1>
          <p class="subtitle">管理本地账号配置和保活渠道，以及重补今日保活任务</p>
        </div>
        <div class="actions">
          <button id="refreshBtn" class="secondary" type="button">刷新列表</button>
          <button id="recoverTodayBtn" class="secondary" type="button">立刻重补今日任务</button>
          <button id="addBtn" class="primary" type="button">新增账号</button>
        </div>
      </section>

      <div id="status" class="status"></div>

      <section class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>指纹环境名称</th>
              <th>指纹环境编号</th>
              <th>保活渠道</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody id="tableBody">
            <tr><td class="empty" colspan="4">正在加载账号列表...</td></tr>
          </tbody>
        </table>
        <div class="pager" id="pager" hidden>
          <div class="pager-meta" id="pagerMeta"></div>
          <div class="pager-actions" id="pagerActions"></div>
        </div>
      </section>
    </main>

    <dialog id="accountDialog">
      <form method="dialog" class="dialog-body" id="accountForm">
        <div class="dialog-header">
          <div>
            <h2 class="dialog-title" id="dialogTitle">新增账号</h2>
            <p class="dialog-copy" id="dialogCopy">填写指纹环境信息并勾选需要保活的渠道；如果一个都不选，则表示暂停保活并保留在配置中。</p>
          </div>
          <button type="button" class="close-btn" id="closeDialogBtn">×</button>
        </div>

        <div id="dialogAlert" class="dialog-alert"></div>

        <div class="grid">
          <div>
            <label for="containerNameInput">指纹环境名称</label>
            <input id="containerNameInput" name="containerName" type="text" autocomplete="off" />
          </div>
          <div>
            <label for="containerCodeInput">指纹环境编号</label>
            <input id="containerCodeInput" name="containerCode" type="text" autocomplete="off" />
          </div>
        </div>

        <div style="margin-top: 18px;">
          <label>保活渠道</label>
          <div class="check-grid">
            <div class="check-card">
              <label>
                <input type="checkbox" name="platforms" value="twitter" />
                <div>Twitter<span>时间线浏览</span></div>
              </label>
            </div>
            <div class="check-card">
              <label>
                <input type="checkbox" name="platforms" value="discord" />
                <div>Discord<span>频道访问</span></div>
              </label>
            </div>
            <div class="check-card">
              <label>
                <input type="checkbox" name="platforms" value="gmail" />
                <div>Gmail<span>邮件阅读</span></div>
              </label>
            </div>
          </div>
        </div>

        <div class="dialog-footer">
          <button type="button" class="secondary" id="cancelBtn">取消</button>
          <button type="submit" class="primary" id="saveBtn">保存账号</button>
        </div>
      </form>
    </dialog>

    <dialog id="confirmDialog">
      <div class="dialog-body">
        <div class="dialog-header">
          <div>
            <h2 class="dialog-title">确认删除</h2>
            <p class="dialog-copy" id="confirmCopy">删除后会立刻从 accounts.json 中移除。</p>
          </div>
          <button type="button" class="close-btn" id="closeConfirmBtn">×</button>
        </div>

        <div class="dialog-footer">
          <button type="button" class="secondary" id="cancelConfirmBtn">取消</button>
          <button type="button" class="primary" id="confirmDeleteBtn">确认删除</button>
        </div>
      </div>
    </dialog>

    <dialog id="recoverDialog">
      <div class="dialog-body">
        <div class="dialog-header">
          <div>
            <h2 class="dialog-title">立刻重补今日任务</h2>
            <p class="dialog-copy">今日任务尚未开始或预检失败时，手动立即预检并重补今日未完成保活任务。</p>
          </div>
          <button type="button" class="close-btn" id="closeRecoverBtn">×</button>
        </div>

        <div class="dialog-footer">
          <button type="button" class="secondary" id="cancelRecoverBtn">取消</button>
          <button type="button" class="primary" id="confirmRecoverBtn">确认重补</button>
        </div>
      </div>
    </dialog>

    <script>
      const state = {
        accounts: [],
        mode: 'create',
        editingCode: null,
        currentPage: 1,
        pageSize: 10,
        pendingDeleteCode: null,
        isRecoveringToday: false,
        runtimeStatus: {
          phase: 'starting',
          canRecover: false,
          recoveryInProgress: false,
          message: '服务启动中',
        },
        runtimePollTimer: null,
      };

      const POLL_INTERVAL_MS = 1500;

      const tableBody = document.getElementById('tableBody');
      const statusEl = document.getElementById('status');
      const pager = document.getElementById('pager');
      const pagerMeta = document.getElementById('pagerMeta');
      const pagerActions = document.getElementById('pagerActions');
      const dialog = document.getElementById('accountDialog');
      const form = document.getElementById('accountForm');
      const dialogTitle = document.getElementById('dialogTitle');
      const dialogCopy = document.getElementById('dialogCopy');
      const dialogAlert = document.getElementById('dialogAlert');
      const containerNameInput = document.getElementById('containerNameInput');
      const containerCodeInput = document.getElementById('containerCodeInput');
      const saveBtn = document.getElementById('saveBtn');
      const confirmDialog = document.getElementById('confirmDialog');
      const confirmCopy = document.getElementById('confirmCopy');
      const recoverDialog = document.getElementById('recoverDialog');
      const closeRecoverBtn = document.getElementById('closeRecoverBtn');
      const cancelRecoverBtn = document.getElementById('cancelRecoverBtn');
      const confirmRecoverBtn = document.getElementById('confirmRecoverBtn');
      const recoverTodayBtn = document.getElementById('recoverTodayBtn');

      document.getElementById('refreshBtn').addEventListener('click', () => loadAccounts(true));
      recoverTodayBtn.addEventListener('click', openRecoverDialog);
      document.getElementById('addBtn').addEventListener('click', openCreateDialog);
      document.getElementById('closeDialogBtn').addEventListener('click', closeDialog);
      document.getElementById('cancelBtn').addEventListener('click', closeDialog);
      document.getElementById('closeConfirmBtn').addEventListener('click', closeConfirmDialog);
      document.getElementById('cancelConfirmBtn').addEventListener('click', closeConfirmDialog);
      document.getElementById('confirmDeleteBtn').addEventListener('click', confirmDeleteAccount);
      closeRecoverBtn.addEventListener('click', closeRecoverDialog);
      cancelRecoverBtn.addEventListener('click', closeRecoverDialog);
      confirmRecoverBtn.addEventListener('click', recoverToday);
      form.addEventListener('submit', onSubmit);

      async function api(url, options) {
        const response = await fetch(url, {
          headers: { 'Content-Type': 'application/json' },
          ...options,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || payload.message || '请求失败，请稍后重试');
        }
        return payload;
      }

      function setStatus(type, message) {
        statusEl.className = 'status show ' + type;
        statusEl.textContent = message;
      }

      function clearStatus() {
        statusEl.className = 'status';
        statusEl.textContent = '';
      }

      function setDialogAlert(type, message) {
        dialogAlert.className = 'dialog-alert show ' + type;
        dialogAlert.textContent = message;
      }

      function clearDialogAlert() {
        dialogAlert.className = 'dialog-alert';
        dialogAlert.textContent = '';
      }

      function getTotalPages() {
        return Math.max(1, Math.ceil(state.accounts.length / state.pageSize));
      }

      function ensureValidPage() {
        const totalPages = getTotalPages();
        if (state.currentPage > totalPages) {
          state.currentPage = totalPages;
        }
        if (state.currentPage < 1) {
          state.currentPage = 1;
        }
      }

      function getRecoverButtonLabel(runtime) {
        if (state.isRecoveringToday || runtime.recoveryInProgress) {
          return '正在重补今日任务...';
        }
        if (runtime.phase === 'running') {
          return '今日保活执行中';
        }
        if (runtime.phase === 'completed') {
          return '今日任务已完成';
        }
        return '立刻重补今日任务';
      }

      function getStatusStyle(runtime) {
        if (state.isRecoveringToday || runtime.recoveryInProgress) {
          return 'info';
        }
        if (runtime.phase === 'precheck_failed') {
          return 'error';
        }
        if (runtime.phase === 'completed') {
          return 'success';
        }
        return 'info';
      }

      function shouldShowRuntimeStatus(runtime) {
        return Boolean(runtime.message) && !state.isRecoveringToday;
      }

      function isStableRuntimePhase(runtime) {
        return runtime.recoveryInProgress === false &&
          (runtime.phase === 'precheck_failed' || runtime.phase === 'running' || runtime.phase === 'completed');
      }

      function stopRuntimePolling() {
        if (state.runtimePollTimer) {
          clearTimeout(state.runtimePollTimer);
          state.runtimePollTimer = null;
        }
      }

      function syncRecoverControls() {
        const runtime = state.runtimeStatus || {};
        const canRecover = Boolean(runtime.canRecover) && !state.isRecoveringToday;
        recoverTodayBtn.disabled = !canRecover;
        recoverTodayBtn.title = runtime.message || '';
        recoverTodayBtn.textContent = getRecoverButtonLabel(runtime);
        closeRecoverBtn.disabled = state.isRecoveringToday;
        cancelRecoverBtn.disabled = state.isRecoveringToday;
        confirmRecoverBtn.disabled = state.isRecoveringToday || !Boolean(runtime.canRecover);
        confirmRecoverBtn.textContent = state.isRecoveringToday ? '正在提交...' : '确认重补';

        if (shouldShowRuntimeStatus(runtime)) {
          setStatus(getStatusStyle(runtime), runtime.message);
        }
      }

      async function loadRuntimeStatus() {
        const payload = await api('/api/runtime-status');
        state.runtimeStatus = payload;
        syncRecoverControls();
        return payload;
      }

      async function pollRuntimeStatusUntilStable() {
        stopRuntimePolling();

        const tick = async () => {
          try {
            const runtime = await loadRuntimeStatus();
            if (isStableRuntimePhase(runtime)) {
              state.isRecoveringToday = false;
              syncRecoverControls();
              stopRuntimePolling();
              return;
            }
          } catch (error) {
            setStatus('error', error.message || '获取运行状态失败');
            state.isRecoveringToday = false;
            syncRecoverControls();
            stopRuntimePolling();
            return;
          }

          state.runtimePollTimer = setTimeout(tick, POLL_INTERVAL_MS);
        };

        state.runtimePollTimer = setTimeout(tick, POLL_INTERVAL_MS);
      }

      function renderPager() {
        if (!state.accounts.length) {
          pager.hidden = true;
          pagerMeta.textContent = '';
          pagerActions.innerHTML = '';
          return;
        }

        const totalPages = getTotalPages();
        const start = (state.currentPage - 1) * state.pageSize + 1;
        const end = Math.min(state.currentPage * state.pageSize, state.accounts.length);
        pager.hidden = false;
        pagerMeta.textContent = '共 ' + state.accounts.length + ' 条，当前第 ' + state.currentPage + ' / ' + totalPages + ' 页，显示 ' + start + '-' + end + ' 条';

        const buttons = [];
        buttons.push('<button class="pager-btn" type="button" data-page="' + (state.currentPage - 1) + '" ' + (state.currentPage === 1 ? 'disabled' : '') + '>上一页</button>');
        for (let page = 1; page <= totalPages; page++) {
          buttons.push('<button class="pager-btn' + (page === state.currentPage ? ' active' : '') + '" type="button" data-page="' + page + '">' + page + '</button>');
        }
        buttons.push('<button class="pager-btn" type="button" data-page="' + (state.currentPage + 1) + '" ' + (state.currentPage === totalPages ? 'disabled' : '') + '>下一页</button>');

        pagerActions.innerHTML = buttons.join('');
        pagerActions.querySelectorAll('button[data-page]').forEach(button => {
          button.addEventListener('click', () => {
            const page = Number(button.getAttribute('data-page'));
            if (!Number.isFinite(page)) return;
            state.currentPage = page;
            ensureValidPage();
            renderAccounts();
          });
        });
      }

      function renderAccounts() {
        if (!state.accounts.length) {
          tableBody.innerHTML = '<tr><td class="empty" colspan="4">还没有账号，先新增一个吧。</td></tr>';
          renderPager();
          return;
        }

        ensureValidPage();
        const startIndex = (state.currentPage - 1) * state.pageSize;
        const currentAccounts = state.accounts.slice(startIndex, startIndex + state.pageSize);

        tableBody.innerHTML = currentAccounts.map(account => {
          const platforms = account.platforms.length > 0
            ? account.platforms.map(platform => '<span class="chip">' + escapeHtml(platform) + '</span>').join('')
            : '<span class="chip muted">已暂停</span>';

          return '<tr>' +
            '<td class="center-cell">' + escapeHtml(account.containerName) + '</td>' +
            '<td class="center-cell"><span class="code">' + escapeHtml(account.containerCode) + '</span></td>' +
            '<td class="center-cell"><div class="platforms">' + platforms + '</div></td>' +
            '<td class="actions-cell"><div class="row-actions">' +
              '<button class="ghost" type="button" data-action="edit" data-code="' + escapeHtml(account.containerCode) + '">修改渠道</button>' +
              '<button class="ghost" type="button" data-action="delete" data-code="' + escapeHtml(account.containerCode) + '">删除</button>' +
            '</div></td>' +
          '</tr>';
        }).join('');

        tableBody.querySelectorAll('button[data-action="edit"]').forEach(button => {
          button.addEventListener('click', () => {
            openEditDialog(button.getAttribute('data-code'));
          });
        });

        tableBody.querySelectorAll('button[data-action="delete"]').forEach(button => {
          button.addEventListener('click', () => {
            openDeleteDialog(button.getAttribute('data-code'));
          });
        });

        renderPager();
      }

      function getSelectedPlatforms() {
        return Array.from(form.querySelectorAll('input[name="platforms"]:checked')).map(input => input.value);
      }

      function setSelectedPlatforms(platforms) {
        form.querySelectorAll('input[name="platforms"]').forEach(input => {
          input.checked = platforms.includes(input.value);
        });
      }

      function resetForm() {
        form.reset();
        setSelectedPlatforms([]);
        clearDialogAlert();
      }

      function openCreateDialog() {
        state.mode = 'create';
        state.editingCode = null;
        resetForm();
        dialogTitle.textContent = '新增账号';
        dialogCopy.textContent = '填写指纹环境信息并勾选需要保活的渠道；如果一个都不选，则表示暂停保活并保留在配置中。';
        containerNameInput.readOnly = false;
        containerCodeInput.readOnly = false;
        saveBtn.textContent = '保存账号';
        dialog.showModal();
      }

      function openEditDialog(code) {
        const account = state.accounts.find(item => item.containerCode === code);
        if (!account) return;

        state.mode = 'edit';
        state.editingCode = code;
        resetForm();
        dialogTitle.textContent = '修改渠道';
        dialogCopy.textContent = '编辑模式下只允许修改保活渠道；如果全部取消勾选，则该账号会暂停保活，并在下一自然日生效。';
        containerNameInput.value = account.containerName;
        containerCodeInput.value = account.containerCode;
        containerNameInput.readOnly = true;
        containerCodeInput.readOnly = true;
        setSelectedPlatforms(account.platforms);
        saveBtn.textContent = '保存渠道';
        dialog.showModal();
      }

      function openDeleteDialog(code) {
        const account = state.accounts.find(item => item.containerCode === code);
        if (!account) return;

        state.pendingDeleteCode = code;
        confirmCopy.textContent = '确认删除指纹环境 ' + account.containerName + '（' + account.containerCode + '）吗？删除后会立刻从 accounts.json 中移除。';
        confirmDialog.showModal();
      }

      function closeDialog() {
        dialog.close();
      }

      function closeConfirmDialog() {
        state.pendingDeleteCode = null;
        confirmDialog.close();
      }

      function openRecoverDialog() {
        if (!state.runtimeStatus.canRecover || state.isRecoveringToday) {
          if (state.runtimeStatus.message) {
            setStatus(getStatusStyle(state.runtimeStatus), state.runtimeStatus.message);
          }
          return;
        }
        syncRecoverControls();
        recoverDialog.showModal();
      }

      function closeRecoverDialog(force) {
        if (state.isRecoveringToday && !force) {
          return;
        }
        recoverDialog.close();
      }

      async function recoverToday() {
        state.isRecoveringToday = true;
        syncRecoverControls();

        try {
          setStatus('info', '正在立即预检，预检通过后会重补今日未完成保活任务...');
          const payload = await api('/api/system/recover-today', { method: 'POST' });
          setStatus('success', payload.message || '已开始立刻重补今日任务。');
          closeRecoverDialog(true);
          await loadRuntimeStatus();
          pollRuntimeStatusUntilStable();
        } catch (error) {
          state.isRecoveringToday = false;
          setStatus('error', error.message || '立刻重补今日任务失败');
          await loadRuntimeStatus().catch(() => {});
          syncRecoverControls();
        }
      }

      async function loadAccounts(showMessage) {
        try {
          if (showMessage) {
            setStatus('info', '正在刷新账号列表...');
          }
          const [accountsPayload] = await Promise.all([
            api('/api/accounts'),
            loadRuntimeStatus(),
          ]);
          state.accounts = accountsPayload.accounts || [];
          state.currentPage = 1;
          renderAccounts();
          if (showMessage) {
            setStatus('success', '账号列表已刷新。');
          } else if (!state.runtimeStatus.message) {
            clearStatus();
          }
        } catch (error) {
          setStatus('error', error.message || '加载账号列表失败');
          tableBody.innerHTML = '<tr><td class="empty" colspan="4">加载失败，请稍后重试。</td></tr>';
          renderPager();
        }
      }

      async function onSubmit(event) {
        event.preventDefault();
        const payload = {
          containerName: containerNameInput.value.trim(),
          containerCode: containerCodeInput.value.trim(),
          platforms: getSelectedPlatforms(),
        };

        try {
          if (state.mode === 'create') {
            setDialogAlert('info', '正在保存账号...');
            await api('/api/accounts', {
              method: 'POST',
              body: JSON.stringify(payload),
            });
            const refreshed = await api('/api/accounts');
            state.accounts = refreshed.accounts || [];
            state.currentPage = getTotalPages();
            renderAccounts();
            setDialogAlert('success', '新增账号成功。');
            setTimeout(() => {
              if (dialog.open && state.mode === 'create') {
                closeDialog();
              }
            }, 900);
          } else {
            setStatus('info', '正在更新渠道...');
            await api('/api/accounts/' + encodeURIComponent(state.editingCode) + '/platforms', {
              method: 'PATCH',
              body: JSON.stringify({ platforms: payload.platforms }),
            });
            const refreshed = await api('/api/accounts');
            state.accounts = refreshed.accounts || [];
            setStatus('success', '渠道更新成功，新的保活配置会在下一自然日生效。');
            closeDialog();
            renderAccounts();
          }
        } catch (error) {
          if (state.mode === 'create') {
            setDialogAlert('error', error.message || '新增账号失败');
          } else {
            setStatus('error', error.message || '保存失败');
          }
        }
      }

      async function confirmDeleteAccount() {
        const code = state.pendingDeleteCode;
        if (!code) return;

        try {
          setStatus('info', '正在删除账号...');
          await api('/api/accounts/' + encodeURIComponent(code), { method: 'DELETE' });
          const refreshed = await api('/api/accounts');
          state.accounts = refreshed.accounts || [];
          ensureValidPage();
          setStatus('success', '账号已删除。');
          closeConfirmDialog();
          renderAccounts();
        } catch (error) {
          setStatus('error', error.message || '删除失败');
          closeConfirmDialog();
        }
      }

      function escapeHtml(value) {
        return String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      loadAccounts(false);
    </script>
  </body>
</html>`;
}
